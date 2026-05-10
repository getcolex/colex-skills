#!/usr/bin/env node
/**
 * build-suite-from-audit.mjs — regenerate uimatch-suite.json from the
 * audit doc. Each unique Figma node referenced by any bullet becomes one
 * suite item.
 *
 * Usage:
 *   node build-suite-from-audit.mjs \
 *     --audit-doc <path> \
 *     --output-current <path> \
 *     --output-fixed <path> \
 *     [--file-key <key>] \
 *     [--known-selectors <path>]
 *
 * Behavior:
 *   - Parses every `Figma <node-id>` reference in the audit doc.
 *   - For each unique node, looks up:
 *     - Cached viewport at <project>/uimatch-results/per-bullet/<node>.viewport.json
 *     - Selector override in known-selectors.json (keyed by Figma node id)
 *     - If output file already exists: preserves `defaults` block + any item's
 *       hand-edited selector / subselector / figmaChildStrategy / viewport.
 *   - Writes uimatch-suite.json (story=http://localhost:3000) and
 *     uimatch-suite-fixed.json (story=http://localhost:3100).
 *   - Idempotent: re-running on unchanged inputs produces byte-identical output.
 *
 * Exit 0 on success, exit 1 on missing required args or unreadable audit doc.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';

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
if (!args['audit-doc'] || !args['output-current'] || !args['output-fixed']) {
  console.error('Usage: build-suite-from-audit.mjs --audit-doc <path> --output-current <path> --output-fixed <path> [--file-key <key>] [--known-selectors <path>]');
  process.exit(1);
}

const docPath = resolve(args['audit-doc']);
if (!existsSync(docPath)) {
  console.error(`audit doc not found: ${docPath}`);
  process.exit(1);
}

// Project root inferred from doc path (assumes <project>/docs/figma-divergences.md).
const projectRoot = dirname(dirname(docPath));
const perBulletDir = join(projectRoot, 'uimatch-results', 'per-bullet');

// Read cache: viewport per node.
function readViewport(nodeId) {
  const safe = nodeId.replace(':', '-');
  const path = join(perBulletDir, `${safe}.viewport.json`);
  if (!existsSync(path)) return { width: 1440, height: 900 };
  try {
    const d = JSON.parse(readFileSync(path, 'utf8'));
    return d.viewport ?? { width: 1440, height: 900 };
  } catch {
    return { width: 1440, height: 900 };
  }
}

// Read known-selectors override.
let knownSelectors = {};
if (args['known-selectors'] && existsSync(args['known-selectors'])) {
  try {
    knownSelectors = JSON.parse(readFileSync(args['known-selectors'], 'utf8'));
  } catch {
    /* ignore — empty overrides */
  }
}

// Read existing suite (to preserve defaults + per-item hand edits).
function readExisting(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}
const existingCurrent = readExisting(args['output-current']);
const existingFixed = readExisting(args['output-fixed']);

// Index existing items by Figma reference (for hand-edit preservation).
function indexByFigma(suite) {
  const m = {};
  if (suite?.items) {
    for (const it of suite.items) {
      if (it.figma) m[it.figma] = it;
    }
  }
  return m;
}
const existingByFigmaCur = indexByFigma(existingCurrent);
const existingByFigmaFix = indexByFigma(existingFixed);

// Parse audit doc for unique Figma node references.
const md = readFileSync(docPath, 'utf8');
const nodeIds = new Set();
for (const m of md.matchAll(/Figma `(\d+:\d+|\d+-\d+)`/g)) {
  nodeIds.add(m[1].replace('-', ':'));
}

// Determine fileKey: explicit arg, or extracted from any existing suite item.
let fileKey = args['file-key'];
if (!fileKey) {
  const sample = existingCurrent?.items?.[0]?.figma ?? existingFixed?.items?.[0]?.figma;
  if (sample && sample.includes(':')) fileKey = sample.split(':')[0];
}
if (!fileKey) {
  console.error('No --file-key provided and no existing suite to extract it from.');
  process.exit(1);
}

function shortHash(nodeId) {
  // tiny deterministic id: replace : with -, take first 6 chars
  return nodeId.replace(':', '-').slice(0, 6);
}

// Build items: one per unique node id, sorted for stable output.
const sortedNodes = Array.from(nodeIds).sort();
function buildItems(existingByFigma) {
  return sortedNodes.map((nodeId) => {
    const figmaRef = `${fileKey}:${nodeId.replace(':', '-')}`;
    const viewport = readViewport(nodeId);
    const existing = existingByFigma[figmaRef] ?? existingByFigma[`${fileKey}:${nodeId}`];

    // Defaults
    const item = {
      name: existing?.name ?? `frame-${shortHash(nodeId)}`,
      figma: figmaRef,
      selector: knownSelectors[nodeId] ?? existing?.selector ?? 'body',
      viewport,
    };
    // Preserve hand-edited optional fields.
    /** @type {Record<string,unknown>} */ const ext = item;
    if (existing?.subselector) ext.subselector = existing.subselector;
    if (existing?.figmaChildStrategy) ext.figmaChildStrategy = existing.figmaChildStrategy;
    return item;
  });
}

const defaultsCurrent = existingCurrent?.defaults ?? {
  story: 'http://localhost:3000',
  size: 'pad',
  contentBasis: 'intersection',
  figmaAutoRoi: false,
  bootstrap: true,
  overlay: true,
};
const defaultsFixed = existingFixed?.defaults ?? {
  ...defaultsCurrent,
  story: 'http://localhost:3100',
};

const suiteCurrent = { defaults: defaultsCurrent, items: buildItems(existingByFigmaCur) };
const suiteFixed = { defaults: defaultsFixed, items: buildItems(existingByFigmaFix) };

writeFileSync(args['output-current'], JSON.stringify(suiteCurrent, null, 2) + '\n');
writeFileSync(args['output-fixed'], JSON.stringify(suiteFixed, null, 2) + '\n');

console.log(`Wrote ${args['output-current']} (${suiteCurrent.items.length} items)`);
console.log(`Wrote ${args['output-fixed']} (${suiteFixed.items.length} items)`);
