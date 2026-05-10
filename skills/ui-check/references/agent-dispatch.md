# Agent dispatch: prompt template + parallelization

This file defines the exact shape of the per-cluster Sonnet agent prompt the `ui-check` skill dispatches. Read this when executing step 4 of the SKILL.md workflow.

## Parallelization mechanics

Send ALL Agent tool calls in ONE response. The Agent tool runs each call in a separate worker; calls in the same message are dispatched concurrently. If you write them in sequential responses, they execute one at a time (much slower).

For a project with N clusters, your response contains N Agent invocations. No prose in between (the response model batches them).

**Wave cap: 5 agents per response.** If the cluster count exceeds 5, split into waves. Send the first 5 Agent invocations in one response, await them all, then dispatch the next 5. Reasons:
- Each agent may spawn a Playwright browser (via `agent-browser.mjs`) — chromium is heavy.
- The Anthropic Agent tool implementation parallelizes well at 5; beyond that, throughput plateaus and per-agent latency rises.
- The user's machine is the constraint, not the orchestrating Claude session.

Each Agent invocation uses:

```
subagent_type: "general-purpose"
model: "sonnet"
description: "Fix <cluster-file> divergences"
prompt: <see template below>
```

## Per-agent prompt template

Substitute `{{...}}` placeholders with values from the `parse-bullets.mjs` JSON output for the cluster.

```
You are fixing one or more design-divergence bullets in a single file of the {{project_name}} codebase.

## Where to work

Worktree: {{worktree_root}}
Branch: feature/audit-fixes-batch-1 (assumed already checked out in this worktree)
File you're editing: {{primary_file}}

DO NOT touch the main repo. DO NOT modify docs/figma-divergences.md (designer manages state).

## Project conventions (excerpt — read full CLAUDE.md if needed)

{{abbreviated_claudemd_excerpt}}

## Bullets to fix in this cluster

{{for each bullet in cluster}}
### {{bullet.id}} — state {{bullet.state}}

Body:
{{bullet.body}}

{{if bullet.note}}
Designer note (feedback from prior attempt):
> {{bullet.note}}
{{/if}}

Files cited: {{bullet.live_refs.join(', ')}}
Figma nodes: {{bullet.figma_nodes.join(', ')}}
Viewport: {{bullet.viewport.width}}×{{bullet.viewport.height}} ({{bullet.viewport_kind}})
{{if bullet.frame_size}}Figma frame size: {{bullet.frame_size.width}}×{{bullet.frame_size.height}}{{/if}}

## Visual evidence — READ THESE BEFORE EDITING

Use the Read tool on each path to actually see the images:

- Figma target:  {{bullet.evidence.figma_image}}
- Current live:  {{bullet.evidence.current_image}}
- Diff overlay:  {{bullet.evidence.diff_image}}

(If a path is null, that evidence is unavailable — proceed with body text only.)

{{if bullet.evidence.uimatch_report}}
Measured divergences (uiMatch report):
The uimatch report at {{bullet.evidence.uimatch_report}} contains styleDiffs[] with patchHints[] — concrete CSS property changes uiMatch suggests. Read it as JSON if helpful for sizing/color decisions.
{{/if}}

{{/for}}

## Your job

1. Read all image paths listed above using the Read tool. Do this BEFORE making any edits.
2. Make minimum-viable edits to the cited files in the worktree. One bullet → one set of edits.
3. After ALL bullets in this cluster are fixed:
   - Run `npx tsc --noEmit` from {{worktree_root}}. Fix any errors before committing.
   - Commit ALL bullets in this cluster as a SINGLE commit:
     `git add <files>` then `git commit -m "fix(<scope>): <one-line> ({{bullet_ids_csv}})"`
4. Print the commit SHA on the last line of your response (so the orchestrator can capture it).
5. Report under 100 words: what you changed per bullet, any judgment calls.

## Constraints

- Edit only files cited in the bullets. Don't refactor unrelated code.
- Use semantic Tailwind tokens from {{worktree_root}}/tailwind.config.js — avoid arbitrary `text-[Npx]` when a token exists.
- Don't add font-bold, opacity-*, underline, rounded "for polish" — only when the bullet body explicitly says to.
- Don't push to remote.
- Don't run the dev server.

## MCP escape hatch

If a bullet needs a Figma node not in your evidence packet, you have access to the Figma MCP tools:
  - `mcp__plugin_figma_figma__get_design_context` (returns React+Tailwind reference for a node)
  - `mcp__plugin_figma_figma__get_metadata` (returns node tree without rendering)

Use sparingly — every cached image is faster than an MCP call.
```

## Tools available to the dispatched agent

Each fix-agent has access to:

1. **Read tool** — for reading source files, the cached image paths in the evidence packet, and project conventions.
2. **Edit / Write tools** — for modifying source files in the worktree.
3. **Bash tool** — for running `npx tsc --noEmit`, `git add` / `git commit`, and the bundled helpers below.
4. **Bundled `agent-browser.mjs` Playwright helper** at `~/.claude/skills/ui-check/scripts/agent-browser.mjs`. Use it to verify a fix RENDERED correctly. The script resolves `playwright` by module lookup, so set `NODE_PATH` to the project's `node_modules` before invoking:
   - `NODE_PATH=<project>/node_modules node ~/.claude/skills/ui-check/scripts/agent-browser.mjs screenshot --url http://localhost:3100 --selector <css> --viewport=<bullet.viewport.width>x<bullet.viewport.height> --out /tmp/<bullet-id>-after.png` — element screenshot
   - `NODE_PATH=<project>/node_modules node ~/.claude/skills/ui-check/scripts/agent-browser.mjs style --url http://localhost:3100 --selector <css> --viewport=<bullet.viewport.width>x<bullet.viewport.height>` — computed-style JSON
   - `NODE_PATH=<project>/node_modules node ~/.claude/skills/ui-check/scripts/agent-browser.mjs dom --url http://localhost:3100 --selector <css> --viewport=<bullet.viewport.width>x<bullet.viewport.height>` — outerHTML

   The `--viewport=<W>x<H>` MUST match the bullet's `viewport_kind` and dimensions from the evidence packet — otherwise your self-verification screenshot won't reflect what the user sees on that device.
5. **Figma MCP escape hatch** — if a bullet needs Figma data the cached PNG doesn't show:
   - `mcp__plugin_figma_figma__get_design_context` — returns React+Tailwind reference for a node
   - `mcp__plugin_figma_figma__get_metadata` — returns node tree without rendering
   - `mcp__plugin_figma_figma__get_screenshot` — fresh PNG capture

**Usage order**: cached PNGs (in evidence packet) → agent-browser for self-verification → Figma MCP for new context.

## Sparse-bullet protocol

If the evidence packet sets `needs_description: true`, the bullet body did not cite any `.tsx:NN` reference. The orchestrator picked the bullet anyway because the designer approved it for fix.

**Before editing code:**
1. Read the figma image and current image from the evidence packet.
2. Inspect the relevant React component (start with `LandingClient.tsx`, `MakerGrid.tsx`, `MakerModal.tsx`, `SiteFooter.tsx`).
3. Form a concrete interpretation: what file:line changes, in plain English, in one sentence.
4. POST your interpretation to the dashboard so it's audit-trailed:
   ```bash
   curl -s -X POST -H "content-type: application/json" \
     -d '{"id":"<BULLET_ID>","summary":"<your interpretation>"}' \
     http://localhost:4567/api/agent-summary
   ```
5. THEN make the code change and commit normally.

This way, when the designer reviews the fix, the dashboard shows what you thought you were fixing alongside the visual diff. If your interpretation was wrong, they reject and the next dispatch sees an updated note alongside your old summary.

## Cluster grouping rules

The parser groups bullets by `primary_file`. So bullets `9B.2` and `9B.3` both touching `LandingClient.tsx` end up in the same cluster, dispatched to the same agent.

Why: two parallel agents editing the same file would conflict on `git add` / commit. One agent serializes the edits.

If a cluster has many bullets (>5), still dispatch as one agent — the agent can sequentially edit + commit them all. Don't try to split.

## What to do when an agent reports back

Each agent's last line is the commit SHA. Capture it via the Agent tool's return value. For each bullet ID in that cluster, run:

```bash
node ~/.claude/skills/ui-check/scripts/mark-dispatched.mjs <doc-path> <bullet-id> <sha>
```

Then move on to step 6 in SKILL.md (refresh dashboard).

## Edge cases

- **Agent reports failure**: it commits nothing, returns an error message. Skip the mark-dispatched step for those bullets — they stay `[x]` so the next `/ui-check` invocation will retry. Mention failures in the final summary.
- **Cluster has 1 bullet, that bullet has 0 figma_nodes**: the parser already filtered out bullets with no live_refs, but a bullet may have refs and no Figma node (rare). Dispatch anyway — the agent has the body text + designer note + current live image (no Figma side). It can ask via MCP if needed.
- **Empty clusters**: if `parse-bullets.mjs` returns `bullets: []` and `skipped: []` with no clusters, there's literally nothing to do. Report and exit.

---

## Per-frame audit-agent prompt template (used by Mode A + Mode B)

Used when the orchestrator dispatches an audit-agent to enumerate divergences for one Figma frame. Different from the per-cluster fix-agent template above.

Substitute `{{...}}` placeholders.

```
You are auditing one Figma frame against the corresponding live web app implementation. You identify every concrete divergence and write it as a bullet in the audit doc.

## Frame metadata

- Figma fileKey: {{file_key}}
- Figma node ID: {{frame.node_id}}
- Frame name: {{frame.name}}
- Frame size: {{frame.width}}×{{frame.height}}
- Viewport kind: {{frame.viewport_kind}}
- Live URL: {{live_url}}

## Where to write your findings

Append a new subsection to `{{audit_doc_path}}` § 9 with this heading:

\`\`\`
### 9{{section_letter}}. Frame: {{frame.name}} · {{frame.viewport_kind}}
\`\`\`

Bullet IDs go `9{{section_letter}}.1`, `9{{section_letter}}.2`, etc.

## Format spec — read first

Read `~/.claude/skills/ui-check/references/audit-bullet-format.md` BEFORE writing bullets. Each bullet MUST cite `Figma <node-id>`; SHOULD cite `<file>.tsx:<line>`.

## Your job

1. Call `mcp__plugin_figma_figma__get_design_context` with fileKey={{file_key}} and nodeId={{frame.node_id}} to get Figma's reference code.
2. Use `agent-browser.mjs` to screenshot the live page at the frame's viewport:
   \`\`\`bash
   NODE_PATH={{project_root}}/node_modules node ~/.claude/skills/ui-check/scripts/agent-browser.mjs \
     screenshot --url={{live_url}} --selector=body \
     --viewport={{frame.width}}x{{frame.height}} \
     --out=/tmp/audit-{{frame.node_id_safe}}.png
   \`\`\`
3. Read the screenshot. Optionally also `mcp__plugin_figma_figma__get_screenshot` for the Figma side.
4. Read the relevant React component files in the project. Start from `app/page.tsx`, `app/layout.tsx`, and any `components/*.tsx` that match the frame's content.
5. For each visible divergence, write one bullet appended to the doc under your section heading. Format per the spec.
6. If you cannot find the relevant React file for a divergence, write the bullet with only the Figma node citation. The dispatcher handles sparse bullets.

## Constraints

- Don't edit any source code. This is audit, not fix.
- Don't dispatch other agents.
- Don't push or commit.
- One observation per bullet. Don't bundle.
- No breakpoint labels in bullet bodies (viewport encoded in the cited Figma frame).

## Report

After writing bullets, report under 100 words:
1. Bullet count.
2. Section letter (e.g. "9C: 7 bullets").
3. Anything you couldn't audit and why.
```
