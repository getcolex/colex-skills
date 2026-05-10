#!/usr/bin/env node
/**
 * discover-frames.mjs — list child frames of a Figma canvas/page node and
 * mark which ones are already covered by an existing audit doc.
 *
 * Usage:
 *   node discover-frames.mjs --file-key <key> --canvas-node <id> [--audit-doc <path>]
 *
 * Output (stdout, JSON):
 *   {
 *     ok: true,
 *     canvas_node_id: "233:1119",
 *     frames: [
 *       {
 *         node_id: "233:1120",
 *         name: "Landing Page Option 1 - Delilah",
 *         width: 1728, height: 5392,
 *         viewport_kind: "desktop-wide",
 *         already_covered: true     // only present when --audit-doc was passed
 *       },
 *       ...
 *     ]
 *   }
 *
 * On error: { ok: false, error: "..." } and exit 0 (so the calling skill
 * can branch on `.ok` rather than parse stderr).
 *
 * Requires FIGMA_ACCESS_TOKEN env var.
 */
import { readFileSync, existsSync } from 'node:fs';

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

function classifyViewport(width) {
  if (width <= 599) return 'mobile';
  if (width <= 1023) return 'tablet';
  if (width <= 1599) return 'desktop';
  return 'desktop-wide';
}

const args = parseArgs(process.argv.slice(2));
if (!args['file-key'] || !args['canvas-node']) {
  console.log(JSON.stringify({ ok: false, error: 'usage: discover-frames.mjs --file-key <key> --canvas-node <id> [--audit-doc <path>]' }));
  process.exit(0);
}

const token = process.env.FIGMA_ACCESS_TOKEN;
if (!token) {
  console.log(JSON.stringify({ ok: false, error: 'FIGMA_ACCESS_TOKEN env var not set' }));
  process.exit(0);
}

// Cross-reference: which Figma node IDs are already in the audit doc?
let covered = new Set();
if (args['audit-doc'] && existsSync(args['audit-doc'])) {
  const md = readFileSync(args['audit-doc'], 'utf8');
  for (const m of md.matchAll(/Figma `(\d+:\d+|\d+-\d+)`/g)) {
    // Normalize to colon form (Figma's response key form).
    covered.add(m[1].replace('-', ':'));
  }
}

// Fetch the canvas node from Figma. Try both colon and dash forms — Figma's
// API normalizes to colon in the response regardless.
const tryIds = new Set([
  args['canvas-node'],
  args['canvas-node'].replace(':', '-'),
  args['canvas-node'].replace('-', ':'),
]);

let document;
for (const id of tryIds) {
  const url = `https://api.figma.com/v1/files/${args['file-key']}/nodes?ids=${encodeURIComponent(id)}`;
  try {
    const r = await fetch(url, { headers: { 'X-Figma-Token': token } });
    if (!r.ok) continue;
    const d = await r.json();
    const nodes = d?.nodes ?? {};
    // Look for the doc under any returned key (Figma uses colon form).
    for (const k of Object.keys(nodes)) {
      if (nodes[k]?.document) { document = nodes[k].document; break; }
    }
    if (document) break;
  } catch {
    // try next variant
  }
}

if (!document) {
  console.log(JSON.stringify({ ok: false, error: `Figma did not return document for canvas node ${args['canvas-node']}` }));
  process.exit(0);
}

const children = document.children ?? [];
const frames = [];
for (const c of children) {
  // Only top-level FRAME / COMPONENT nodes that have a real bounding box.
  if (!['FRAME', 'COMPONENT', 'INSTANCE'].includes(c.type)) continue;
  const bb = c.absoluteBoundingBox;
  if (!bb || bb.width <= 0 || bb.height <= 0) continue;

  const node_id = c.id; // colon form per Figma
  const width = Math.round(bb.width);
  const height = Math.round(bb.height);
  const frame = {
    node_id,
    name: c.name ?? '',
    width,
    height,
    viewport_kind: classifyViewport(width),
  };
  if (args['audit-doc']) {
    frame.already_covered = covered.has(node_id);
  }
  frames.push(frame);
}

console.log(JSON.stringify({
  ok: true,
  canvas_node_id: args['canvas-node'],
  frames,
}, null, 2));
