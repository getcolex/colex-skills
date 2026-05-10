#!/usr/bin/env node
/**
 * figma-context-export.mjs — page-keyed.
 *
 * For each bullet in the audit doc with `[page=<name>]` and a `Figma <node>`
 * citation, fetch the page's artboard from Figma and draw a labeled red box
 * around the cited leaf node's bbox. Output:
 *   uimatch-results/per-bullet-context/<bullet-id>.png        (full artboard)
 *   uimatch-results/per-bullet-context/<bullet-id>-zoom.png   (cropped)
 *
 * Bullet ID becomes the canonical key — no node-id truncation, no
 * collisions. Each bullet gets exactly one Figma evidence pair.
 *
 * Usage:
 *   node figma-context-export.mjs --audit-doc docs/figma-divergences.md
 *
 * Env: FIGMA_ACCESS_TOKEN required.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) out[a.slice(2, eq)] = a.slice(eq + 1);
      else out[a.slice(2)] = argv[++i];
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const docPath = args['audit-doc'] || 'docs/figma-divergences.md';
const cfgPath = args.config || '.ui-check-config.json';

if (!existsSync(cfgPath)) {
  console.error(`config not found: ${cfgPath}`);
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const fileKey = cfg.figma_file_key;
const pages = cfg.pages || {};
if (!fileKey || Object.keys(pages).length === 0) {
  console.error('config missing figma_file_key or pages{}');
  process.exit(1);
}
const token = process.env.FIGMA_ACCESS_TOKEN;
if (!token) {
  console.error('FIGMA_ACCESS_TOKEN not set');
  process.exit(1);
}

// --- parse bullets: one entry per bullet with page + figma node ---

const md = readFileSync(docPath, 'utf8');
const sec9 = md.split(/^## 9\./m)[1] || '';
// Bullet line shape:
//   - [STATE] **ID** [page=<name>] body. (Figma `<node>`)
const BULLET_RE = /^- \[([ x\-~?r])\] \*\*(9[A-Z]\.\d+)\*\* \[page=([a-z0-9-]+)\] (.+?)$/gm;
const bullets = [];
for (const m of sec9.matchAll(BULLET_RE)) {
  const [, , id, page, body] = m;
  if (!pages[page]) {
    console.warn(`[figma-context] bullet ${id} cites page="${page}" not in registry; skipping`);
    continue;
  }
  const figmaNodeMatch = body.match(/Figma `(\d+:\d+|\d+-\d+)`/);
  if (!figmaNodeMatch) {
    console.warn(`[figma-context] bullet ${id} has no Figma node citation; skipping`);
    continue;
  }
  bullets.push({ id, page, leafNodeId: figmaNodeMatch[1].replace('-', ':') });
}
console.log(`[figma-context] ${bullets.length} bullets to export`);

// --- fetch each artboard once, then crop per bullet ---

async function fetchArtboardImageUrl(artboardId) {
  const url = `https://api.figma.com/v1/images/${fileKey}?ids=${artboardId}&format=png&scale=1`;
  const r = await fetch(url, { headers: { 'X-Figma-Token': token } });
  if (!r.ok) throw new Error(`Figma /images returned ${r.status}`);
  return (await r.json()).images[artboardId];
}

async function fetchNode(nodeId) {
  const url = `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${nodeId}`;
  const r = await fetch(url, { headers: { 'X-Figma-Token': token } });
  if (!r.ok) throw new Error(`Figma /nodes returned ${r.status}`);
  return (await r.json()).nodes[nodeId]?.document;
}

function findLeaf(node, leafId) {
  if (node.id === leafId) return node;
  for (const c of node.children || []) {
    const hit = findLeaf(c, leafId);
    if (hit) return hit;
  }
  return null;
}

const outDir = join(process.cwd(), 'uimatch-results', 'per-bullet-context');
const cacheDir = join(process.cwd(), 'uimatch-results', '_artboard-cache');
mkdirSync(outDir, { recursive: true });
mkdirSync(cacheDir, { recursive: true });

const artboardCache = new Map(); // artboardId -> { buf, doc, bbox }

async function getArtboard(artboardId) {
  if (artboardCache.has(artboardId)) return artboardCache.get(artboardId);
  const cachePath = join(cacheDir, `${artboardId.replace(':', '-')}.png`);
  let buf;
  if (existsSync(cachePath)) {
    buf = readFileSync(cachePath);
  } else {
    const url = await fetchArtboardImageUrl(artboardId);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`download ${artboardId} failed: ${r.status}`);
    buf = Buffer.from(await r.arrayBuffer());
    writeFileSync(cachePath, buf);
  }
  const doc = await fetchNode(artboardId);
  const entry = { buf, doc, bbox: doc.absoluteBoundingBox };
  artboardCache.set(artboardId, entry);
  return entry;
}

let ok = 0, fail = 0;
for (const b of bullets) {
  try {
    const page = pages[b.page];
    const ab = await getArtboard(page.figma_artboard);
    const leaf = findLeaf(ab.doc, b.leafNodeId);
    if (!leaf || !leaf.absoluteBoundingBox) {
      console.warn(`  ✗ ${b.id}: leaf ${b.leafNodeId} not found in artboard ${page.figma_artboard}`);
      fail++;
      continue;
    }
    const meta = await sharp(ab.buf).metadata();
    const sx = meta.width / ab.bbox.width;
    const sy = meta.height / ab.bbox.height;
    const x = Math.round((leaf.absoluteBoundingBox.x - ab.bbox.x) * sx);
    const y = Math.round((leaf.absoluteBoundingBox.y - ab.bbox.y) * sy);
    const w = Math.max(2, Math.round(leaf.absoluteBoundingBox.width * sx));
    const h = Math.max(2, Math.round(leaf.absoluteBoundingBox.height * sy));

    const stroke = Math.max(3, Math.round(meta.width / 200));
    const labelText = b.id;
    const fontSize = Math.max(14, Math.round(meta.width / 60));
    const labelPad = Math.round(fontSize * 0.4);
    const labelW = labelText.length * fontSize * 0.62 + labelPad * 2;
    const labelH = fontSize + labelPad * 2;
    const labelX = Math.max(0, Math.min(x, meta.width - labelW));
    const labelY = Math.max(labelH, y) - labelH;

    const svg = `
      <svg width="${meta.width}" height="${meta.height}" xmlns="http://www.w3.org/2000/svg">
        <rect x="${x}" y="${y}" width="${w}" height="${h}"
              fill="rgba(255, 51, 51, 0.18)" stroke="#ff3333" stroke-width="${stroke}" />
        <rect x="${labelX}" y="${labelY}" width="${labelW}" height="${labelH}" fill="#ff3333" />
        <text x="${labelX + labelPad}" y="${labelY + fontSize + labelPad / 2}"
              font-family="ui-monospace, monospace" font-size="${fontSize}"
              font-weight="700" fill="white">${labelText}</text>
      </svg>
    `.trim();

    const fullPath = join(outDir, `${b.id}.png`);
    await sharp(ab.buf)
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .png()
      .toFile(fullPath);

    // Zoom variant: read just-written annotated PNG, extract padded crop.
    const padFactor = h <= 100 ? 3 : h <= 400 ? 1 : 0.25;
    const padX = Math.round(Math.max(60, w * padFactor));
    const padY = Math.round(Math.max(80, h * padFactor));
    const cx = Math.max(0, x - padX);
    const cy = Math.max(0, y - padY);
    const cw = Math.min(meta.width - cx, w + padX * 2);
    const ch = Math.min(meta.height - cy, h + padY * 2);
    const zoomPath = join(outDir, `${b.id}-zoom.png`);
    await sharp(fullPath)
      .extract({ left: cx, top: cy, width: cw, height: ch })
      .png()
      .toFile(zoomPath);

    ok++;
    console.log(`  ✓ ${b.id} (page=${b.page}, leaf=${b.leafNodeId}, ${w}×${h}px in ${meta.width}×${meta.height})`);
  } catch (e) {
    console.error(`  ✗ ${b.id}: ${e.message}`);
    fail++;
  }
}
console.log(`[figma-context] done — ${ok} written, ${fail} failed`);
