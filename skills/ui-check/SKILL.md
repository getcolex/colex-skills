---
name: ui-check
description: Dispatch parallel Sonnet agents to fix approved design-divergence bullets from a HITL audit doc (figma-divergences.md / uitrace-style). Each agent gets visual evidence — Figma node PNG, current live PNG, diff PNG — to read before editing. Updates the existing dashboard at :4567 to mark fixes attempted. Use when the user says "ui-check", "uitrace", "verify design fixes", "dispatch fixes from divergence doc", "fix approved divergences", or after they triage divergences in the dashboard. Idempotent — only acts on bullets marked [x] approved (first dispatch) or [r] retry (re-dispatch with designer note as feedback). Skips [-] won't-fix and bullets already dispatched at a recorded SHA. Also handles cold-start (no audit doc → bootstraps via Figma MCP) and discovery (new Figma frames in your dev canvas → appends new bullets). Auto-detects which mode to run based on project state.
---

# ui-check

Orchestrates the **fix** half of a HITL design-divergence audit:

```
designer triages dashboard (✅/❌/⏸ + notes)
         ↓
   /ui-check           ← this skill
         ↓
parses figma-divergences.md
         ↓
clusters approved + rejected bullets by file
         ↓
dispatches one Sonnet agent per cluster, in parallel,
each with: bullet body, designer note, project conventions,
3 image paths to Read before editing
         ↓
agents commit fixes in worktree
         ↓
skill marks each bullet `<!-- dispatched: <sha> -->`
         ↓
runs `npm run verify:refresh` to capture new evidence
         ↓
designer reloads dashboard, reviews, ✅/❌ next round
```

The skill is **idempotent**: re-running with no state changes is a no-op. The single source of truth is `docs/figma-divergences.md` — no sidecar files, no separate dispatch log. State markers (`[x]`, `[-]`, `[?]`) and inline HTML comments (`<!-- note: ... -->`, `<!-- dispatched: <sha> -->`) carry everything.

## Required workflow

### Step 0 — Detect mode

Decide which mode to run based on disk state. The same `/ui-check` invocation handles all three.

```bash
# Audit doc check
AUDIT_DOC=$(find . -maxdepth 3 -name "figma-divergences.md" -not -path "*/node_modules/*" 2>/dev/null | head -1)

# If no audit doc → Mode A (bootstrap)
if [ -z "$AUDIT_DOC" ] || ! grep -q "^## 9\." "$AUDIT_DOC" 2>/dev/null; then
  echo "MODE_A"; exit 0
fi

# Audit doc exists. Read project config (if present) and discover frames.
CONFIG="$(dirname $(dirname $AUDIT_DOC))/.ui-check-config.json"
if [ -f "$CONFIG" ]; then
  FILE_KEY=$(python3 -c "import json; print(json.load(open('$CONFIG'))['figma_file_key'])")
  CANVAS=$(python3 -c "import json; print(json.load(open('$CONFIG'))['figma_canvas_node_id'])")
  NEW_COUNT=$(node ~/.claude/skills/ui-check/scripts/discover-frames.mjs \
    --file-key="$FILE_KEY" --canvas-node="$CANVAS" --audit-doc="$AUDIT_DOC" \
    | python3 -c "import sys, json; d=json.load(sys.stdin); print(sum(1 for f in d.get('frames',[]) if not f.get('already_covered')))" 2>/dev/null)
  if [ "$NEW_COUNT" -gt 0 ]; then
    echo "MODE_B (${NEW_COUNT} new frames)"; exit 0
  fi
fi

# Default: existing audit, no new frames → fix loop
echo "MODE_C"; exit 0
```

Branch on the result:
- **MODE_A** → load `references/cold-start.md` and follow the workflow there. Do NOT proceed to Step 1 below until cold-start finishes.
- **MODE_B** → load `references/discovery.md` and follow the workflow there. After discovery completes, fall through to Step 1.
- **MODE_C** → continue to Step 1.
- **MODE_D** → triggered when the user says "re-audit" or "fresh audit" with an existing `## 9.` section. Load `references/re-audit.md`. Appends a new `### 9X.` subsection without clobbering existing content.

If `.ui-check-config.json` doesn't exist but the audit doc does, treat as MODE_C — the project pre-dates the config file (no discovery available, but the existing fix loop still works).

When dispatching from a doc that has approved (`[x]`) bullets *without* `<!-- dispatched: <sha> -->` markers (e.g. fixes shipped before the skill existed), pass `--skip-pre-existing-fixed` to `parse-bullets.mjs` so those legacy items aren't redispatched as if they were new approvals.

### Step 1 — Locate the audit doc

If the doc isn't already in conversation context, locate it:

```bash
# Try the common path first.
ls docs/figma-divergences.md 2>/dev/null

# Fallback: search the project root.
find . -name "figma-divergences.md" -not -path "*/node_modules/*" -not -path "*/.next/*" 2>/dev/null | head -3
```

If multiple match, use the one in `docs/`. If none match, **ask the user** for the path. Do not invent one.

### Step 2 — Parse the doc into an evidence packet

Run the bundled parser:

```bash
node ~/.claude/skills/ui-check/scripts/parse-bullets.mjs <doc-path>
```

Output is a JSON object with:
- `bullets[]` — actionable items (state `[x]` first dispatch or `[r]` retry, with refs + evidence paths resolved)
- `skipped[]` — bullets the parser deliberately won't dispatch (already dispatched, no refs found)
- `clusters{}` — bullets grouped by primary `.tsx` file (one agent per cluster)

If `bullets[]` is empty:

```
✓ No actionable bullets to dispatch.
  Skipped:
    - 9B.4: already dispatched at abc1234 — awaiting designer verification
    - ...
```

Stop here. The loop is at rest.

### Step 3 — Verify dashboard server is running

The fix loop assumes `http://localhost:4567/` is the verify dashboard. Quick check:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:4567/ --max-time 3
```

If not 200: tell the user `npm run verify:serve` (in their project root) before continuing. Do NOT start the server yourself — the user controls when it runs.

### Step 4 — Dispatch one Sonnet agent per cluster, in PARALLEL (max 5 per wave)

For each entry in `clusters`, dispatch ONE agent. Use a single Agent tool call response that contains multiple Agent invocations (parallel dispatch — see references/agent-dispatch.md for the exact prompt template and parallelization mechanics).

**Critical**: send ALL Agent calls in one response, not sequential ones. Sequential dispatch breaks parallelism.

**Concurrency cap: 5 agents per wave.** If more than 5 clusters exist, dispatch in waves of 5: clusters 0–4 first, wait for the wave to complete, then 5–9, etc. The cap protects the user's machine from too many parallel Chromium / Node processes (each fix-agent may spawn a Playwright browser via the bundled `agent-browser.mjs` tool).

The cluster's bullets share a file, so the agent fixes them together. Each agent:
- Reads the 3 image paths first (Figma target, current live, diff overlay) using its Read tool
- Edits the cited files in the worktree path (`<project>/.claude/worktrees/audit-fixes/`)
- Runs `npx tsc --noEmit` from the worktree
- Commits with format `fix(<scope>): <one-line> (<bullet-ids>)`
- Reports back the commit SHA

Use `subagent_type: "general-purpose"` and `model: "sonnet"` for these dispatches (cheap + visual-capable; Opus is overkill for mechanical fixes).

### Step 5 — Mark each fixed bullet dispatched

After each agent reports its commit SHA, update the doc:

```bash
node ~/.claude/skills/ui-check/scripts/mark-dispatched.mjs <doc-path> <bullet-id> <sha>
```

Run once per bullet (an agent fixing 3 bullets in one cluster runs the marker 3 times with the same SHA). Preserves any existing `<!-- note: ... -->`.

### Step 6 — Refresh the dashboard

```bash
cd <project-root>
npm run verify:refresh
```

This re-captures fixed-side evidence (`uimatch-results-fixed/`) and rebuilds `docs/verify.html`. Designer reloads `http://localhost:4567/` and reviews.

### Step 7 — Report

One short summary:

```
Dispatched 4 clusters covering 9 bullets. Skipped 3 (already dispatched).
  components/MakerGrid.tsx     [9B.2, 9B.3]   → fix(grid): … (a1b2c3d)
  components/MakerModal.tsx    [9B.6, 9B.10]  → fix(modal): … (e4f5g6h)
  components/SiteFooter.tsx    [9B.13, 9B.14] → fix(footer): … (i7j8k9l)
  components/SearchByName.tsx  [9B.15]        → fix(hero): … (m1n2o3p)

Refreshed dashboard at http://localhost:4567/. Reload to verify.
```

## What the user does next

The user reloads the dashboard. For each card with a "Fix captured" banner:
- Looks at Figma vs Fixed columns side-by-side.
- If correct → does nothing (state stays `[x]`, `<!-- dispatched: sha -->` is the receipt).
- If wrong, want another attempt → clicks 🔄 Retry (state → `[r]`) and writes a textarea note explaining what's still wrong. The next `/ui-check` invocation re-dispatches the bullet with that note as feedback.
- If the divergence shouldn't ship at all → clicks ❌ Won't fix (state → `[-]`). The dispatcher silently skips it on every future invocation.

This is the loop. It converges as bullets stay `[x]` after a round.

## Notes

- **Sub-agents inherit MCP access from the parent session.** The Figma MCP server must be configured at session start (`claude mcp list` should show `plugin:figma:figma` connected). When dispatched, fix-agents can call `mcp__plugin_figma_figma__get_design_context`, `get_metadata`, or `get_screenshot` directly.

  **Usage policy:** prefer cached PNGs in `<project>/uimatch-results/per-bullet/<node-id>.png` first — they're instant. Only call the Figma MCP when the cached image is insufficient (e.g., you need text content of a node uiMatch didn't capture, or the cached image is stale because the Figma file was edited recently). Each MCP call adds ~5-10 seconds of latency.
- **Sub-agents also have access to a bundled Playwright helper.** Run `NODE_PATH=<project>/node_modules node ~/.claude/skills/ui-check/scripts/agent-browser.mjs <screenshot|style|dom> --url <url> --selector <css> [...]` to capture a screenshot, dump computed styles, or read outerHTML of a CSS selector against the live URL (e.g., `http://localhost:3100` for the fixed branch). Use this AFTER making a code change to verify the fix rendered as expected before reporting back to the orchestrator.
- **Cached Figma node PNGs** live at `<project>/uimatch-results/per-bullet/<node-id-with-dash>.png`. The parser's evidence resolver checks existence and only includes paths that exist on disk.
- **Frame-to-Figma-node mappings** are duplicated inside `scripts/parse-bullets.mjs` (mirroring the dashboard's `NODE_TO_FRAME` and `FRAME_HINTS`). When the project's mappings change, update both.
- **Worktree assumption**: agents commit to `.claude/worktrees/audit-fixes/`. The parser auto-detects this; if absent, falls back to project root. The user is expected to have created this worktree once with `git worktree add -b feature/audit-fixes-batch-1 .claude/worktrees/audit-fixes`.
- **Markdown editing safety**: never edit `figma-divergences.md` from prose Bash commands — always use the bundled `mark-dispatched.mjs`. The markdown has structured comments (`<!-- note: -->`, `<!-- dispatched: -->`) the dashboard parses; ad-hoc edits can corrupt them.
- **Designer sees the receipt**: the dashboard's parser already understands `<!-- dispatched: ... -->` markers. If a dashboard rebuild surfaces new bullet states that don't match expectation, regenerate by re-running step 6.

For the exact prompt template and per-agent packet structure, see [references/agent-dispatch.md](references/agent-dispatch.md).
