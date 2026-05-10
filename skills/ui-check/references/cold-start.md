# Cold-start: Mode A workflow

Loaded by SKILL.md when no `docs/figma-divergences.md` exists in the project (or it has no `## 9.` section). Walks the user through bootstrapping their first audit.

## Required prerequisites

1. The user has `mcp__plugin_figma_figma__*` tools available in the session (Figma MCP is configured at session start).
2. `FIGMA_ACCESS_TOKEN` is set in env (the script falls back gracefully without it; warn the user).
3. The live web app is running at some URL (e.g. `http://localhost:3000`).
4. The verify-server should ideally be running on `:4567` for post-audit triage; if not, advise the user to `npm run verify:serve` after audit completes.

## Step-by-step

### Step 1: Ask the user three questions, one at a time

Do NOT batch the questions. Ask one, wait for the answer, ask the next.

1. **"What's your Figma file URL or fileKey?"** Accept either:
   - A URL like `https://www.figma.com/design/Fsbd038PdcTTeUVRvhIhuG/Made-By-Tiny-Miracles?node-id=...` → extract fileKey from the path segment after `/design/` or `/file/`
   - A bare fileKey like `Fsbd038PdcTTeUVRvhIhuG`

2. **"What's the canvas/page node ID containing your ready-for-dev frames?"** Usually the user has a "For Dev" or "Production" page. Accept node IDs in either form (`233:1119` or `233-1119`). If the user pastes a Figma URL again, extract `node-id` from query params and convert dashes to colons.

3. **"What's the live URL of the running site?"** e.g. `http://localhost:3000`. Validate that it returns 200 with `curl -s -o /dev/null -w "%{http_code}" <url> --max-time 5`. If not, ask: "I can't reach <url> — is the dev server running?" before proceeding.

   **Critical**: if the user is in a git worktree and another worktree has a dev server running, port collisions are silent (`nohup npm run dev` will print `port: <N>` regardless of whether the bind succeeded). Before accepting the live URL:
   ```bash
   PORT=$(node ~/.claude/skills/ui-check/scripts/find-free-port.mjs <starting-port>)
   ```
   If the user-supplied port is already in use, `find-free-port.mjs` returns the next free port. Confirm with the user: "Port :3000 is in use by another process. I'll use :$PORT for this worktree's dev server. OK?"

   Then verify the URL actually serves THIS worktree by checking process cwd:
   ```bash
   PID=$(lsof -i :$PORT -sTCP:LISTEN -nP -t | head -1)
   lsof -p "$PID" -a -d cwd | tail -1
   ```
   The cwd path should match the user's project root. If it doesn't, the URL points at a different worktree and any uimatch capture will measure the wrong site.

### Step 2: Save config to project root

After all three questions are answered, write `.ui-check-config.json` to the project root:

```bash
cat > <project>/.ui-check-config.json <<EOF
{
  "figma_file_key": "<fileKey>",
  "figma_canvas_node_id": "<canvas-node>",
  "live_url": "<live-url>",
  "bootstrapped_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
```

This file is what Mode B (discovery) reads on subsequent invocations to skip the Q&A.

### Step 3: Discover child frames

```bash
node ~/.claude/skills/ui-check/scripts/discover-frames.mjs \
  --file-key=<fileKey> --canvas-node=<canvas-node> \
  > /tmp/ui-check-frames.json
```

Inspect the output. Expected: `frames[]` array with each child frame's `node_id`, `name`, `width`, `height`, `viewport_kind`. If `ok: false`, abort and tell the user the error.

### Step 4: Seed the audit doc skeleton

Copy the bundled example to the project (does NOT exist yet — that's why we're in cold-start mode):

```bash
mkdir -p <project>/docs
cp ~/.claude/skills/ui-check/assets/example-audit-doc.md <project>/docs/figma-divergences.md
```

The example doc has demo bullets. They get overwritten by the per-frame agents in step 5, so they're a placeholder, not real content.

### Step 5: Dispatch one audit-agent per frame, in waves of 5

For each frame in `frames[]`, prepare an audit-agent prompt (template below). Dispatch in waves of 5 — same concurrency rule as the existing fix-loop.

**Per-frame audit-agent prompt template:**

```
You are auditing one Figma frame against the corresponding live React/Next.js implementation. You will identify every concrete divergence and write it as a bullet in the audit doc.

## Frame metadata

- Figma fileKey: {{file_key}}
- Figma node ID: {{frame.node_id}}
- Frame name: {{frame.name}}
- Frame size: {{frame.width}}×{{frame.height}}
- Viewport kind: {{frame.viewport_kind}}
- Live URL: {{live_url}}

## Bullet section to use

Write your findings into a new subsection of `<project>/docs/figma-divergences.md` § 9, with the heading:

\`\`\`
### 9{{section_letter}}. Frame: {{frame.name}} · {{frame.viewport_kind}}
\`\`\`

Use bullet IDs `9{{section_letter}}.1`, `9{{section_letter}}.2`, etc. Pick `{{section_letter}}` so it doesn't collide with existing sections — start at `A` if this is the first audit.

## Format spec — read this BEFORE writing bullets

`~/.claude/skills/ui-check/references/audit-bullet-format.md`

The spec is short and strict. Each bullet MUST cite `Figma <node-id>` (mandatory). Each bullet SHOULD cite `<file>.tsx:<line>` when you can identify the relevant React component.

## Your job

1. Call `mcp__plugin_figma_figma__get_design_context` with `fileKey={{file_key}}` and `nodeId={{frame.node_id}}` to get the Figma design's React+Tailwind reference code.
2. Use `agent-browser.mjs` to capture the live page at the matching viewport:
   \`\`\`bash
   NODE_PATH=<project>/node_modules node ~/.claude/skills/ui-check/scripts/agent-browser.mjs \
     screenshot --url={{live_url}} --selector=body \
     --viewport={{frame.width}}x{{frame.height}} \
     --out=/tmp/audit-{{frame.node_id}}.png
   \`\`\`
   Then `Read` the screenshot to see the current state.
3. Optionally call `mcp__plugin_figma_figma__get_screenshot` for the Figma image to compare side-by-side.
4. Read the relevant React components in the project (start with files referenced in `app/page.tsx` or `app/layout.tsx`). For each visible divergence between Figma and live impl, write one bullet.
5. Append your bullets to `<project>/docs/figma-divergences.md` § 9 under the heading shown above. Do NOT modify any other section.
6. If you cannot find the relevant React file for a divergence, write the bullet anyway with only the `Figma <node-id>` citation (no file:line). The dispatcher handles "sparse" bullets.

## Constraints

- Don't edit any source code. This is an audit, not a fix.
- Don't dispatch other agents.
- Don't push or commit; the orchestrator handles state.
- One observation per bullet. Don't bundle.
- No breakpoint labels in bullet bodies — viewport is encoded in the Figma node citation.

## Report

After writing your bullets, report under 100 words:
1. How many bullets you wrote.
2. Frame name + your section letter (e.g. "9C: 7 bullets").
3. Anything you couldn't audit and why.
```

### Step 6: Auto-generate the suite config

After all per-frame audit agents finish:

```bash
node ~/.claude/skills/ui-check/scripts/build-suite-from-audit.mjs \
  --audit-doc=<project>/docs/figma-divergences.md \
  --output-current=<project>/uimatch-suite.json \
  --output-fixed=<project>/uimatch-suite-fixed.json \
  --file-key=<fileKey>
```

### Step 7: Capture initial uimatch evidence

Run uimatch suite once to populate `uimatch-results/`:

```bash
cd <project>
npm run uimatch:suite 2>&1 | tail -10
```

(If `npm run uimatch:suite` doesn't exist in the project, the user needs to add it to package.json — link them to the example npm scripts in the praveen-artisans repo.)

### Step 8: Report and hand off

Report to the user:

```
Audit complete:
  - {{N}} bullets across {{M}} frames
  - {{X}} mobile, {{Y}} tablet, {{Z}} desktop bullets
  - Audit doc: <project>/docs/figma-divergences.md
  - Suite config: <project>/uimatch-suite.json (auto-generated)
  - Verify dashboard: http://localhost:4567 (run `npm run verify:serve` if not running)

Next: open the dashboard, triage bullets by clicking ✅/🔄/❌/⏸ per card,
then re-run /ui-check to dispatch fixes.
```

After bootstrap completes, the next `/ui-check` invocation falls through to Mode B (discovery) or Mode C (fix loop) automatically.
