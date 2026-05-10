#!/usr/bin/env node
/**
 * build-suite-from-audit.mjs — page-keyed.
 *
 * Reads the page registry from .ui-check-config.json's `pages` block and
 * emits one uimatch suite item per page. Each item's frame name is the page
 * name itself (no truncation, no collisions). Bullets in the audit doc cite
 * `[page=<name>]` so the dashboard knows which page's capture to render.
 *
 * Usage:
 *   node build-suite-from-audit.mjs \
 *     --output-current uimatch-suite.json \
 *     --output-fixed uimatch-suite-fixed.json
 *
 * Reads:    .ui-check-config.json (live_url + figma_file_key + pages{})
 * Writes:   <output-current> and <output-fixed> uimatch suite JSON files.
 *
 * Exit 0 on success.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

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
if (!args['output-current'] || !args['output-fixed']) {
  console.error('Usage: build-suite-from-audit.mjs --output-current <path> --output-fixed <path>');
  process.exit(1);
}

const cfgPath = resolve(args.config || '.ui-check-config.json');
if (!existsSync(cfgPath)) {
  console.error(`config not found: ${cfgPath}`);
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const fileKey = cfg.figma_file_key;
const liveUrl = cfg.live_url || 'http://localhost:3000';
const pages = cfg.pages || {};

if (!fileKey || Object.keys(pages).length === 0) {
  console.error('config missing figma_file_key or pages{}');
  process.exit(1);
}

const items = [];
for (const [name, page] of Object.entries(pages)) {
  const item = {
    name, // page name = frame dir name; no truncation, no collisions.
    figma: `${fileKey}:${page.figma_artboard.replace(':', '-')}`,
    selector: page.selector || 'body',
    viewport: page.viewport || { width: 1440, height: 900 },
  };
  if (page.pre_click_selector) item.preClickSelector = page.pre_click_selector;
  if (page.wait_for_selector) item.waitForSelector = page.wait_for_selector;
  items.push(item);
}

const defaults = {
  story: liveUrl,
  size: 'pad',
  contentBasis: 'intersection',
  figmaAutoRoi: false,
  bootstrap: true,
  overlay: true,
};

writeFileSync(
  resolve(args['output-current']),
  JSON.stringify({ defaults: { ...defaults, story: 'http://localhost:3000' }, items }, null, 2) + '\n',
);
writeFileSync(
  resolve(args['output-fixed']),
  JSON.stringify({ defaults, items }, null, 2) + '\n',
);

console.log(`[build-suite] wrote ${items.length} page-keyed items to ${args['output-current']} and ${args['output-fixed']}`);
console.log('[build-suite] pages:');
for (const it of items) {
  console.log(`  - ${it.name}: figma=${it.figma}, selector="${it.selector}", viewport=${it.viewport.width}×${it.viewport.height}${it.preClickSelector ? ' (preClick + waitFor)' : ''}`);
}
