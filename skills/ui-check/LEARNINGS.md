# ui-check scratchpad — 2026-05-10

Running notes on issues hit during the mobile + maker-modal audit. Items here are TODO for the skill/tooling, not for the design fix loop.

## Skill / tooling issues encountered

- **`get_metadata` token cap blew up.** Calling `mcp__plugin_figma_figma__get_metadata` on canvas `233:1119` returned 228k chars and was rejected as "exceeds maximum allowed tokens"; metadata got auto-saved to a `tool-results/` file. Workflow had to delegate jq parsing to a sub-agent. Suggestion: ui-check skill should bake in the "delegate metadata parsing to a sub-agent with jq" pattern, since any non-trivial Figma canvas will hit this cap.
- **Audit-doc append (vs overwrite) is undocumented.** `cold-start.md` Step 4 says to copy `assets/example-audit-doc.md` to `docs/figma-divergences.md`, which would clobber existing content. For "fresh audit re-run" (this case — user wants new findings appended without losing the existing §0–§9), we have to manually skip Step 4 and instruct each audit agent to append a new `## 10.` section. Skill should document this "fresh-audit-on-existing-doc" mode.
- **`build-suite-from-audit.mjs` viewport assumption unknown.** Existing `uimatch-suite.json` is desktop-only (1440×900). Need to verify the auto-builder script picks up mobile Figma node sizes correctly and emits per-viewport entries — otherwise we'll have to hand-edit the suite.
- **Maker modal can't be auto-captured by uimatch.** Modal opens on click; uimatch fetches a static URL. Either (a) need a route like `/maker/:slug` that renders the modal directly, or (b) suite needs a "click selector before screenshot" hook. Currently neither — modal is invisible to uimatch.
- **`agent-browser.mjs` has no `--click` hook.** Audit agents auditing the modal have to write their own one-off Playwright script to click a maker tile before screenshotting. Useful skill enhancement: add `--click <selector>` and `--wait-for <selector>` flags to `agent-browser.mjs` so modal/menu/popover capture is one command.
- **`build-suite-from-audit.mjs` produces desktop-only entries.** Ran it on our audit doc with 44 unique Figma node IDs (mix of mobile `233:3217`, `233:5518` and desktop `233:1120`, `233:2561`). Every emitted suite item got `viewport: {width:1440, height:900}` with `selector: 'body'`. The script doesn't read each Figma node's `absoluteBoundingBox` to infer viewport — it just templates a default. **Result**: even after running uimatch, mobile bullets won't have meaningful evidence (live page captured at 1440px, then diffed against a 402px-wide Figma frame).
- **Suite item naming collisions.** Multiple items emitted with the exact same `name` field (`frame-233-17` appears for both `233:1750` and `233:1751`; `frame-233-58` for `233:5816` and `233:5818`). The dashboard or downstream tooling will likely treat these as duplicates and only render one. Script needs to include the full node ID in `name` (e.g. `frame-233-1750`).
- **Selector inference is "body" for unknown bullets.** All 44 items use `body` unless an existing suite entry already had a selector. The skill mentions `--known-selectors <path>` flag but doesn't document its schema; without it, every uimatch capture is a full-page screenshot diffed against a single Figma node, which yields huge area-gap noise.
- **Mode-A doesn't gracefully handle re-audit on existing doc.** When the doc already has a `## 9.` section and the user wants a fresh audit (our case), the cold-start.md script unconditionally `cp`s `assets/example-audit-doc.md` over the existing doc (Step 4). We had to skip that step manually and seed a `## 10.` heading by hand. Skill needs a "re-audit" mode (Mode D?) that: detects existing audit sections, picks the next letter (`### 10A.`), and only seeds the heading.
- **Known-selectors schema undocumented.** `build-suite-from-audit.mjs --known-selectors <path>` flag exists but the skill docs don't say what JSON shape it expects. Reading the source: it's `{<figma-node-id-with-colon>: <css-selector>}`. Required to make the auto-built suite usable. Skill should ship a starter `known-selectors.json` and document the schema in `cold-start.md`.
- **`build-suite-from-audit.mjs` ↔ `discover-frames.mjs` aren't wired.** `build-suite` reads viewports from `<project>/uimatch-results/per-bullet/<node>.viewport.json`. Those files don't exist on a fresh install. `discover-frames.mjs` knows each frame's width and could populate them, but the cold-start workflow doesn't call it for that purpose. Result: every node falls back to 1440×900 default. Skill needs a script (or a new `--write-viewport-cache` flag on `discover-frames.mjs`) that emits `<node>.viewport.json` files automatically.
- **`discover-frames.mjs` requires `FIGMA_ACCESS_TOKEN`.** Project doesn't have one (uses Figma MCP tools instead). Discovery script is dead-on-arrival without a token. Skill should either: (a) fall back to using the Figma MCP `get_metadata` when no token is set, or (b) document clearly that a token is mandatory before /ui-check can run Mode A or Mode B. Currently `cold-start.md` says "warn the user" but doesn't gate execution on it.
- **No "fresh re-audit" mode in the skill.** Current modes are A (cold-start, requires no doc), B (discovery, looks for new frames), C (fix-loop). What's missing is **Mode D**: existing doc + user wants new findings appended. Workaround used here: hand-seeded `## 10.` heading and instructed agents to append to it. Should be a real mode with its own reference doc.
- **`npm run uimatch:suite:fixed` errors on every item without `FIGMA_ACCESS_TOKEN`.** All 44 suite items failed with: `FIGMA_ACCESS_TOKEN is not set. To compare using URL or fileKey:nodeId format, you must set FIGMA_ACCESS_TOKEN. Alternatively, use figma=current to compare the currently selected node in Figma Desktop (requires MCP server).` The Figma MCP plugin in the Claude session does NOT substitute — uimatch is a separate Node CLI that hits the Figma REST API. Skill cold-start MUST: (a) hard-gate on token presence at Step 1, (b) document `figma=current` MCP fallback in cold-start.md and known-selectors options, (c) print clearly that without a token, you get bullets but no dashboard evidence.
- **`figma=current` fallback is per-item, not per-suite.** uimatch's MCP-fallback `figma=current` requires Figma Desktop with the relevant node selected — only one node at a time. Useless for batch suite runs across 44 items. Skill should document this limitation.
- **Dashboard parser is hardcoded to `## 9.` section.** `scripts/build-verify-dashboard.mjs:51` does `md.split(/^## 9\./m)[1]` — splits on the section heading. **Bullets in a `## 10.` section (or any non-`9.`) are silently invisible to the dashboard.** Fresh-audit bullets we just appended will not render. Either: (a) skill should keep all audits under a single rolling `## 9.` section by date subsection, OR (b) parser should accept any `## N.` section ≥9. This is the biggest functional issue — even with token + uimatch results, our 28 new bullets wouldn't show.
- **Dashboard hardcodes `FIGMA_FILE_KEY` constant.** `build-verify-dashboard.mjs:26` has `const FIGMA_FILE_KEY = 'Fsbd038PdcTTeUVRvhIhuG'` literal. Skill assumes one project = one Figma file forever. Should read from `.ui-check-config.json`.
- **Dashboard requires `FIGMA_ACCESS_TOKEN` too.** Same blocker as uimatch — `process.env.FIGMA_ACCESS_TOKEN` at `:27`. Without it, Figma side of dashboard is empty boxes.
- **Dashboard regex hardcoded to `9[A-D]\.\d+`.** `scripts/build-verify-dashboard.mjs:54` only matches bullet IDs `9A.*` through `9D.*`. Audits that use letters E-Z or numbers (which `audit-bullet-format.md` says are valid: "Sections use `9A`, `9B`, `9C`, `9D`, `9E`, …") are silently dropped. Patched locally to `9[A-Z]\.\d+`. The skill's docs and the dashboard regex must agree — fix in upstream skill.

## What worked end-to-end (after token + patches)

- 3 audit agents → 28 new bullets in §9F / §9G / §9H of `figma-divergences.md` (mobile landing, mobile modal, desktop modal)
- `build-suite-from-audit.mjs` → 44-item uimatch suite with 11 mobile + 33 desktop entries (after seeding `<node>.viewport.json` files + `known-selectors.json`)
- `npm run uimatch:suite:fixed` → 44 captures (39 successful, 5 selector errors — 2 hero form, 3 modal-not-open)
- `npm run verify:build` → dashboard at `http://localhost:4567/` shows 54 bullets across all rounds, 24 fetched per-bullet Figma exports
- `npm run verify:serve` → already running

## Quick wins for the skill (priority order)

1. Fix the dashboard regex hardcode (`9[A-D]` → `9[A-Z]`).
2. Document that `FIGMA_ACCESS_TOKEN` is mandatory; gate execution on it at cold-start Step 1.
3. Add a "fresh re-audit" mode that appends a new `### 9X.` subsection to an existing `## 9.` audit instead of cloning the example doc.
4. Have `discover-frames.mjs --write-viewport-cache` emit `<node>.viewport.json` files so `build-suite-from-audit.mjs` infers viewports correctly without manual seeding.
5. Add a `--click <selector>` + `--wait-for <selector>` to `agent-browser.mjs` for modal/popover capture.
6. Document `--known-selectors` schema (`{<figma-node-id-with-colon>: <css-selector>}`) and ship a starter file.
7. Replace hardcoded `FIGMA_FILE_KEY` constant in `build-verify-dashboard.mjs` with a read of `.ui-check-config.json`.

## Workflow issues hit during fix-loop dispatch (2026-05-10 round 2)

- **Workflow inversion.** User pointed out that `/ui-check` Mode A runs **agent-finds-issues → then uimatch captures evidence**, but the more efficient flow is **uimatch-diffs first → agents only on what diffs flag**. uimatch's DFS / pixel-diff scores already tell us which frames are most off; running agents on every frame is expensive and produces redundant findings (e.g. our 9G.1 desktop portrait could have been caught by a simple width-diff check, no agent needed). Skill should add a Mode where step 1 is "run a low-effort uimatch sweep against the canvas's frames" and step 2 is "dispatch agents only on items with DFS < threshold". Saves ~40% agent-minutes on a typical audit.
- **Dashboard cards don't expose Figma deep-links to the cited node.** Designer asked to "zoom into the specific element" but the dashboard's per-card Figma image is just a static PNG. Each bullet IDs its Figma node; the dashboard card should render `https://www.figma.com/design/<fileKey>/?node-id=<node-id-with-dash>` as a clickable link beside the image. Skill TODO: add this link in `build-verify-dashboard.mjs`.
- **Dashboard cards don't show viewport context.** Several mobile bullets are visually similar to desktop ones at a glance; a "📱 mobile · 402×844" / "🖥 desktop · 1728×900" badge per card would let designer triage faster. The data is already in `<node>.viewport.json` — just unused in the HTML build.
- **Per-bullet Figma exports are at frame size.** When a bullet cites a deep child node (e.g. `233:5786` — a tiny 14px Tm Sun decoration), the cached PNG fetched by `build-verify-dashboard.mjs` is the FRAME image, not the node alone. So designer triaging "is this little sun in the right place?" can't see the sun in isolation. Should fetch per-node renders separately (the Figma export API supports node-id arrays).
- **uimatch suite is shaped for divergences-by-frame, not divergences-by-bullet.** Each suite item is "one frame, one selector" — but a single frame may have 5 bullets cited against different child nodes. uimatch produces 1 diff PNG per frame, which becomes the diff for ALL 5 bullets in the dashboard. Skill should consider switching to "one suite item per bullet" with the bullet's Figma node as the figma=, the closest live element as selector=. Higher cardinality but cleaner per-card evidence.
- **TDD fix-agents need explicit `BASE_URL` override.** Project's `playwright.config.ts` defaults to `:3000`. Worktree dev server runs on `:3100`. Each fix-agent prompt has to repeat `BASE_URL=http://localhost:3100 npx playwright test ...`. Either (a) skill prompt template should bake in the right env, or (b) playwright config should respect a `PLAYWRIGHT_BASE_URL` env so we set it once at session start.
- **Sparse-bullet endpoint not exposed in skill docs.** `/api/agent-summary` is described in `references/agent-dispatch.md` but the URL `http://localhost:4567/api/agent-summary` and JSON shape `{id, summary}` aren't visible in the dashboard UI itself, so a designer triaging won't realize what those summaries mean. Dashboard needs a small "Agent's interpretation" badge near sparse bullets to surface the audit trail.
- **🚨 Port 3100 was already in use by a different worktree.** When I ran `nohup npm run dev` from our worktree earlier, it must have failed silently (port collision), and the `:3100` we've been using all session is actually the `audit-fixes` worktree — a different feature branch. Every screenshot the audit agents captured, every uimatch evidence shot in `uimatch-results-fixed/`, every TDD playwright test the fix-agents ran, and even the dashboard's "fixed" side comparison — **all measured the wrong site.** The MakerGrid fix-agent caught it (its test stayed RED after a correct source change because the live site never matched what the agent edited). This is a critical workflow bug:
  - **Skill prerequisite**: cold-start should run `lsof -i :<port>` and either fail-fast OR pick a free port and write it to `.ui-check-config.json`.
  - **build-suite-from-audit.mjs** should also read live URL from `.ui-check-config.json`, not hardcode `http://localhost:3000` / `:3100` in the suite defaults.
  - **agent prompts**: should pass the actual port that this worktree's dev server is listening on, not assume `:3100`.
  - **Recovery for this session**: kill the stray `:3100` (audit-fixes), start our worktree on a free port (e.g. `:3200` or `:3300`), regenerate uimatch-results-fixed, redispatch the agents whose tests went RED-but-source-was-correct.

## Image-quality issues found during HITL triage (round 2)

A sonnet agent walked every approved card on the dashboard and rated triagability 1-5. Result: **37/37 approved cards score Live=1** (no live screenshot at all) and **~28/37 score Figma=1-2** (isolated atom — a 26px text strip, a 1×15 line, a 61×60 sun icon). Designers and fix-agents are operating blind. Specific patterns:
- Per-bullet Figma exports are at the cited node's bounding box with **zero context padding**. A `233:5727` separator line export is 154 bytes — a 1×15 grey strip floating in white.
- `uimatch-results/` had no frame dirs because the first uimatch run errored on missing token. Every "Live (frame)" slot is the placeholder.
- `uimatch-results-fixed/` does have 44 captures but they don't surface in the dashboard cards because `evidenceFor()` returns null when the *current* (pre-fix) side is missing — fixed-side rendering is gated on current-side existence.

**Fix shipped this session (immediate)**: new script `figma-context-export.mjs` fetches the **parent FRAME** for each cited leaf, draws a labeled red rectangle at the leaf's relative position, saves to `uimatch-results/per-bullet-context/<node>.png`. Dashboard now prefers context PNGs over leaf PNGs. Result: a designer sees the entire mobile modal with a red box on the "AAREY COMMUNITY" label, instead of just the floating text.

**Course correction from user**: "extend uimatch rather than write more new playwright scripts". So the live-context capture (which would require modal-click + bbox overlay) should be a uimatch upstream contribution: `preClickSelector`, `waitForSelector`, `subselector` per bullet, `figmaContextPadding`, and bbox-annotation rendering. Not new `live-context-export.mjs`.

## Decisions to lock in upstream (skill + uimatch + dashboard)

**Skill (~/.claude/skills/ui-check)**
- New script `figma-context-export.mjs` is part of the skill now. Add to `cold-start.md` Step 7.5: "after the audit agents finish, run figma-context-export.mjs to generate per-bullet-context/ PNGs".
- `agent-browser.mjs` extended with `--click <css>` and `--wait-for <css>` flags for modal/popover capture. Document in `agent-dispatch.md`.
- Add **Mode D: fresh re-audit on existing doc**. Detects existing `## 9.` and seeds a new `### 9X.` subsection with a fresh audit run, instead of clobbering.
- Add port-collision check at cold-start. `lsof -i :<port>` then either fail or pick a free port and write back to `.ui-check-config.json`.

**uiMatch (`@uimatch/cli`)**
- Add `preClickSelector` to suite item schema for modal/popover capture.
- Add `subselector` per item for per-bullet narrow captures.
- Add `figmaContextPadding` (e.g. `padding: { top: 0.25, ... }`) so per-bullet Figma exports include surrounding layout instead of node-tight crops.
- Make pass thresholds relative-improvement-aware ("better than baseline by N%") not absolute DFS≥80.

**Dashboard (`build-verify-dashboard.mjs` + `verify-server.mjs`)**
- Bullet ID regex: `9[A-D]\.\d+` → `9[A-Z]\.\d+` (PATCHED LOCALLY, needs upstream).
- Section parser hardcoded to `## 9.` — accept any `## N.` for N ≥ 9.
- Hardcoded `FIGMA_FILE_KEY` constant — read from `.ui-check-config.json`.
- Hardcoded "Fixed (:3100)" label — use the configured live URL.
- Render fixed-side images independently of current-side existence.
- Per-card Figma deep-link is wired (good), per-card LIVE deep-link is missing.
- Surface `<!-- agent-summary: ... -->` HTML comments in the rendered card UI (currently invisible; only sparse-bullet author can see them via the .md file).
- Status pill "fixed @ \<sha\>" should link to the commit in GitHub or `git show`.
- Bulk actions: "approve all in section" / "retry all in section".
- Per-card title is just bullet ID; should include first sentence of body.

## Audit-doc / process issues encountered

- (none yet)

## Figma file structure notes (for future runs)

Canvas `233:1119` "For Dev" contains 13 direct children:
- 3 desktop landing variants (1728×5392 / 1728×3907) — `233:1120`, `233:1835`, `233:2561`. Two share the exact same name "Landing Page Option 1 - Delilah" — needs disambiguation.
- 8 mobile screens (`iPhone 17 - *`, 402px wide). Names are non-semantic ("iPhone 17 - 1", "- 14", "- 17"), so we have to identify them by content (landing, maker modal, search, etc.) before auditing. Numbering is non-sequential.
- 1 stray vector (`233:4690` Arrow) and 1 tiny group (`233:2558` Group 12) — ignore.

No tablet artboards. No separate maker-modal artboard at top level — modal content is its own iPhone artboard.

### Frame catalog (after content identification)

**Landing page**
- `233:1120` — desktop landing, 1728×5392 (used by existing §9 audit)
- `233:1835` — desktop landing, 1728×5392, **canonical** for new audit (most makers populated)
- `233:2561` — desktop **maker modal** (LUEEJA PHILIPS DSOUZA), 1728×3907 — note it's named "Landing Page Option 1 - Delilah" but content is the modal
- `233:3217` — mobile landing, 402×2762, **canonical mobile landing**
- `233:4918` — mobile landing variant with empty grid 2 (broken/WIP state — skip)

**Maker modal — mobile**
- `233:5518` — PRIYA / Aarey Community — real photo, correct text → **canonical mobile modal**
- `233:7191` — AARTI / Creative Handicrafts — real photo
- `233:7755` — BABITA / Pardeshi Community — real photo
- `233:8320` — ABDUL ANSARI / Borivali Community — real photo (only male maker variant)
- `233:6063` — SURESH / Indian Cancer Society — illustrated silhouette + boilerplate copy (skip — broken state)
- `233:6627` — MONICA / Indian Cancer Society — illustrated silhouette + boilerplate (skip — broken state)

### Audit targets chosen

Focusing on user's two priorities:
1. **Mobile breakpoints** → `233:3217` (landing) at 402px viewport
2. **Maker modal (artisan module)** → `233:5518` (mobile modal, canonical) and `233:2561` (desktop modal) — the modal needs both viewports because it's the "still incorrect" thing the user flagged

That's 3 audit-agent dispatches. Manageable in a single wave.
