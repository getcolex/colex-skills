#!/usr/bin/env node
/**
 * Parse a figma-divergences.md-style audit doc and emit a JSON evidence
 * packet per actionable bullet. Used by the ui-check skill.
 *
 * Usage:
 *   node parse-bullets.mjs <path-to-divergences.md> [--worktree <path>]
 *
 * Emits to stdout:
 *   {
 *     ok: true,
 *     project_root: "...",          // resolved from the doc path
 *     worktree_root: "...",          // explicit or default
 *     dashboard_url: "http://localhost:4567",
 *     bullets: [
 *       {
 *         id: "9B.6",
 *         state: "approved" | "rejected",
 *         body: "...",
 *         note: "..." | null,
 *         dispatched_sha: "abc..." | null,    // last <!-- dispatched: sha -->
 *         live_refs: ["LandingClient.tsx:25"],
 *         figma_nodes: ["233:1834"],
 *         primary_file: "LandingClient.tsx",  // first .tsx ref
 *         frame: "003-grid-1" | null,         // matched via FRAME_HINTS
 *         evidence: {
 *           figma_image: "absolute path to per-bullet PNG, or null if missing",
 *           current_image: "absolute path to uimatch-results/<frame>/impl.png",
 *           diff_image: "absolute path to uimatch-results/<frame>/diff.png",
 *           uimatch_report: "absolute path to uimatch-results/<frame>/report.json",
 *         }
 *       }
 *     ],
 *     skipped: [
 *       { id, reason }   // e.g. already dispatched at this SHA, no figma image
 *     ],
 *     clusters: {
 *       "components/LandingClient.tsx": ["9B.3", "9B.18"],
 *       "components/MakerGrid.tsx": ["9B.2", "9B.5"],
 *       ...
 *     }
 *   }
 *
 * Exit code 0 always (even if zero bullets to dispatch); error info on stderr.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: parse-bullets.mjs <path-to-divergences.md> [--worktree <path>]');
  process.exit(2);
}
const docPath = resolve(args[0]);
let worktreePath = null;
const wIdx = args.indexOf('--worktree');
if (wIdx !== -1 && args[wIdx + 1]) worktreePath = resolve(args[wIdx + 1]);

if (!existsSync(docPath)) {
  console.error(`File not found: ${docPath}`);
  process.exit(1);
}

// Project root = parent of `docs/` (assumes the doc lives at <project>/docs/figma-divergences.md).
const projectRoot = (() => {
  const docsDir = dirname(docPath);
  const parent = dirname(docsDir);
  if (basename(docsDir) === 'docs') return parent;
  return docsDir;
})();

// Worktree root defaults to .claude/worktrees/audit-fixes if it exists.
if (!worktreePath) {
  const def = join(projectRoot, '.claude', 'worktrees', 'audit-fixes');
  worktreePath = existsSync(def) ? def : projectRoot;
}

const RESULTS = join(projectRoot, 'uimatch-results');
const PER_BULLET = join(RESULTS, 'per-bullet');
mkdirSync(PER_BULLET, { recursive: true });

const FIGMA_TOKEN = process.env.FIGMA_ACCESS_TOKEN;
const FIGMA_FILE_KEY = 'Fsbd038PdcTTeUVRvhIhuG';

// Mirror of the dashboard's NODE_TO_FRAME and FRAME_HINTS. Kept here as a
// duplicate so the skill can run without depending on the project's script
// internals. Update when the project's mapping changes meaningfully.
const NODE_TO_FRAME = {
  '233:1752': '003-grid-1',
  '233:1760': '003-grid-1',
  '233:1762': '003-grid-1',
  '233:1802': '003-grid-1',
  '233:1822': '003-grid-1',
  '233:1803': '003-grid-1',
  '233:1774': '005-grid-2',
  '233:1787': '005-grid-2',
  '233:1792': '005-grid-2',
  '233:1793': '005-grid-2',
  '233:1800': '005-grid-2',
  '233:1824': '005-grid-2',
  '233:1834': '002-hero',
  '233:1831': '002-hero',
  '233:1832': '002-hero',
  '233:1833': '002-hero',
  '233:1517': '004-video-band',
  '233:1519': '007-footer',
  '233:1750': '007-footer',
  '233:1747': '007-footer',
  '233:1749': '007-footer',
  '233:1751': '007-footer',
  '233:1825': '006-impact-stats',
  '233:1826': '006-impact-stats',
  '233:1828': '006-impact-stats',
  '233:1827': '006-impact-stats',
  '233:1829': '006-impact-stats',
  '233:1830': '006-impact-stats',
};

const FRAME_HINTS = [
  { rx: /\bmodal\b/i, frame: null },
  { rx: /grid[- ]?2|maker[- ]?grid[- ]?2/i, frame: '005-grid-2' },
  { rx: /grid[- ]?1|maker[- ]?grid[- ]?1/i, frame: '003-grid-1' },
  { rx: /\b(footer|footer:)\b/i, frame: '007-footer' },
  { rx: /video[- ]?band|why[- ]?we[- ]?make/i, frame: '004-video-band' },
  { rx: /\b(hero|search input|search placeholder|hero headline|hero search)\b/i, frame: '002-hero' },
  { rx: /impact[- ]?stats|impact stat|numeral|blurb|\b708\b|3\.5 mil|\b576\b/i, frame: '006-impact-stats' },
  { rx: /made with love|mission[- ]statement tile/i, frame: '003-grid-1' },
];

function pickFrame(body, citedNodes) {
  for (const node of citedNodes) {
    if (NODE_TO_FRAME[node]) return NODE_TO_FRAME[node];
  }
  for (const { rx, frame } of FRAME_HINTS) {
    if (rx.test(body)) return frame;
  }
  return null;
}

const md = readFileSync(docPath, 'utf8');

// Find the section 9 audit area; skip earlier sections (they're already done
// in older formats that may differ structurally).
const sec9 = md.split(/^## 9\./m)[1] || md;

// ──────────────────────────────────────────────────────────────────────
// Viewport inference from cited Figma frame.
//
// Classification by 2026 viewport-stats research:
//   ≤ 599 px width → mobile  (e.g. iPhone 17 = 402, Pixel 8 = 412)
//   600..1023      → tablet  (iPad portrait = 768, iPad Air = 820)
//   1024..1599     → desktop (laptop 1280..1440)
//   ≥ 1600         → desktop-wide (designer artboard 1728, full-HD 1920)
//
// Capture viewport uses the designer's exact frame width when ≤ 1440;
// clamps to 1440 above that (most desktop users are ≤1440 — see Statcounter
// 2026). Capture height = min(frame.height, sensible-cap-per-kind).
//
// Cached at uimatch-results/per-bullet/<node>.viewport.json.

let viewportWarningPrinted = false;

async function resolveViewport(fileKey, nodeId, token) {
  if (!token) {
    if (!viewportWarningPrinted) {
      process.stderr.write(
        '[parse-bullets] FIGMA_ACCESS_TOKEN not set — viewport inference skipped, all bullets default to desktop 1440x900.\n'
      );
      viewportWarningPrinted = true;
    }
    return { kind: 'desktop', frame: null, viewport: { width: 1440, height: 900 } };
  }

  const safeId = nodeId.replace(':', '-');
  const cachePath = join(PER_BULLET, `${safeId}.viewport.json`);
  if (existsSync(cachePath)) {
    try {
      return JSON.parse(readFileSync(cachePath, 'utf8'));
    } catch {
      // fall through to refetch
    }
  }

  const url = `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${nodeId}`;
  let bb;
  try {
    const r = await fetch(url, { headers: { 'X-Figma-Token': token } });
    if (!r.ok) {
      process.stderr.write(`[parse-bullets] Figma node fetch ${nodeId} → ${r.status}\n`);
      return null;
    }
    const d = await r.json();
    // Figma normalizes node IDs to colon form regardless of input.
    const nodes = d?.nodes ?? {};
    const node =
      nodes[nodeId]?.document ??
      nodes[nodeId.replace('-', ':')]?.document ??
      nodes[nodeId.replace(':', '-')]?.document;
    bb = node?.absoluteBoundingBox;
    if (!bb) {
      process.stderr.write(`[parse-bullets] no bounding box for ${nodeId}\n`);
      return null;
    }
  } catch (err) {
    process.stderr.write(`[parse-bullets] resolveViewport(${nodeId}) failed: ${err.message}\n`);
    return null;
  }

  const frameW = Math.round(bb.width);
  const frameH = Math.round(bb.height);
  // Designers often size artboards arbitrarily tall for layout convenience,
  // so we cap above and floor below to land on a realistic device viewport.
  const clamp = (h, lo, hi) => Math.min(hi, Math.max(lo, h));
  let kind, capW, capH;
  if (frameW <= 599) {
    kind = 'mobile';
    capW = frameW;
    capH = clamp(frameH, 640, 932);
  } else if (frameW <= 1023) {
    kind = 'tablet';
    capW = frameW;
    capH = clamp(frameH, 800, 1180);
  } else if (frameW <= 1599) {
    kind = 'desktop';
    capW = Math.min(frameW, 1440);
    capH = 900;
  } else {
    kind = 'desktop-wide';
    capW = Math.min(frameW, 1440);
    capH = 900;
  }

  const result = {
    kind,
    frame: { width: frameW, height: frameH },
    viewport: { width: capW, height: capH },
  };

  try {
    writeFileSync(cachePath, JSON.stringify(result));
  } catch {
    // cache write failure is non-fatal
  }
  return result;
}

// Bullet shape: `- [STATE] **<id>** <body>` optionally with trailing
// `<!-- note: ... -->` and `<!-- dispatched: <sha> -->` HTML comments.
const BULLET_RE = /^- \[([ x\-~?r])\] \*\*([0-9]+[A-Z]\.\d+)\*\* (.+)$/gm;
const NOTE_RE = /<!--\s*note:\s*([\s\S]*?)\s*-->/;
const DISPATCH_RE = /<!--\s*dispatched:\s*([0-9a-f]{7,40})\s*-->/;
const SUMMARY_RE = /<!--\s*agent-summary:\s*([\s\S]*?)\s*-->/;

const STATE_NAMES = { ' ': 'open', x: 'approved', '-': 'wont_fix', r: 'retry', '?': 'tbd', '~': 'partial' };

const bullets = [];
const skipped = [];
const clusters = {};

// Phase 1: synchronous pass collects bullets without viewport.
const rawBullets = [];
for (const m of sec9.matchAll(BULLET_RE)) {
  const [, stateChar, id, fullBody] = m;
  const state = STATE_NAMES[stateChar] ?? 'open';

  // Only act on approved (first dispatch needed) and retry (re-dispatch with
  // designer's note as feedback). Skip wont_fix entirely — designer's call.
  if (state !== 'approved' && state !== 'retry') {
    continue;
  }

  const noteM = fullBody.match(NOTE_RE);
  const dispM = fullBody.match(DISPATCH_RE);
  const sumM = fullBody.match(SUMMARY_RE);
  // Body is the body without the trailing comments.
  let body = fullBody;
  if (noteM) body = body.replace(NOTE_RE, '');
  if (dispM) body = body.replace(DISPATCH_RE, '');
  if (sumM) body = body.replace(SUMMARY_RE, '');
  body = body.trim();

  const note = noteM ? noteM[1].trim() : null;
  const dispatchedSha = dispM ? dispM[1] : null;
  const agentSummary = sumM ? sumM[1].trim() : null;

  // Idempotency: skip approved bullets already dispatched (they're awaiting
  // designer verification). Always dispatch retry bullets — that's the
  // explicit "previous attempt was wrong, try again with this note" signal.
  if (state === 'approved' && dispatchedSha) {
    skipped.push({ id, reason: `already dispatched at ${dispatchedSha.slice(0, 7)} — awaiting designer verification` });
    continue;
  }

  // Extract refs from the body.
  const liveRefs = [...body.matchAll(/`([^`]+\.tsx[:0-9-]*)`/g)].map((mm) => mm[1]);
  const figmaNodes = [...body.matchAll(/Figma `(\d+:\d+|\d+-\d+)`/g)].map((mm) => mm[1].replace('-', ':'));

  const needsDescription = liveRefs.length === 0;

  const frame = pickFrame(body, figmaNodes);
  const primaryFile = needsDescription ? '__needs_description__' : liveRefs[0].split(':')[0];

  // Resolve evidence paths.
  const figmaNodeId = figmaNodes[0] ?? null;
  const figmaImg = figmaNodeId
    ? join(PER_BULLET, `${figmaNodeId.replace(':', '-')}.png`)
    : null;
  const currentImg = frame ? join(RESULTS, frame, 'impl.png') : null;
  const diffImg = frame ? join(RESULTS, frame, 'diff.png') : null;
  const reportJson = frame ? join(RESULTS, frame, 'report.json') : null;

  const evidence = {
    figma_image: figmaImg && existsSync(figmaImg) ? figmaImg : null,
    current_image: currentImg && existsSync(currentImg) ? currentImg : null,
    diff_image: diffImg && existsSync(diffImg) ? diffImg : null,
    uimatch_report: reportJson && existsSync(reportJson) ? reportJson : null,
  };

  rawBullets.push({
    id,
    state,
    body,
    note,
    dispatched_sha: dispatchedSha,
    agent_summary: agentSummary,
    needs_description: needsDescription,
    live_refs: liveRefs,
    figma_nodes: figmaNodes,
    primary_file: primaryFile,
    frame,
    evidence,
  });
}

// Phase 2: resolve viewport for every bullet that cites a Figma node.
// Cap parallelism so cold-cache runs don't trip Figma's ~6 req/sec rate limit
// (HTTP 429). Pool of 4 leaves headroom; warm-cache runs skip the network entirely.
const VIEWPORT_FETCH_CONCURRENCY = 4;
const inflight = new Set();
async function withLimit(fn) {
  while (inflight.size >= VIEWPORT_FETCH_CONCURRENCY) {
    await Promise.race(inflight);
  }
  const p = (async () => fn())().finally(() => inflight.delete(p));
  inflight.add(p);
  return p;
}

await Promise.all(
  rawBullets.map((b) =>
    withLimit(async () => {
      if (b.figma_nodes.length === 0) {
        // No node cited — fall back to desktop-default.
        b.viewport_kind = 'desktop';
        b.viewport = { width: 1440, height: 900 };
        b.frame_size = null;
        return;
      }
      const v = await resolveViewport(FIGMA_FILE_KEY, b.figma_nodes[0], FIGMA_TOKEN);
      if (v) {
        b.viewport_kind = v.kind;
        b.viewport = v.viewport;
        b.frame_size = v.frame;
      } else {
        // Resolution failed — fall back to desktop-default but record the failure.
        b.viewport_kind = 'desktop';
        b.viewport = { width: 1440, height: 900 };
        b.frame_size = null;
      }
    })
  )
);

// Phase 3: push into bullets[] and build clusters (existing logic).
for (const b of rawBullets) {
  bullets.push(b);
  // Cluster by primary file (stripping any line range — multiple bullets
  // touching the same file go into one agent to avoid edit conflicts).
  (clusters[b.primary_file] ||= []).push(b.id);
}

const out = {
  ok: true,
  doc_path: docPath,
  project_root: projectRoot,
  worktree_root: worktreePath,
  dashboard_url: 'http://localhost:4567',
  bullets,
  skipped,
  clusters,
};

console.log(JSON.stringify(out, null, 2));
