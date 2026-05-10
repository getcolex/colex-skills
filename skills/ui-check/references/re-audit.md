# Mode D: fresh re-audit on an existing audit doc

Loaded when the user says "re-audit", "fresh audit", or otherwise asks for a new pass on a doc that already has a `## 9.` section. Cold-start (Mode A) would clobber the existing audit doc — use this workflow instead.

## When to use

- User wants new findings on a *specific* set of frames (e.g. "we never covered mobile breakpoints, audit those")
- User wants to verify whether already-shipped fixes regressed
- A previous audit doc exists with `## 9.` and the user wants new findings *appended* not replacing

## Step-by-step

### Step 1: confirm the targeted frames

Ask the user **once**: "Which frames do you want re-audited? Paste Figma URLs or node IDs, or describe (e.g. 'mobile landing + maker modal')."

Resolve to specific Figma node IDs. If the user describes by content rather than ID, query `mcp__plugin_figma_figma__get_metadata` against the canvas to enumerate top-level frames, then pick by name match.

### Step 2: pick the next available `9X.` letter

```bash
EXISTING_LETTERS=$(grep -oE '^### 9[A-Z]\.' <project>/docs/figma-divergences.md | sort -u)
```

Find the next free letter alphabetically (skip ones already used). Common starting state for an active project: `9A`, `9B`, `9C`, `9D` used → next free is `9E`.

### Step 3: seed the §9X. wrapper

Append (don't overwrite) to `<project>/docs/figma-divergences.md`:

```markdown

### 9X. Audit re-run — YYYY-MM-DD (focus area)

Source: targeted re-audit against Figma file `<fileKey>`, canvas `<canvasNode>`. Focus: <one-line scope>.

<!-- per-frame audit-agents append their bullets to subsections (### 9Y., ### 9Z., ...) below -->
```

### Step 4: dispatch one audit agent per targeted frame, in waves of 5

Use the per-frame audit-agent prompt template from `references/agent-dispatch.md` (the second template at the bottom of that file), but with two adjustments:

- **Heading**: instead of `### 9{section_letter}.`, instruct the agent to use `### 9{section_letter+N}.` so new subsections sit alongside §9A, §9B, etc., e.g. `### 9F. Frame: iPhone 17 - 1 · mobile`.
- **Skip-already-filed rule**: tell the agent "DO NOT re-file divergences that already exist as bullets in §9A–§9D — assume those are tracked".

### Step 5: continue to Step 6+ of SKILL.md (suite + dashboard refresh)

After agents append their bullets, fall through to the standard fix-loop pipeline: `figma-context-export.mjs`, `build-suite-from-audit.mjs`, `npm run uimatch:suite:fixed`, `npm run verify:build`. The dashboard's bullet-id regex must accept any `9[A-Z]\.\d+` (newer dashboard versions handle this; older ones hardcode `9[A-D]` — fix locally if needed).

## Common gotchas

- **Don't clobber the doc.** Mode A's "cp example-audit-doc.md docs/figma-divergences.md" is wrong here. The existing audit doc is the canonical state.
- **Bullets across rounds share state markers.** A `[x]` from §9B (pre-existing fix) and a `[x]` from §9F (new fix) are both "approved"; the dispatched-marker convention is what distinguishes them. If §9B bullets lack `<!-- dispatched: -->` markers, run `parse-bullets.mjs` with `--skip-pre-existing-fixed` to avoid redispatching them.
- **Section heading parity.** The verify dashboard's bullet regex must accept `9[A-Z]\.\d+` (some versions hardcode `9[A-D]` and silently drop §9E+ bullets — patch locally if needed).
