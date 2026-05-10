# Discovery: Mode B workflow

Loaded by SKILL.md when an audit doc exists AND `discover-frames.mjs` finds new Figma frames not yet referenced by any bullet.

## Step-by-step

### Step 1: Read project config

```bash
cat <project>/.ui-check-config.json
```

Expected: `{figma_file_key, figma_canvas_node_id, live_url}`. If missing, ask the user (and offer to backfill: write the file from their answers).

### Step 2: Discover frames vs current audit

```bash
node ~/.claude/skills/ui-check/scripts/discover-frames.mjs \
  --file-key=<fileKey> --canvas-node=<canvas-node> \
  --audit-doc=<project>/docs/figma-divergences.md \
  > /tmp/ui-check-frames.json
```

Filter the output for `already_covered: false`. If empty, fall through to Mode C (fix loop) — there's nothing new to discover.

### Step 3: Show user the new frames, ask which to audit

```
I see {{N}} new frame(s) in Figma not yet covered by your audit:

  - 233:5518  iPhone 17 - 2     402×1955  mobile
  - 233:6063  iPhone 17 - 14    402×2205  mobile
  - 233:6627  iPhone 17 - 16    402×2205  mobile
  - 233:7191  iPhone 17 - 15    402×2205  mobile

Which would you like to audit now? (Type "all", "none", or comma-separated node IDs)
```

Wait for the answer. Parse:
- "all" → audit every frame
- "none" → fall through to Mode C
- comma-separated IDs → audit only those

### Step 4: Dispatch per-frame audit agents

Same template as cold-start.md Step 5. For section letter, find the highest existing letter in the audit doc (e.g., if § 9 currently ends at `9D`, new sections start at `9E`).

Run in waves of 5 (concurrency cap).

### Step 5: Re-generate suite

```bash
node ~/.claude/skills/ui-check/scripts/build-suite-from-audit.mjs \
  --audit-doc=<project>/docs/figma-divergences.md \
  --output-current=<project>/uimatch-suite.json \
  --output-fixed=<project>/uimatch-suite-fixed.json \
  --file-key=<fileKey>
```

This preserves existing items' hand-edited selectors (see Task 2 spec) and adds new items for the newly-discovered frames.

### Step 6: Re-capture uimatch evidence (optional but recommended)

```bash
cd <project>
npm run uimatch:suite 2>&1 | tail -5
```

(Long: ~30s/frame × N new frames + ~2-3 min for the whole existing suite.)

### Step 7: Report and fall through to Mode C

```
Discovery complete:
  - {{N}} new frame(s) audited
  - {{K}} new bullets appended to audit (§ {{first-new-section}}..§ {{last-new-section}})
  - Suite re-generated with {{M}} new items

Falling through to Mode C (fix loop) — current backlog is now {{total}} bullets.
```

Then proceed to the existing SKILL.md Step 1 (Locate the audit doc → continues from there).
