#!/usr/bin/env node
/**
 * figma-context-export.mjs
 *
 * For each bullet's cited Figma node, fetch the parent FRAME and draw a red
 * rectangle around the leaf node so reviewers see the divergence in context
 * instead of an isolated atom (e.g. "AAREY COMMUNITY" 26px sliver).
 *
 * Output: uimatch-results/per-bullet-context/<node-with-dash>.png
 *
 * Usage:
 *   node scripts/figma-context-export.mjs --audit-doc docs/figma-divergences.md
 *
 * Env: FIGMA_ACCESS_TOKEN required (read from .env automatically).
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import sharp from 'sharp';

// --- args + env -------------------------------------------------------------

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
const cfgPath = args['config'] || '.ui-check-config.json';

if (!existsSync(cfgPath)) {
  console.error(`config not found: ${cfgPath}`);
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const fileKey = cfg.figma_file_key;
const canvasNode = cfg.figma_canvas_node_id;

const token = process.env.FIGMA_ACCESS_TOKEN;
if (!token) {
  console.error('FIGMA_ACCESS_TOKEN not set');
  process.exit(1);
}

// --- collect cited nodes from audit doc ------------------------------------

const md = readFileSync(docPath, 'utf8');
const sec9 = md.split(/^## 9\./m)[1] || '';
const bulletRe = /^- \[([ x\-~?r])\] \*\*(9[A-Z]\.\d+)\*\* (.+?)(?=\n- \[|$)/gms;
const cited = new Map(); // node-id -> [bullet ids]
let m;
while ((m = bulletRe.exec(sec9)) !== null) {
  const [, , id, body] = m;
  const nodes = (body.match(/Figma `(\d+:\d+)`/g) || []).map(s => s.match(/(\d+:\d+)/)[1]);
  for (const n of nodes) {
    if (!cited.has(n)) cited.set(n, []);
    cited.get(n).push(id);
  }
}
console.log(`[figma-context] ${cited.size} unique nodes cited across ${[...cited.values()].flat().length} bullet refs`);

// --- pull node tree --------------------------------------------------------

async function fetchNodes(ids) {
  const url = `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${ids.join(',')}&geometry=paths`;
  const r = await fetch(url, { headers: { 'X-Figma-Token': token } });
  if (!r.ok) throw new Error(`Figma /nodes returned ${r.status}: ${await r.text().catch(() => '')}`);
  return (await r.json()).nodes || {};
}

// --- canvas ancestry walk: leaf → enclosing FRAME --------------------------
// Strategy: fetch full canvas (cheap, one request), build child→parent map,
// for each leaf walk up until we hit a FRAME / COMPONENT (top-level artboard).

console.log('[figma-context] fetching canvas tree…');
const canvasResp = await fetchNodes([canvasNode]);
const canvasDoc = canvasResp[canvasNode]?.document;
if (!canvasDoc) {
  console.error(`canvas ${canvasNode} not found`);
  process.exit(1);
}

const parents = new Map(); // childId -> parentNode
const byId = new Map(); // nodeId -> node
function walk(node, parent) {
  byId.set(node.id, node);
  if (parent) parents.set(node.id, parent);
  for (const c of node.children || []) walk(c, node);
}
walk(canvasDoc, null);
console.log(`[figma-context] canvas tree has ${byId.size} nodes`);

// --- find each cited node's enclosing artboard frame ----------------------

function findArtboard(nodeId) {
  let cur = byId.get(nodeId);
  if (!cur) return null;
  // Walk up until we find a FRAME/COMPONENT whose parent is the canvas itself.
  while (cur && parents.has(cur.id)) {
    const parent = parents.get(cur.id);
    if (parent.id === canvasNode || parent.type === 'CANVAS') {
      // cur is a top-level artboard
      if (cur.type === 'FRAME' || cur.type === 'COMPONENT' || cur.type === 'INSTANCE') return cur;
      return null;
    }
    cur = parent;
  }
  return null;
}

// --- batch: render each unique enclosing artboard once ---------------------

const leafToArtboard = new Map(); // leafId -> artboardId
const artboardSet = new Set();
for (const leaf of cited.keys()) {
  const ab = findArtboard(leaf);
  if (!ab) {
    console.warn(`[figma-context] no artboard for leaf ${leaf}; skipping`);
    continue;
  }
  leafToArtboard.set(leaf, ab.id);
  artboardSet.add(ab.id);
}
console.log(`[figma-context] ${leafToArtboard.size} leaves → ${artboardSet.size} unique artboards`);

// Render artboards via Figma /images endpoint at 1× to keep file size reasonable.
async function renderArtboards(ids) {
  const url = `https://api.figma.com/v1/images/${fileKey}?ids=${ids.join(',')}&format=png&scale=1`;
  const r = await fetch(url, { headers: { 'X-Figma-Token': token } });
  if (!r.ok) throw new Error(`Figma /images returned ${r.status}: ${await r.text().catch(() => '')}`);
  return (await r.json()).images || {};
}

console.log('[figma-context] requesting artboard renders from Figma…');
// Chunk: Figma /images caps at ~50 ids per request.
const artboardIds = [...artboardSet];
const renderUrls = {};
for (let i = 0; i < artboardIds.length; i += 30) {
  const chunk = artboardIds.slice(i, i + 30);
  const urls = await renderArtboards(chunk);
  Object.assign(renderUrls, urls);
}

// --- download artboard PNGs (cache by artboard id) ------------------------

const outDir = join(process.cwd(), 'uimatch-results', 'per-bullet-context');
const cacheDir = join(process.cwd(), 'uimatch-results', '_artboard-cache');
mkdirSync(outDir, { recursive: true });
mkdirSync(cacheDir, { recursive: true });

async function getArtboardBuffer(artboardId) {
  const cachePath = join(cacheDir, `${artboardId.replace(':', '-')}.png`);
  if (existsSync(cachePath)) return readFileSync(cachePath);
  const url = renderUrls[artboardId];
  if (!url) throw new Error(`no render URL for ${artboardId}`);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${artboardId} failed: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(cachePath, buf);
  return buf;
}

// --- compute leaf bbox in artboard coords + draw overlay -------------------
// Figma absoluteBoundingBox is in canvas coords. Leaf-in-artboard = leaf.bbox - artboard.bbox.
// Render is at scale 1 — but Figma sometimes returns 2x for retina; we'll compute scale from the actual PNG dims.

function box(node) {
  const b = node.absoluteBoundingBox;
  if (!b) return null;
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

async function exportContext(leafId, artboardId, bulletIds) {
  const leaf = byId.get(leafId);
  const artboard = byId.get(artboardId);
  const lb = box(leaf), ab = box(artboard);
  if (!lb || !ab) {
    console.warn(`[figma-context] missing bbox for leaf ${leafId} or artboard ${artboardId}`);
    return null;
  }

  const buf = await getArtboardBuffer(artboardId);
  const meta = await sharp(buf).metadata();
  // Determine scale: rendered px / figma px.
  const scaleX = meta.width / ab.w;
  const scaleY = meta.height / ab.h;

  // Leaf bbox in rendered px (relative to artboard top-left).
  const x = Math.round((lb.x - ab.x) * scaleX);
  const y = Math.round((lb.y - ab.y) * scaleY);
  const w = Math.max(1, Math.round(lb.w * scaleX));
  const h = Math.max(1, Math.round(lb.h * scaleY));

  // SVG overlay: red rect with semi-transparent fill + thick border.
  const stroke = Math.max(3, Math.round(meta.width / 200));
  const labelText = leafId;
  const labelFontSize = Math.max(14, Math.round(meta.width / 60));
  const labelPad = Math.round(labelFontSize * 0.4);
  const labelW = labelText.length * labelFontSize * 0.62 + labelPad * 2;
  const labelH = labelFontSize + labelPad * 2;
  const labelX = Math.max(0, Math.min(x, meta.width - labelW));
  const labelY = Math.max(labelH, y) - labelH;

  const svg = `
    <svg width="${meta.width}" height="${meta.height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${x}" y="${y}" width="${w}" height="${h}"
            fill="rgba(255, 51, 51, 0.18)" stroke="#ff3333" stroke-width="${stroke}" />
      <rect x="${labelX}" y="${labelY}" width="${labelW}" height="${labelH}"
            fill="#ff3333" />
      <text x="${labelX + labelPad}" y="${labelY + labelFontSize + labelPad / 2}"
            font-family="ui-monospace, monospace" font-size="${labelFontSize}"
            font-weight="700" fill="white">${labelText}</text>
    </svg>
  `.trim();

  const outPath = join(outDir, `${leafId.replace(':', '-')}.png`);
  await sharp(buf)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toFile(outPath);

  return { leafId, artboardId, outPath, leafBox: { x, y, w, h }, imageSize: { w: meta.width, h: meta.height } };
}

console.log('[figma-context] generating context PNGs…');
let ok = 0, fail = 0;
for (const [leafId, artboardId] of leafToArtboard) {
  try {
    const r = await exportContext(leafId, artboardId, cited.get(leafId));
    if (r) {
      ok++;
      console.log(`  ✓ ${leafId} → per-bullet-context/${leafId.replace(':', '-')}.png (artboard ${artboardId}, leaf ${r.leafBox.w}×${r.leafBox.h}px)`);
    } else {
      fail++;
    }
  } catch (e) {
    fail++;
    console.error(`  ✗ ${leafId} failed: ${e.message}`);
  }
}
console.log(`[figma-context] done — ${ok} written, ${fail} failed`);
