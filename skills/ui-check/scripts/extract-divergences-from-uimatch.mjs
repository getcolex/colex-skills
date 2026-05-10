#!/usr/bin/env node
/**
 * extract-divergences-from-uimatch.mjs
 *
 * Reads each page's uimatch-results-fixed/<NNN-pagename>/report.json,
 * groups style props by selector into candidate divergences, writes
 * _candidates.json, and emits per-candidate live-zoom PNGs.
 *
 * Usage:
 *   node scripts/extract-divergences-from-uimatch.mjs [--results-dir <path>]
 *
 * Reads .ui-check-config.json for page names.
 */
import { readFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

// --- args ---
/** @param {string[]} argv @returns {Record<string,string>} */
function parseArgs(argv) {
  const out = /** @type {Record<string,string>} */ ({});
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) out[a.slice(2, eq)] = a.slice(eq + 1);
      else out[a.slice(2)] = argv[++i] ?? '';
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const cfgPath = args['config'] || '.ui-check-config.json';
const resultsDir = resolve(args['results-dir'] || 'uimatch-results-fixed');

if (!existsSync(cfgPath)) {
  console.error(`config not found: ${cfgPath}`);
  process.exit(1);
}
/** @type {{ pages: Record<string, unknown> }} */
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const pageNames = Object.keys(cfg.pages || {});
if (pageNames.length === 0) {
  console.error('config has no pages');
  process.exit(1);
}

// --- discover page dirs ---
/** @param {string} name @returns {string|null} */
function findPageDir(name) {
  const entries = readdirSync(resultsDir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory() && e.name.replace(/^\d+-/, '') === name) return e.name;
  }
  return null;
}

// --- types (JSDoc) ---
/**
 * @typedef {{ name: string, figma: string, live: string }} PropDiff
 * @typedef {{ x: number, y: number, w: number, h: number }|null} Bbox
 * @typedef {{
 *   page: string,
 *   selector: string,
 *   figma_node_id: string|null,
 *   bbox: Bbox,
 *   props: PropDiff[],
 *   score: { dfs: number, pixel_diff_pct: number, delta_e: number },
 *   patch_hint: string|null,
 *   _page_dir: string,
 *   _page_impl_png: string
 * }} Candidate
 */

// --- zoom padding (matches figma-context-export.mjs) ---
/**
 * @param {number} h height of bbox
 * @returns {number}
 */
function padFactor(h) {
  return h <= 100 ? 3 : h <= 400 ? 1 : 0.25;
}

/** @type {Candidate[]} */
const allCandidates = [];
let totalPages = 0;

for (const pageName of pageNames) {
  const dirName = findPageDir(pageName);
  if (!dirName) {
    console.warn(`[extract] no dir for page "${pageName}"; skipping`);
    continue;
  }
  const reportPath = join(resultsDir, dirName, 'report.json');
  if (!existsSync(reportPath)) {
    console.warn(`[extract] no report.json in ${dirName}; skipping`);
    continue;
  }

  /** @type {{ metrics: any, styleDiffs: any[] }} */
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const diffs = report.styleDiffs || [];
  const metrics = report.metrics || {};
  const implPng = join(resultsDir, dirName, 'impl.png');

  totalPages++;

  // Group by selector (already one per selector in current schema, but be defensive)
  /** @type {Map<string, Candidate>} */
  const bySelector = new Map();

  for (const diff of diffs) {
    const selector = /** @type {string} */ (diff.selector || '');
    const props = Object.entries(diff.properties || {}).map(([name, val]) => {
      const v = /** @type {any} */ (val);
      return {
        name,
        figma: String(v.expected ?? ''),
        live: String(v.actual ?? ''),
      };
    });

    const firstHint = (diff.patchHints || [])[0];
    const patch_hint = firstHint
      ? `change ${firstHint.property} from ${
          (diff.properties?.[firstHint.property]?.actual) ?? '?'
        } → ${firstHint.suggestedValue}`
      : null;

    if (bySelector.has(selector)) {
      const existing = bySelector.get(selector);
      if (existing) {
        existing.props.push(...props);
        if (!existing.patch_hint && patch_hint) existing.patch_hint = patch_hint;
      }
    } else {
      // Bbox lives on each styleDiff's meta as { x, y, width, height } in
      // viewport CSS pixels, populated by the playwright capture path. Older
      // uimatch builds (pre-bbox patch) won't have these fields; null is fine.
      const meta = diff.meta || {};
      const bbox = (typeof meta.x === 'number' && typeof meta.y === 'number')
        ? { x: meta.x, y: meta.y, w: meta.width || 0, h: meta.height || 0 }
        : null;
      bySelector.set(selector, {
        page: pageName,
        selector,
        figma_node_id: null,  // uimatch styleDiff doesn't track Figma node id
        bbox,
        props,
        score: {
          dfs: metrics.dfs ?? 0,
          pixel_diff_pct: Math.round((metrics.pixelDiffRatio ?? 0) * 10000) / 100,
          delta_e: metrics.colorDeltaEAvg ?? 0,
        },
        patch_hint,
        _page_dir: dirName,
        _page_impl_png: implPng,
      });
    }
  }

  allCandidates.push(...bySelector.values());
}

// --- write _candidates.json (strip internal fields) ---
const outPath = join(resultsDir, '_candidates.json');
const publicCandidates = allCandidates.map(({ _page_dir, _page_impl_png, ...pub }) => pub);
writeFileSync(outPath, JSON.stringify(publicCandidates, null, 2));

// --- emit per-candidate live zoom PNGs ---
let zoomsWritten = 0;
for (let idx = 0; idx < allCandidates.length; idx++) {
  const c = allCandidates[idx];
  if (!c.bbox || !existsSync(c._page_impl_png)) continue;

  const zoomDir = join(resultsDir, c._page_dir, 'per-candidate-zoom');
  mkdirSync(zoomDir, { recursive: true });

  const meta = await sharp(c._page_impl_png).metadata();
  const imgW = meta.width ?? 0;
  const imgH = meta.height ?? 0;

  // Bbox is in CSS pixels (viewport-relative). Live PNG is rendered at
  // device-pixel-ratio 2 by default, so multiply CSS coords by 2 to land
  // in PNG-pixel space. Heuristic: if bbox.x + bbox.w > imgW/2, the image
  // is likely 2× retina and we scale; otherwise leave as-is.
  const dpr = imgW > (c.bbox.x + c.bbox.w) * 1.8 ? 2 : 1;
  const x = c.bbox.x * dpr;
  const y = c.bbox.y * dpr;
  const w = c.bbox.w * dpr;
  const h = c.bbox.h * dpr;

  const pf = padFactor(h);
  const padX = Math.round(Math.max(60, w * pf));
  const padY = Math.round(Math.max(80, h * pf));
  // Clamp to image bounds. Reject if bbox is mostly off-screen (negative y
  // beyond reasonable scroll, or zero width/height after clamping).
  const left = Math.max(0, Math.round(x - padX));
  const top = Math.max(0, Math.round(y - padY));
  const width = Math.max(0, Math.min(imgW - left, Math.round(w + padX * 2)));
  const height = Math.max(0, Math.min(imgH - top, Math.round(h + padY * 2)));
  if (width < 10 || height < 10 || left >= imgW || top >= imgH) {
    // Bbox doesn't intersect the captured PNG — skip silently.
    continue;
  }

  const zoomPath = join(zoomDir, `${idx}.png`);
  await sharp(c._page_impl_png)
    .extract({ left, top, width, height })
    .png()
    .toFile(zoomPath);

  zoomsWritten++;
}

console.log(
  `[extract] ${publicCandidates.length} candidates across ${totalPages} pages` +
  (zoomsWritten > 0 ? `, ${zoomsWritten} live zooms written` : ' (no bboxes → no zooms)')
);
