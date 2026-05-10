#!/usr/bin/env node
/**
 * Generates docs/verify.html — a single static page surfacing every open
 * divergence bullet from `docs/figma-divergences.md` § 9 with the matching
 * uiMatch evidence (Figma export, live screenshot, diff/overlay) so the
 * designer can decide ✅ / ❌ / TBD per bullet.
 *
 * The dashboard talks to scripts/verify-server.mjs for write-back when
 * buttons are clicked. The server updates the divergence markdown directly.
 *
 * Run:
 *   npm run uimatch:suite          # refresh evidence
 *   node scripts/build-verify-dashboard.mjs
 *   node scripts/verify-server.mjs # then: open http://localhost:4567/
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO = process.cwd();
const DIV_DOC = join(REPO, 'docs/figma-divergences.md');
const RESULTS = join(REPO, 'uimatch-results');
const RESULTS_FIXED = join(REPO, 'uimatch-results-fixed');
const PER_BULLET = join(RESULTS, 'per-bullet');
const OUT = join(REPO, 'docs/verify.html');

// Read FIGMA_FILE_KEY from .ui-check-config.json (preferred) or fall back to
// the FIGMA_FILE_KEY env var. The previous hardcoded value is a last-resort
// shim for projects that pre-date the config file.
const CFG_PATH = join(REPO, '.ui-check-config.json');
const CFG = existsSync(CFG_PATH)
  ? (() => { try { return JSON.parse(readFileSync(CFG_PATH, 'utf8')); } catch { return {}; } })()
  : {};
const FIGMA_FILE_KEY =
  CFG.figma_file_key ||
  process.env.FIGMA_FILE_KEY ||
  ''; // empty → Figma deep-links omitted (graceful degrade)
const FIGMA_TOKEN = process.env.FIGMA_ACCESS_TOKEN;
const LIVE_URL = CFG.live_url || 'http://localhost:3000';
const HAS_FIXED = existsSync(RESULTS_FIXED);

// Read the cached viewport for a Figma node (written by parse-bullets.mjs).
// Returns { kind, viewport: { width, height }, frame: { width, height } }
// or null if the cache file isn't present.
function readViewportCache(nodeId) {
  if (!nodeId) return null;
  const safeId = nodeId.replace(':', '-');
  const path = join(PER_BULLET, `${safeId}.viewport.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────
// 1. Parse § 9 bullets from the divergence doc.

const md = readFileSync(DIV_DOC, 'utf8');
const sec9 = md.split(/^## 9\./m)[1] || '';

// Each bullet line: `- [STATE] **ID** body  <!-- note: free-text -->`.
// STATE ∈ { ' ', 'x', '-', '?', '~' }; ID looks like 9A.1 / 9B.12 / 9F.3.
// Optional trailing HTML comment carries free-text notes (typed in the
// dashboard's TBD textarea) without disturbing markdown rendering.
const BULLET_RE = /^- \[([ x\-~?r])\] \*\*(9[A-Z]\.\d+)\*\* (.+)$/gm;
const NOTE_RE = /<!--\s*note:\s*([\s\S]*?)\s*-->/;
const DISPATCH_RE = /<!--\s*dispatched:\s*([0-9a-f]{7,40})\s*-->/;
const SUMMARY_RE = /<!--\s*agent-summary:\s*([\s\S]*?)\s*-->/;
const bullets = [];
for (const m of sec9.matchAll(BULLET_RE)) {
  const [, stateChar, id, fullBody] = m;
  const state = ({ ' ': 'open', 'x': 'approved', '-': 'wont_fix', 'r': 'retry', '?': 'tbd', '~': 'partial' })[stateChar] ?? 'open';
  // Pull every trailing HTML comment out of the body.
  const noteMatch = fullBody.match(NOTE_RE);
  const dispMatch = fullBody.match(DISPATCH_RE);
  const sumMatch = fullBody.match(SUMMARY_RE);
  let body = fullBody;
  if (noteMatch) body = body.replace(NOTE_RE, '');
  if (dispMatch) body = body.replace(DISPATCH_RE, '');
  if (sumMatch) body = body.replace(SUMMARY_RE, '');
  body = body.trim();
  const note = noteMatch ? noteMatch[1].trim() : '';
  const dispatchedSha = dispMatch ? dispMatch[1] : null;
  const agentSummary = sumMatch ? sumMatch[1].trim() : '';
  // Extract first Figma node citation for viewport lookup.
  const figmaNodeMatch = body.match(/Figma `(\d+:\d+|\d+-\d+)`/);
  const firstFigmaNode = figmaNodeMatch ? figmaNodeMatch[1].replace('-', ':') : null;
  const vpCache = readViewportCache(firstFigmaNode);
  const viewport = vpCache?.viewport ?? null;
  const viewportKind = vpCache?.kind ?? null;
  const frameSize = vpCache?.frame ?? null;
  bullets.push({ id, state, body, note, dispatchedSha, agentSummary, viewport, viewportKind, frameSize, raw: m[0] });
}

// ──────────────────────────────────────────────────────────────────────
// 2. Heuristics: classify each bullet (text / layout / color) and pick a frame.

// Frame mapping has two layers:
//
// 1. NODE_TO_FRAME — explicit per-Figma-node routing. If a bullet cites a
//    node ID from this map, it routes to the named live frame. Highest
//    confidence (no keyword guessing).
//
// 2. FRAME_HINTS — keyword-based fallback when the bullet has no node.
//    The narrower the keyword, the higher it should sit in the list.
//
// Coordinates come from the get_metadata pull on 2026-05-09:
//   - grid-1 (233:1752) wraps y=835..2044 → all nodes inside that band
//   - grid-2 (233:1774) wraps y=3084..4293
//   - footer (233:1519) wraps y=4644..5648
//   - impact-stats numerals (233:1825/1828/1826) sit at y=4448 (siblings of
//     the landing artboard, not inside footer or any wrapper frame)
const NODE_TO_FRAME = {
  // Grid 1 contents
  '233:1752': '003-grid-1',
  '233:1760': '003-grid-1', // black mission-statement tile
  '233:1762': '003-grid-1', // mission text
  '233:1802': '003-grid-1', // "380 Makers 380 Dreams" (in grid 1)
  '233:1822': '003-grid-1', // "Communities Impacted"
  '233:1803': '003-grid-1', // small TM Sun decoration
  // Grid 2 contents
  '233:1774': '005-grid-2',
  '233:1787': '005-grid-2', // Jamuna's Dream tile
  '233:1792': '005-grid-2', // Sonu's Dream tile
  '233:1793': '005-grid-2',
  '233:1800': '005-grid-2',
  '233:1824': '005-grid-2', // "Made With Love In Mumbai" (sits in grid 2 region)
  // Hero
  '233:1834': '002-hero', // headline
  '233:1831': '002-hero', // search input rect
  '233:1832': '002-hero', // search placeholder
  '233:1833': '002-hero', // search arrow
  // Video band
  '233:1517': '004-video-band',
  // Footer
  '233:1519': '007-footer',
  '233:1750': '007-footer',
  '233:1747': '007-footer',
  '233:1749': '007-footer',
  '233:1751': '007-footer',
  // Impact stats — no wrapper frame in Figma; live frame captures the row.
  // We DON'T use 006-impact-stats's figma.png (broken — points at whole
  // landing artboard) but we still want the live impl for these.
  '233:1825': '006-impact-stats',
  '233:1826': '006-impact-stats',
  '233:1828': '006-impact-stats',
  '233:1827': '006-impact-stats',
  '233:1829': '006-impact-stats',
  '233:1830': '006-impact-stats',
};

const FRAME_HINTS = [
  // Order matters — narrower keywords first.
  { rx: /\bmodal\b/i, frame: null }, // modal not in suite (mobile artboards)
  { rx: /grid[- ]?2|maker[- ]?grid[- ]?2/i, frame: '005-grid-2', figmaNode: '233:1774' },
  { rx: /grid[- ]?1|maker[- ]?grid[- ]?1/i, frame: '003-grid-1', figmaNode: '233:1752' },
  { rx: /\b(footer|footer:)\b/i, frame: '007-footer', figmaNode: '233:1519' },
  { rx: /video[- ]?band|why[- ]?we[- ]?make/i, frame: '004-video-band', figmaNode: '233:1517' },
  { rx: /\b(hero|search input|search placeholder|hero headline|hero search)\b/i, frame: '002-hero', figmaNode: '233:1834' },
  { rx: /impact[- ]?stats|impact stat|numeral|blurb|\b708\b|3\.5 mil|\b576\b/i, frame: '006-impact-stats', figmaNode: null },
  { rx: /made with love|mission[- ]statement tile/i, frame: '003-grid-1', figmaNode: '233:1752' },
];

// Pick the frame for a bullet. Order of preference:
//   1. Cited Figma node maps to a known frame (NODE_TO_FRAME).
//   2. Keyword match in body (FRAME_HINTS).
//   3. null.
// Optional ancestry map written by figma-context-export.mjs:
//   { "<leaf-node-id>": { artboard_node_id, artboard_name, artboard_size } }
// Lets pickFrame fall back to the enclosing Figma artboard when neither the
// hand-curated NODE_TO_FRAME nor FRAME_HINTS produce a match. This is what
// rescues §9F/§9G (modal) bullets whose cited nodes weren't in NODE_TO_FRAME.
const LEAF_TO_ARTBOARD_PATH = join(REPO, 'uimatch-results/leaf-to-artboard.json');
const LEAF_TO_ARTBOARD = existsSync(LEAF_TO_ARTBOARD_PATH)
  ? (() => { try { return JSON.parse(readFileSync(LEAF_TO_ARTBOARD_PATH, 'utf8')); } catch { return {}; } })()
  : {};

// Match an artboard id (e.g. "233:5518") to a uimatch-results-fixed/<dir>
// frame name. uimatch's suite items name frames like "frame-233-32" using a
// 6-char prefix of the suite-item Figma node id; we walk the available
// directories looking for any whose name endswith the artboard's normalized
// id, so 233:5518 matches "037-frame-233-58" if the suite ran on a parent
// node rooted at 233:5518's same family.
// uimatch suite generators tend to truncate the Figma node id when naming
// frame dirs (e.g. node 233:5518 → "frame-233-55", taking a 6-char prefix
// of the safe form "233-5518"). We try the full id first (older suites) and
// fall back to progressive prefixes.
function artboardToFrameDir(artboardNodeId) {
  if (!artboardNodeId) return null;
  const safe = artboardNodeId.replace(':', '-');
  const candidates = [];
  // Full id, then 7, 6, 5 char prefixes of the safe id.
  candidates.push(safe);
  for (let n = 7; n >= 5; n--) {
    if (safe.length > n) candidates.push(safe.slice(0, n));
  }
  for (const root of [RESULTS, RESULTS_FIXED]) {
    if (!existsSync(root)) continue;
    try {
      const dirs = readdirSync(root).filter((d) => d.startsWith('0') && d.includes('frame-'));
      for (const cand of candidates) {
        const hit = dirs.find((d) => d.endsWith(cand) || d.endsWith(`-${cand}`));
        if (hit) return hit;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

function pickFrame(body, citedNodes = []) {
  for (const node of citedNodes) {
    if (NODE_TO_FRAME[node]) return NODE_TO_FRAME[node];
  }
  for (const { rx, frame } of FRAME_HINTS) {
    if (rx.test(body)) return frame;
  }
  // Last resort: walk Figma ancestry via leaf-to-artboard map written by
  // figma-context-export.mjs. The dashboard then maps the artboard id to a
  // uimatch-results frame directory, if any.
  for (const node of citedNodes) {
    const entry = LEAF_TO_ARTBOARD[node];
    if (entry?.artboard_node_id) {
      const frame = artboardToFrameDir(entry.artboard_node_id);
      if (frame) return frame;
    }
  }
  return null;
}

// Pick a default Figma node for a bullet (when bullet body has no Figma
// node citation). Used to give the per-bullet image fetch something to
// target. Falls back to keyword-matched frame's figmaNode.
function pickFigmaNodeForFrame(body) {
  for (const { rx, figmaNode } of FRAME_HINTS) {
    if (rx.test(body)) return figmaNode;
  }
  return null;
}

// Card type: text (content/copy mismatch), color (palette/swatch), layout (size/position/structure).
//
// Layout wins over text wins over color when signals overlap. The classifier is
// order-sensitive: structural words (placement, position, sizing, missing element)
// dominate, even if the bullet quotes literal copy as evidence.
function classify(body) {
  const layoutSignals =
    /\b(placement|position|inline|baseline|anchor|aligned|alignment|width|height|aspect[- ]ratio|aspect[- ]\[|column|row|cells?|cell|grid|tile|tiles|pill|band|header bar|nav bar|behind|in front|overlay|under|above|below|sticky|full[- ]bleed|full[- ]width|stacks|stacked|layout|structure|adjacency|missing.+(tile|cell|row|column|frame|band|header|footer|map|pin|illustration|element|component|section|sun[- ]burst|asset)|forced into|line[- ]spans?|broken into|aspect)\b|\b\d+\s*(px|pt|rem|%)\b|aspect-\[/i;
  const colorSignals =
    /\b(color|colour|hex|background|bg-|border-color|fill|stroke|opacity|transparent|rgba?|delta[- ]?e|ΔE)\b|#[0-9A-Fa-f]{3,8}\b/i;
  const textSignals =
    /\b(slash|separator|literal|literally|copy|copywriting|spelling|typo|misspell|wrong (number|copy|spelling|word)|case[- ]sensitive|placeholder text|placeholder string|line of (?:text|copy)|sentence|content text|never present|repeats?|repeated|quoted|font[- ]family|font[- ]weight|weight\s+(?:bold|medium|regular|normal|one notch)|tracking|letter[- ]spacing|line[- ]height|font[- ]bold|underline|uppercase|lowercase|leading)\b/i;

  if (layoutSignals.test(body)) return 'layout';
  if (textSignals.test(body)) return 'text';
  if (colorSignals.test(body)) return 'color';
  return 'layout';
}

// Extract a per-bullet text comparison ONLY when the bullet uses the literal
// pattern `"X" vs "Y"` (or `"X" → "Y"`) with double-quoted strings on both
// sides. This is the only shape we can trust to mean "two content strings
// being compared". Anything looser (e.g. backtick `code` quotes) hits false
// positives like file:line, node IDs, component names, CSS class fragments.
// Returns { figma, live } or null.
function extractBulletTextPair(body) {
  const m = body.match(/"([^"]{3,})"\s*(?:vs|→|->)\s*"([^"]{3,})"/i);
  if (!m) return null;
  return { figma: m[1], live: m[2] };
}

// Extract file:line references and Figma node IDs for the metadata row.
function extractRefs(body) {
  const liveRefs = [...body.matchAll(/`([^`]+\.tsx[:0-9-]*)`/g)].map((m) => m[1]);
  const figmaNodes = [...body.matchAll(/Figma `(\d+:\d+|\d+-\d+)`/g)].map((m) => m[1]);
  return { liveRefs, figmaNodes };
}

// Detect "sub-visual" bullets: ones where the concern is something a screenshot
// can't show clearly (font-weight, font-family, line-height, tracking).
// These get a typography-spec card layout instead of thumbnails.
function isSubvisual(body) {
  return /\b(font[- ]?weight|font[- ]?family|line[- ]?height|leading|tracking|letter[- ]?spacing|font[- ]?bold|font[- ]?medium|font[- ]?normal|one notch|weight\s+(?:bold|medium|regular|normal))\b/i.test(
    body
  );
}

// ──────────────────────────────────────────────────────────────────────
// 3a. Per-bullet Figma node export — cached.
//
// Each bullet cites a Figma node (e.g., 233:1834 for the hero headline).
// We fetch that node's PNG export from the Figma REST API and cache it
// under uimatch-results/per-bullet/<node-id>.png. The card uses this
// node-tight image instead of the wider suite-frame's figma.png.

mkdirSync(PER_BULLET, { recursive: true });

const fetchPlan = []; // { nodeId, path }
function planNodeFetch(nodeId) {
  const safe = nodeId.replace(/[:]/g, '-');
  const out = join(PER_BULLET, `${safe}.png`);
  if (existsSync(out)) return out;
  fetchPlan.push({ nodeId, path: out });
  return out;
}

async function flushFetchPlan() {
  if (fetchPlan.length === 0) return;
  if (!FIGMA_TOKEN) {
    console.warn(
      `[build-verify] FIGMA_ACCESS_TOKEN not set — skipping ${fetchPlan.length} per-bullet node exports.`
    );
    return;
  }
  // Batch the image-export call: Figma supports up to ~50 ids per request.
  const ids = fetchPlan.map((f) => f.nodeId);
  const params = new URLSearchParams({
    ids: ids.join(','),
    format: 'png',
    scale: '2',
    use_absolute_bounds: 'true',
  });
  const url = `https://api.figma.com/v1/images/${FIGMA_FILE_KEY}?${params}`;
  let meta;
  try {
    const r = await fetch(url, { headers: { 'X-Figma-Token': FIGMA_TOKEN } });
    if (!r.ok) {
      console.warn(`[build-verify] Figma image API ${r.status}: ${await r.text()}`);
      return;
    }
    meta = await r.json();
  } catch (err) {
    console.warn(`[build-verify] Figma image fetch failed: ${err.message}`);
    return;
  }

  for (const { nodeId, path: outPath } of fetchPlan) {
    // Figma normalizes IDs to colon form in the response.
    const variants = [nodeId, nodeId.replace(/-/g, ':'), nodeId.replace(/:/g, '-')];
    let imgUrl;
    for (const v of variants) {
      imgUrl = imgUrl || meta.images?.[v];
    }
    if (!imgUrl) {
      console.warn(`[build-verify] no image URL for ${nodeId}`);
      continue;
    }
    try {
      const imgResp = await fetch(imgUrl);
      if (!imgResp.ok) {
        console.warn(`[build-verify] image fetch failed ${nodeId}: ${imgResp.status}`);
        continue;
      }
      const buf = Buffer.from(await imgResp.arrayBuffer());
      writeFileSync(outPath, buf);
    } catch (err) {
      console.warn(`[build-verify] image download failed for ${nodeId}: ${err.message}`);
    }
  }
  console.log(`[build-verify] fetched ${fetchPlan.length} per-bullet Figma exports.`);
}

// ──────────────────────────────────────────────────────────────────────
// 3. Image existence per frame.

function evidenceFor(frame) {
  if (!frame) return null;
  const dir = join(RESULTS, frame);
  if (!existsSync(dir)) return null;
  const figma = existsSync(join(dir, 'figma.png')) ? `../uimatch-results/${frame}/figma.png` : null;
  const impl = existsSync(join(dir, 'impl.png')) ? `../uimatch-results/${frame}/impl.png` : null;
  const diff = existsSync(join(dir, 'diff.png')) ? `../uimatch-results/${frame}/diff.png` : null;
  const overlay = existsSync(join(dir, 'overlay.png')) ? `../uimatch-results/${frame}/overlay.png` : null;
  return { figma, impl, diff, overlay };
}

// Companion to evidenceFor() — returns the "fixed branch" capture if available.
function fixedEvidenceFor(frame) {
  if (!frame || !HAS_FIXED) return null;
  const dir = join(RESULTS_FIXED, frame);
  if (!existsSync(dir)) return null;
  const impl = existsSync(join(dir, 'impl.png')) ? `../uimatch-results-fixed/${frame}/impl.png` : null;
  const diff = existsSync(join(dir, 'diff.png')) ? `../uimatch-results-fixed/${frame}/diff.png` : null;
  const overlay = existsSync(join(dir, 'overlay.png')) ? `../uimatch-results-fixed/${frame}/overlay.png` : null;
  return { impl, diff, overlay };
}

// (Per-frame text-diff used to be loaded here from docs/uimatch-text-diff.md
// and stitched into every text card. Removed: the per-frame token soup is too
// coarse — it answers "what's the total content drift in this frame", which
// is rarely what the bullet is asking. Now we only show a per-bullet text
// pair when extractBulletTextPair() finds one in the bullet body itself.)

// ──────────────────────────────────────────────────────────────────────
// 5. Render cards.

function renderCard(bullet) {
  const { id, state, body, note, dispatchedSha, agentSummary, viewport, viewportKind } = bullet;
  const refs = extractRefs(body);
  const frame = pickFrame(body, refs.figmaNodes);
  const kind = classify(body);
  const evidence = evidenceFor(frame);
  const fixedEvidence = fixedEvidenceFor(frame);
  const pair = extractBulletTextPair(body);
  const subvisual = isSubvisual(body);

  // Some suite frames have known-broken evidence:
  //   - 006-impact-stats has no Figma wrapper (numerals are siblings on
  //     the landing artboard), so its figma.png + diff.png compare against
  //     the entire 1728×5392 artboard and produce garbage. Skip them.
  const suiteEvidenceBroken = frame === '006-impact-stats';

  // Plan a per-bullet Figma node export for the FIRST cited Figma node.
  // This dramatically improves Figma evidence quality — instead of a wide
  // suite-frame export, the card shows the specific node the bullet names.
  // Pick the Figma node to fetch:
  //   1. The first node ID cited in the bullet body (most specific).
  //   2. Fallback: the frame's canonical Figma node from FRAME_HINTS.
  //   3. Otherwise null.
  const figmaNodeId = refs.figmaNodes[0] ?? pickFigmaNodeForFrame(body);
  let perBulletFigma = null;
  if (figmaNodeId) {
    planNodeFetch(figmaNodeId);
    const safeId = figmaNodeId.replace(/[:]/g, '-');
    // Prefer the per-bullet ZOOMED export (tight crop around the cited node
    // with surrounding context padding). This gives reviewers a readable view
    // of the divergence instead of the full artboard with a tiny red box.
    // Fall back to the full annotated artboard, then the bare leaf export.
    const zoomPath = join(REPO, 'uimatch-results', 'per-bullet-context', `${safeId}-zoom.png`);
    const contextPath = join(REPO, 'uimatch-results', 'per-bullet-context', `${safeId}.png`);
    if (existsSync(zoomPath)) {
      perBulletFigma = `../uimatch-results/per-bullet-context/${safeId}-zoom.png`;
    } else if (existsSync(contextPath)) {
      perBulletFigma = `../uimatch-results/per-bullet-context/${safeId}.png`;
    } else {
      perBulletFigma = `../uimatch-results/per-bullet/${safeId}.png`;
    }
  }

  const refsRow = `
    <div class="refs">
      ${refs.liveRefs.map((r) => `<code class="live">${esc(r)}</code>`).join(' ')}
      ${refs.figmaNodes.map((r) => figmaNodeLink(r)).join(' ')}
    </div>
  `;

  // Text content row — only when we extracted a clean pair from THIS bullet.
  // Never use the per-frame token soup; it was confusing.
  const pairRow = pair
    ? `
    <div class="textpair">
      <div class="tp-col tp-figma"><div class="tp-h">Figma says</div><div class="tp-val">${esc(pair.figma)}</div></div>
      <div class="tp-col tp-live"><div class="tp-h">Live says</div><div class="tp-val">${esc(pair.live)}</div></div>
    </div>
  `
    : '';

  // Sub-visual bullets (font-weight, line-height, tracking, etc.) get a
  // dedicated typography-spec layout and a small notice — screenshots
  // can't reliably show these.
  const subvisualNotice = subvisual
    ? `<div class="subvisual-note">⚠ Sub-visual divergence — typography-level (font-weight / line-height / tracking). Verify against the cited <code>file:line</code> rather than the screenshot.</div>`
    : '';

  // Pick the Figma image: prefer per-bullet (tight node export) over the
  // suite-frame's wider figma.png. If the suite evidence is broken, the
  // per-bullet fetch is the ONLY trustworthy figma image for this card.
  const figmaImg = perBulletFigma ?? (suiteEvidenceBroken ? null : evidence?.figma) ?? null;

  // Thumbnail strip. Layout cards always show all three; color shows 2;
  // text cards skip thumbnails entirely UNLESS we couldn't extract a pair
  // (then we fall back to thumbnails so the user has something to look at).
  // The Figma thumbnail links DIRECTLY to figma.com (open the node in
  // Figma) instead of opening the PNG, since that's what designers want.
  const figmaHref = figmaNodeId ? figmaUrlForNode(figmaNodeId) : null;
  const fixedImg = fixedEvidence?.impl ?? null;
  // The "Fixed" column label is taken from .ui-check-config.json's live_url
  // so the dashboard reflects whichever port this worktree's dev server uses.
  // Falls back to "Fixed" when no config is present.
  const fixedLabel = LIVE_URL ? `Fixed (${LIVE_URL.replace(/^https?:\/\/[^/]*?(:\d+)?.*$/, '$1') || ''})`.replace('()', '') : 'Fixed';
  let thumbsHtml = '';
  // Render thumbs whenever we have ANY image to show — Figma reference,
  // current-side capture, or post-fix capture. Previously this was gated on
  // `evidence || figmaImg`, which dropped fixed-side images for cards whose
  // current-side uimatch run hadn't completed.
  if (evidence || figmaImg || fixedImg) {
    if (kind === 'color') {
      thumbsHtml = `
        <div class="thumbs thumbs-2">
          ${thumb(figmaImg, 'Figma (node)', figmaHref)}
          ${thumb(fixedImg ?? evidence?.impl, fixedImg ? fixedLabel : 'Live')}
        </div>
      `;
    } else if (kind === 'text' && pair) {
      thumbsHtml = '';
    } else {
      // layout, OR text without an extractable pair.
      // Layout depends on whether we have a fixed-branch capture:
      //   - With fix + current: 3 cols → Figma | Current | Fixed
      //   - With fix only: 2 cols → Figma | Fixed   (was missing — bug fix)
      //   - Without fix, with diff: 3 cols → Figma | Current | Diff
      //   - Without fix, no diff: 2 cols → Figma | Current
      const showDiff = !suiteEvidenceBroken && (evidence?.overlay || evidence?.diff);
      const fixedDiff = fixedEvidence?.diff ?? fixedEvidence?.overlay ?? null;
      if (fixedImg && evidence?.impl) {
        thumbsHtml = `
        <div class="thumbs">
          ${thumb(figmaImg, 'Figma (target)', figmaHref)}
          ${thumb(evidence?.impl, 'Current')}
          ${thumb(fixedImg, fixedLabel)}
        </div>
        ${fixedDiff ? `<div class="thumbs thumbs-1">${thumb(fixedDiff, 'Diff (fixed vs Figma)')}</div>` : ''}
      `;
      } else if (fixedImg) {
        // Three cols when we have a diff PNG: Figma | Fixed live | Diff.
        // Two cols when no diff: Figma | Fixed live.
        thumbsHtml = fixedDiff
          ? `
        <div class="thumbs">
          ${thumb(figmaImg, 'Figma (target)', figmaHref)}
          ${thumb(fixedImg, fixedLabel)}
          ${thumb(fixedDiff, 'Diff (fixed vs Figma)')}
        </div>
      `
          : `
        <div class="thumbs thumbs-2">
          ${thumb(figmaImg, 'Figma (target)', figmaHref)}
          ${thumb(fixedImg, fixedLabel)}
        </div>
      `;
      } else if (showDiff) {
        thumbsHtml = `
        <div class="thumbs">
          ${thumb(figmaImg, 'Figma (node)', figmaHref)}
          ${thumb(evidence?.impl, 'Live (frame)')}
          ${thumb(evidence?.overlay || evidence?.diff, evidence?.overlay ? 'Overlay' : 'Diff')}
        </div>
      `;
      } else {
        thumbsHtml = `
        <div class="thumbs thumbs-2">
          ${thumb(figmaImg, 'Figma (node)', figmaHref)}
          ${thumb(evidence?.impl, 'Live (frame)')}
        </div>
      `;
      }
    }
  }

  const noEvidence =
    !evidence && !figmaImg && !pair
      ? `<div class="no-evidence">No uiMatch evidence available for this bullet (no matching frame in the suite — likely a modal or a section we don't capture yet).</div>`
      : '';

  const fixedBanner = fixedEvidence?.impl
    ? `<div class="fixed-banner">🔧 Fix captured on <code>:3100</code> — compare the rightmost thumbnail against the Figma target.</div>`
    : '';

  const evidenceHtml = subvisualNotice + fixedBanner + pairRow + thumbsHtml + noEvidence;

  return `
    <article class="card card-${kind} state-${state} ${viewportKind ? 'vp-' + viewportKind : ''}" data-id="${id}" data-state="${state}" ${viewportKind ? `data-vp="${viewportKind}"` : ''}>
      <header>
        <span class="badge">${kind}</span>
        <span class="frame">${frame ?? '—'}</span>
        ${viewport ? `<span class="vp-badge vp-${viewportKind}">${viewportKindEmoji(viewportKind)} ${viewport.width}×${viewport.height}</span>` : ''}
        <h3>${id}</h3>
        <span class="status-pill ${dispatchedSha ? 'state-fixed' : ''}" data-pill data-state="${state}">${dispatchedSha ? `fixed @ ${dispatchedSha.slice(0, 7)}` : stateLabel(state)}</span>
      </header>
      <p class="body">${esc(body)}</p>
      ${agentSummary ? `<div class="agent-summary"><div class="as-label">🤖 Agent's interpretation</div><div class="as-body">${esc(agentSummary)}</div></div>` : ''}
      ${refsRow}
      ${evidenceHtml}
      <div class="actions">
        <button data-action="approved" class="btn btn-approve">✅ Approve fix</button>
        <button data-action="retry"    class="btn btn-retry">🔄 Retry</button>
        <button data-action="wont_fix" class="btn btn-wont-fix">❌ Won't fix</button>
        <button data-action="tbd"      class="btn btn-tbd">⏸ TBD</button>
        <button data-action="open"     class="btn btn-open">↺ Reopen</button>
      </div>
      <div class="note-block" ${state === 'tbd' || state === 'retry' || note ? '' : 'hidden'}>
        <label class="note-label">📝 Note <span class="note-hint">(saves on blur or ⌘↵ — visible to Claude on next prompt)</span></label>
        <textarea class="note-input" data-note placeholder="What's blocking this? What needs to happen before it can be approved?" rows="3">${esc(note)}</textarea>
        <div class="note-status" data-note-status></div>
      </div>
    </article>
  `;
}

// Map raw state keys (used in JS / CSS class names) to human-readable
// labels for the UI. Keep this in sync with verify-server.mjs's
// STATE_TO_CHAR keys.
const STATE_LABELS = {
  open: 'open',
  approved: 'approved',
  retry: 'retry',
  wont_fix: "won't fix",
  tbd: 'tbd',
  partial: 'partial',
};
function stateLabel(state) {
  return STATE_LABELS[state] ?? state;
}

function viewportKindEmoji(kind) {
  return ({ mobile: '📱', tablet: '📲', desktop: '🖥', 'desktop-wide': '🖥' })[kind] ?? '🖥';
}

function thumb(src, label, href = null) {
  if (!src) return `<div class="thumb empty">${label}: no image</div>`;
  const linkUrl = href ?? src;
  const linkTitle = href ? 'Click to open in Figma' : 'Click for full size';
  return `
    <a class="thumb" href="${esc(linkUrl)}" target="_blank" title="${esc(linkTitle)}">
      <div class="th-label">${label}</div>
      <img src="${esc(src)}" loading="lazy">
    </a>
  `;
}

// Build a Figma URL for a given node ID — clickable from the dashboard.
// Format: https://www.figma.com/design/<fileKey>/?node-id=<dash-form>
function figmaUrlForNode(nodeId) {
  return `https://www.figma.com/design/${FIGMA_FILE_KEY}/?node-id=${nodeId.replace(/:/g, '-')}`;
}

// Render the small "Figma 233:1834" chip in the refs row as a hyperlink.
function figmaNodeLink(nodeId) {
  return `<a class="figma-link" href="${esc(figmaUrlForNode(nodeId))}" target="_blank" title="Open in Figma"><code class="figma">Figma ${esc(nodeId)} ↗</code></a>`;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ──────────────────────────────────────────────────────────────────────
// 6. Layout the page.

const stateOrder = { open: 0, retry: 1, tbd: 2, partial: 3, wont_fix: 4, approved: 5 };
bullets.sort((a, b) => stateOrder[a.state] - stateOrder[b.state] || a.id.localeCompare(b.id));

const counts = bullets.reduce((acc, b) => ((acc[b.state] = (acc[b.state] ?? 0) + 1), acc), {});

// Render cards FIRST so all planNodeFetch() calls register, then await
// the batched fetch so the per-bullet PNGs exist when the page loads.
const renderedCards = bullets.map(renderCard);
await flushFetchPlan();

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Praveen Artisans · Design Verification</title>
<style>
  :root {
    --bg: #fcf7eb;
    --ink: #221e1f;
    --mute: #6e6664;
    --line: #e4ddcf;
    --yellow: #fece14;
    --green: #128a4e;
    --red: #b21e1e;
    --orange: #d68a00;
    --blue: #1e62b2;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  header.top { position: sticky; top: 0; background: var(--bg); border-bottom: 1px solid var(--line); padding: 16px 24px; z-index: 10; }
  header.top h1 { margin: 0 0 4px; font-size: 20px; }
  header.top .meta { color: var(--mute); font-size: 13px; }
  main { max-width: 1280px; margin: 0 auto; padding: 24px; }
  .filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 24px; }
  .filters button { background: white; border: 1px solid var(--line); padding: 6px 14px; border-radius: 99px; cursor: pointer; font-size: 13px; }
  .filters button.on { background: var(--ink); color: var(--bg); border-color: var(--ink); }
  .filters button .count { color: var(--mute); margin-left: 4px; font-size: 12px; font-variant-numeric: tabular-nums; }
  .filters button.on .count { color: var(--bg); opacity: 0.75; }

  .card { background: white; border: 1px solid var(--line); border-radius: 8px; margin-bottom: 16px; padding: 16px 20px; }
  .card header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 8px; padding: 0; border: 0; position: static; background: transparent; }
  .card h3 { margin: 0; font-size: 18px; font-weight: 700; }
  .card .badge { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; padding: 2px 8px; border-radius: 4px; background: var(--ink); color: var(--bg); }
  .card .vp-badge { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; padding: 2px 8px; border-radius: 4px; margin-left: 4px; font-variant-numeric: tabular-nums; }
  .card .vp-badge.vp-mobile { background: #dbeafe; color: #1e40af; }
  .card .vp-badge.vp-tablet { background: #ede9fe; color: #5b21b6; }
  .card .vp-badge.vp-desktop { background: #f3f4f6; color: #374151; }
  .card .vp-badge.vp-desktop-wide { background: #f3f4f6; color: #374151; opacity: 0.85; }
  .card.card-text .badge { background: var(--blue); }
  .card.card-color .badge { background: var(--yellow); color: var(--ink); }
  .card.card-layout .badge { background: #4a4644; }
  .card .frame { color: var(--mute); font-size: 12px; }
  .card .status-pill { margin-left: auto; padding: 2px 10px; border-radius: 99px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; border: 1px solid var(--line); background: white; }
  .card.state-approved .status-pill { background: #d8f0e0; color: var(--green); border-color: var(--green); }
  .card.state-wont_fix .status-pill { background: #f6dada; color: var(--red); border-color: var(--red); }
  .card.state-retry    .status-pill { background: #ffe4cc; color: #b25e00; border-color: #b25e00; }
  .card.state-tbd .status-pill { background: #fce8c0; color: var(--orange); border-color: var(--orange); }
  .card.state-partial .status-pill { background: #e8e0f0; color: #6a3eaf; border-color: #6a3eaf; }
  .status-pill.state-fixed { background: #d8f0e0; color: var(--green); border-color: var(--green); font-family: ui-monospace, "SF Mono", monospace; font-size: 10px; }

  .card.state-approved { opacity: 0.45; }
  .card.state-wont_fix { opacity: 0.45; }

  .card .body { margin: 8px 0; line-height: 1.55; }
  .card .refs { margin: 8px 0; font-size: 12px; }
  .card .refs code { background: #f4ecdc; padding: 2px 6px; border-radius: 3px; margin-right: 4px; font-size: 11.5px; }
  .card .refs code.figma { background: #fff3c4; }
  .card .refs a.figma-link { text-decoration: none; }
  .card .refs a.figma-link:hover code.figma { background: #ffe491; outline: 1px solid var(--orange); }

  .thumbs { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-top: 12px; }
  .thumbs.thumbs-2 { grid-template-columns: 1fr 1fr; }
  .thumb { display: block; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; background: #fff; text-decoration: none; color: inherit; position: relative; }
  .thumb img { display: block; width: 100%; height: auto; max-height: 320px; object-fit: contain; background: repeating-conic-gradient(#f4eedb 0% 25%, #ebe1d8 0% 50%) 50% / 16px 16px; }
  .thumb.empty { padding: 32px; text-align: center; color: var(--mute); font-size: 13px; }
  .th-label { position: absolute; top: 6px; left: 8px; background: rgba(34,30,31,0.78); color: var(--bg); padding: 2px 8px; font-size: 11px; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.05em; }

  .subvisual-note { background: #fff3c4; border: 1px solid #d68a00; color: #6b3f00; padding: 10px 14px; border-radius: 6px; margin-top: 12px; font-size: 13px; }
  .subvisual-note code { background: rgba(0,0,0,0.06); padding: 1px 6px; border-radius: 3px; font-size: 12px; }
  .fixed-banner { background: #d8f0e0; border: 1px solid var(--green); color: #0a6b3a; padding: 10px 14px; border-radius: 6px; margin-top: 12px; font-size: 13px; }
  .fixed-banner code { background: rgba(0,0,0,0.06); padding: 1px 6px; border-radius: 3px; font-size: 12px; }
  .textpair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
  .tp-col { padding: 12px 14px; border-radius: 6px; border: 1px solid var(--line); }
  .tp-col.tp-figma { background: #fff3c4; }
  .tp-col.tp-live  { background: #f4ecdc; }
  .tp-h { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--mute); margin-bottom: 6px; }
  .tp-val { font-family: ui-monospace, "SF Mono", monospace; font-size: 13.5px; line-height: 1.5; word-break: break-word; }

  .no-evidence { color: var(--mute); padding: 24px; text-align: center; background: #f4eedb; border-radius: 6px; font-style: italic; }

  .agent-summary { margin-top: 10px; padding: 10px 14px; background: #eef4ff; border: 1px solid #c8d8f0; border-radius: 6px; }
  .as-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--blue); font-weight: 600; margin-bottom: 4px; }
  .as-body { font-size: 13px; line-height: 1.55; color: var(--ink); font-style: italic; }
  .note-block { margin-top: 14px; padding: 12px 14px; background: #fef9eb; border: 1px solid #f5d875; border-radius: 6px; }
  .note-block[hidden] { display: none; }
  .note-label { display: block; font-size: 12px; color: var(--ink); margin-bottom: 6px; font-weight: 600; }
  .note-hint { font-weight: 400; color: var(--mute); font-size: 11px; margin-left: 4px; }
  .note-input { width: 100%; min-height: 60px; padding: 8px 10px; border: 1px solid #e0d4a0; border-radius: 4px; background: white; font-family: inherit; font-size: 13px; line-height: 1.5; resize: vertical; box-sizing: border-box; }
  .note-input:focus { outline: 2px solid var(--orange); outline-offset: -1px; border-color: var(--orange); }
  .note-status { font-size: 11px; color: var(--mute); margin-top: 4px; min-height: 14px; }
  .note-status.saved { color: var(--green); }
  .note-status.error { color: var(--red); }

  .actions { display: flex; gap: 8px; margin-top: 16px; }
  .btn { padding: 8px 16px; border-radius: 6px; border: 1px solid var(--line); background: white; cursor: pointer; font-size: 13px; font-family: inherit; }
  .btn:hover { background: #f8f3e3; }
  .btn-approve:hover  { background: #d8f0e0; border-color: var(--green); color: var(--green); }
  .btn-retry:hover    { background: #ffe4cc; border-color: #b25e00; color: #b25e00; }
  .btn-wont-fix:hover { background: #f6dada; border-color: var(--red); color: var(--red); }
  .btn-tbd:hover      { background: #fce8c0; border-color: var(--orange); color: var(--orange); }
  .btn-open:hover     { background: #e0e0e0; }

  .saving { opacity: 0.6; pointer-events: none; }

  /* hide non-matching cards via filter */
  body[data-filter="open"]      .card:not(.state-open)      { display: none; }
  body[data-filter="approved"]  .card:not(.state-approved)  { display: none; }
  body[data-filter="wont_fix"]  .card:not(.state-wont_fix)  { display: none; }
  body[data-filter="retry"]     .card:not(.state-retry)     { display: none; }
  body[data-filter="tbd"]       .card:not(.state-tbd)       { display: none; }

  body[data-vp="mobile"]   .card:not(.vp-mobile)        { display: none; }
  body[data-vp="tablet"]   .card:not(.vp-tablet)        { display: none; }
  body[data-vp="desktop"]  .card:not(.vp-desktop):not(.vp-desktop-wide) { display: none; }

  footer.bottom { padding: 24px; text-align: center; color: var(--mute); font-size: 12px; }
</style>
</head>
<body data-filter="all">
<header class="top">
  <h1>Praveen Artisans · Design Verification</h1>
  <div class="meta">Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · Source: <code>docs/figma-divergences.md</code> § 9 · Evidence: <code>uimatch-results/</code></div>
</header>

<main>
  <div class="filters">
    <button data-filter="all" class="on">All <span class="count" data-count="all">(${bullets.length})</span></button>
    <button data-filter="open">Open <span class="count" data-count="open">(${counts.open ?? 0})</span></button>
    <button data-filter="approved">Approved <span class="count" data-count="approved">(${counts.approved ?? 0})</span></button>
    <button data-filter="retry">Retry <span class="count" data-count="retry">(${counts.retry ?? 0})</span></button>
    <button data-filter="wont_fix">Won't fix <span class="count" data-count="wont_fix">(${counts.wont_fix ?? 0})</span></button>
    <button data-filter="tbd">TBD <span class="count" data-count="tbd">(${counts.tbd ?? 0})</span></button>
    ${counts.partial ? `<button data-filter="partial">Partial <span class="count" data-count="partial">(${counts.partial})</span></button>` : ''}
  </div>
  <div class="filters viewport-filters">
    <button data-vp-filter="all" class="on">All viewports <span class="count">(${bullets.length})</span></button>
    <button data-vp-filter="mobile">📱 Mobile <span class="count" data-vp-count="mobile">(${bullets.filter(b => b.viewportKind === 'mobile').length})</span></button>
    <button data-vp-filter="tablet">📲 Tablet <span class="count" data-vp-count="tablet">(${bullets.filter(b => b.viewportKind === 'tablet').length})</span></button>
    <button data-vp-filter="desktop">🖥 Desktop <span class="count" data-vp-count="desktop">(${bullets.filter(b => b.viewportKind === 'desktop' || b.viewportKind === 'desktop-wide').length})</span></button>
  </div>

  ${renderedCards.join('\n')}
</main>

<footer class="bottom">
  Click ✅ / ❌ / ⏸ TBD to update <code>docs/figma-divergences.md</code> directly via the local server.
  After tagging, tell Claude in chat: <code>fix &lt;ids&gt;</code> for approved bullets.
</footer>

<script>
  // State filter (existing functionality)
  document.querySelectorAll('.filters:not(.viewport-filters) button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filters:not(.viewport-filters) button').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      document.body.dataset.filter = btn.dataset.filter;
    });
  });
  // Viewport filter
  document.querySelectorAll('.viewport-filters button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.viewport-filters button').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      const vp = btn.dataset.vpFilter;
      if (vp === 'all') {
        delete document.body.dataset.vp;
      } else {
        document.body.dataset.vp = vp;
      }
    });
  });

  // Action buttons (approve / reject / tbd / open)
  document.querySelectorAll('.card .actions button').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const card = btn.closest('.card');
      const id = card.dataset.id;
      const action = btn.dataset.action;
      card.classList.add('saving');
      try {
        const res = await fetch('/api/state', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id, state: action }),
        });
        if (!res.ok) throw new Error('server error ' + res.status);
        // Update card state classes
        card.classList.remove('state-open', 'state-approved', 'state-wont_fix', 'state-retry', 'state-tbd', 'state-partial');
        card.classList.add('state-' + action);
        card.dataset.state = action;
        // Pill: when card has a dispatched marker (set on initial render via .state-fixed
        // class on the pill itself, NOT on the card), keep the SHA text. Otherwise show
        // the state label. We reset the pill's .state-fixed class only when the user
        // explicitly Reopens, since other state changes still leave the dispatch marker
        // intact in the markdown — the pill should still say "fixed @ <sha>" until the
        // dashboard rebuild re-parses the doc.
        const pill = card.querySelector('[data-pill]');
        if (action === 'open') {
          pill.classList.remove('state-fixed');
        }
        if (!pill.classList.contains('state-fixed')) {
          pill.textContent = ({open:'open',approved:'approved',retry:'retry',wont_fix:"won't fix",tbd:'tbd',partial:'partial'}[action] ?? action);
        }
        // Reveal/hide the note block based on the new state. Notes always
        // remain visible if there's existing content; if empty, only TBD
        // shows the textarea.
        const nb = card.querySelector('.note-block');
        const noteEl = card.querySelector('[data-note]');
        if (nb) {
          const hasContent = noteEl && noteEl.value.trim().length > 0;
          if (action === 'tbd' || action === 'retry' || hasContent) {
            nb.removeAttribute('hidden');
            if ((action === 'tbd' || action === 'retry') && !hasContent) noteEl?.focus();
          } else {
            nb.setAttribute('hidden', '');
          }
        }
        // Update top counters by reload-counts endpoint
        const c = await fetch('/api/counts').then(r => r.json()).catch(() => null);
        if (c) {
          for (const key of ['open', 'approved', 'retry', 'wont_fix', 'tbd', 'partial']) {
            const el = document.querySelector(\`.filters [data-count="\${key}"]\`);
            if (el) el.textContent = \`(\${c[key] ?? 0})\`;
          }
        }
      } catch (err) {
        alert('Save failed: ' + err.message + '\\nIs the server running? (npm run verify)');
      } finally {
        card.classList.remove('saving');
      }
    });
  });

  // Per-card note textarea — saves on blur or Cmd/Ctrl+Enter.
  document.querySelectorAll('[data-note]').forEach(textarea => {
    const card = textarea.closest('.card');
    const status = card.querySelector('[data-note-status]');
    let lastSaved = textarea.value;

    async function saveNote() {
      const value = textarea.value;
      if (value === lastSaved) return; // no-op
      const id = card.dataset.id;
      status.textContent = 'Saving…';
      status.classList.remove('saved', 'error');
      try {
        const res = await fetch('/api/note', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id, note: value }),
        });
        if (!res.ok) throw new Error('server error ' + res.status);
        lastSaved = value;
        status.textContent = '✓ Saved at ' + new Date().toLocaleTimeString();
        status.classList.add('saved');
      } catch (err) {
        status.textContent = '✗ ' + err.message;
        status.classList.add('error');
      }
    }

    textarea.addEventListener('blur', saveNote);
    textarea.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        saveNote();
      }
    });
  });
</script>
</body>
</html>
`;

writeFileSync(OUT, html);
console.log(`Wrote ${OUT}`);
console.log(`Bullets: ${bullets.length} (open: ${counts.open ?? 0}, approved: ${counts.approved ?? 0}, retry: ${counts.retry ?? 0}, wont_fix: ${counts.wont_fix ?? 0}, tbd: ${counts.tbd ?? 0})`);
