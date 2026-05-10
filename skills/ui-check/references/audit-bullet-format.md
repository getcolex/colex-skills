# Audit bullet format

Strict spec for bullets in `docs/figma-divergences.md` § 9. Loaded by per-frame audit-agents (Mode A bootstrap + Mode B discovery) and the fix-loop dispatcher (Mode C). Conforming bullets round-trip through the dashboard, the parser, and the dispatcher without manual cleanup.

## Bullet line shape

```
- [STATE] **<id>** <description>  [<!-- note: ... -->] [<!-- dispatched: <sha> -->] [<!-- agent-summary: ... -->]
```

One bullet = one line. Multi-line content collapses to a single line in the markdown — render it spaced for readability when generating, but never break the line.

## Required fields

1. **State marker** `[STATE]` — single character inside square brackets:
   - ` ` (space) → open, untriaged
   - `x` → approved, ready for the dispatcher
   - `r` → retry (re-dispatch with note as feedback)
   - `-` → won't fix
   - `?` → TBD (designer pondering)
   - `~` → partial (legacy)

2. **Bullet ID** `**<section><index>.<num>**` — Markdown bold. Sections use `9A`, `9B`, `9C`, `9D`, `9E`, … bumping per audit run or by frame group. Numbers are 1-indexed within a section. Examples: `**9A.1**`, `**9B.7**`.

3. **Description** — plain prose, 1–3 sentences. Reads as "the Figma says X but the live impl shows Y." No emoji, no bold/italic emphasis inside.

4. **`Figma <node-id>` citation** — exactly one per bullet, in the form `` Figma `<node>` `` with backticks. Node ID format: `<file-section>:<index>` (colon) OR `<file-section>-<index>` (dash). Example: `` Figma `233:1834` ``.

   **This is mandatory.** Without it the dispatcher can't infer viewport, fetch the node image, or route the bullet to a frame.

## Optional fields

5. **`<file>.tsx:<line>` citations** — zero or more, each in backticks, each pointing at a React component file in the project. Example: `` `LandingClient.tsx:25` ``. Bullets without these become "sparse" — the agent infers the file from context (see references/agent-dispatch.md sparse-bullet protocol).

6. **HTML comment markers** — appended at end of line by the system (never by the audit-agent):
   - `<!-- note: <designer feedback> -->` — written by the dashboard's textarea via `/api/note`
   - `<!-- dispatched: <commit-sha> -->` — written by `mark-dispatched.mjs` after a fix-agent commits
   - `<!-- agent-summary: <agent's interpretation> -->` — written by `/api/agent-summary` when a sparse bullet's fix-agent infers what to do

## What audit-agents must NOT do

- **No breakpoint labels** in the body. Don't write "(mobile)", "(desktop)", "(tablet)". The viewport is derived from the cited Figma frame's `absoluteBoundingBox`.
- **No subjective severity** like "critical", "minor", "must-fix". State markers carry priority; the dashboard groups by frame and viewport.
- **No bundling** — one observation per bullet. If a frame has 5 issues, that's 5 bullets, not 1 bullet listing 5 things.
- **No editorialising** about whether to fix it. The bullet describes the divergence; designer triages via state markers.

## Section organisation

Within a `## 9.` audit section, group bullets by frame (one subsection per frame):

```
## 9. Audit run — 2026-05-15

### 9A. Frame: Landing Page Option 1 - Delilah · desktop-wide

- [ ] **9A.1** Hero headline reads "Here is the dream of the person who made your bag." in Bayard 64px in Figma; the live impl uses three forced `<span class="block lg:inline">` wrappers, breaking it into 3 visible lines on mobile-default font sizing. (`LandingClient.tsx:93-95`, Figma `233:1834`)
- [ ] **9A.2** ...

### 9B. Frame: iPhone 17 - 14 · mobile

- [ ] **9B.1** Maker modal yellow nav bar shows "HOME / TINY MIRACLES" centered (10px PP Neue Bold uppercase) at top in Figma; live impl renders the global SiteHeader instead. (`MakerModal.tsx:40`, Figma `233:5726`)
- [ ] **9B.2** ...
```

The frame name comes from the Figma node's `.name` field. The viewport classification (`desktop-wide`, `mobile`, etc.) comes from `absoluteBoundingBox.width`:

| Figma frame width | viewport_kind |
|---|---|
| ≤ 599 px | mobile |
| 600 – 1023 px | tablet |
| 1024 – 1599 px | desktop |
| ≥ 1600 px | desktop-wide |

This subsection heading is for human navigation only — the dispatcher reads `Figma <node>` from the bullet body itself.

## Cross-frame bullets

If a divergence appears in multiple Figma frames (e.g. the same footer error on desktop AND mobile), file ONE bullet per frame. Each cites its frame's specific node ID. The dispatcher dispatches them as separate work items because viewport differs.
