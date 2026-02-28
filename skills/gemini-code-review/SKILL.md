---
name: gemini-code-review
description: Run a two-pass parallel Gemini code review on a codebase with automatic Claude verification. Invoke with "/gemini-code-review" or when user says "code review with gemini", "gemini review", "full repo review", or wants a comprehensive automated code review. Splits backend and frontend into parallel Gemini invocations, runs two passes (broad sweep then targeted deep-dive), and Claude automatically verifies all findings before presenting results.
---

# Gemini Code Review

Two-pass parallel code review using Gemini CLI's 1M token context, with oracle-aware Claude verification.

## Why This Design

- **Parallel, not combined**: One pass reviewing everything is shallow. Splitting by service forces deeper analysis.
- **Issues, not scores**: Asking for rubric scores produces inflated, hand-wavy results. Asking for specific issues with file:line produces actionable findings.
- **Two passes**: Pass 1 catches the broad issues. Pass 2 targets areas Pass 1 was weak on. Different prompts find different bugs.
- **Oracle-aware verification**: A failing test only proves a bug when a trusted oracle exists. Findings are classified by oracle strength: strong-oracle bugs get test-verified, weak-oracle findings get read-verified, model-inferred expectations are presented as observations — never auto-verified.

## Workflow

### Step 1: Identify Review Targets

Read the project structure (CLAUDE.md, directory layout) to determine service boundaries. Split into 2-4 review targets (e.g., backend, frontend, infrastructure, tools-server).

### Step 2: Pass 1 — Broad Issue Sweep

Launch parallel Gemini reviews as background Bash commands. Read the prompt from [references/pass1-prompt.md](references/pass1-prompt.md) and substitute the `@./path/` references for each target.

```bash
# Example: two parallel reviews
gemini -m gemini-3-pro-preview -p "$(cat references/pass1-prompt.md) @./backend/ @./tools-server/" --output-format json 2>/dev/null &
gemini -m gemini-3-pro-preview -p "$(cat references/pass1-prompt.md) @./frontend/" --output-format json 2>/dev/null &
```

Always run these as **background Bash commands** and collect results with TaskOutput.

### Step 3: Claude Verifies Pass 1 (Oracle-Aware)

For EVERY finding Gemini returns, classify by `oracle_strength` and verify accordingly:

#### 1. Validate oracle metadata

- If `spec_source` is `inferred` but `oracle_strength` is `strong` → **downgrade** to `weak`
- If `confidence_if_fail` is `definite_bug` but `oracle_strength` is `weak`/`none` → **downgrade** to `needs_spec`
- If `runtime_claim` is a design opinion (not observable behavior) → **downgrade** oracle to `none`

#### 2. Verify by oracle strength

**STRONG oracle** (math, crash, security, type violation) + CRITICAL/HIGH/MEDIUM severity:
1. Write a test asserting the `runtime_claim` (see [references/test-templates.md](references/test-templates.md))
2. Run the test
3. If **assertion fails** → **PROVEN DEFECT** (auto-verified, the bug is real)
4. If **test passes** → **FALSE POSITIVE** (drop it)
5. If **test errors** (import/syntax/runtime) → fix the test, retry once. If still errors → read the file manually

**MEDIUM oracle** (framework docs, docstrings) + CRITICAL/HIGH/MEDIUM severity:
1. Write a test asserting the `runtime_claim`
2. Run the test
3. If **assertion fails** → **BEHAVIORAL MISMATCH** (flag: "needs spec check" — could be intentional)
4. If **test passes** → **FALSE POSITIVE** (drop it)

**WEAK/NONE oracle** (inferred, subjective) OR LOW/NIT severity:
1. Read the cited file and line number with the Read tool
2. Confirm the issue exists as described
3. Mark as **OBSERVATION** (not verified, not false positive — presented with low confidence)

#### 3. Critical: distinguishing test failure types

- **Assertion failure** (`expect(x).toBe(y)` fails, `assert x == y` fails) → evidence of the claimed behavior
- **Runtime error** (TypeError, ImportError, syntax error) → test is broken, NOT evidence → fix and retry once
- **Timeout** → inconclusive → fall back to read-and-verify

#### 4. Check for duplicates

Check `gh issue list` — mark duplicates of existing issues.

#### 5. Dispatch strategy

To protect context, dispatch test-writing to **Sonnet subagents per service** (parallel). Each subagent gets:
- The findings for that service
- The test templates from [references/test-templates.md](references/test-templates.md)
- Instructions to write and run tests, return tri-state results

Do NOT present unverified findings to the user.

### Step 4: Pass 2 — Targeted Deep-Dive

Based on Pass 1 gaps, construct a targeted Pass 2 prompt. Read [references/pass2-prompt.md](references/pass2-prompt.md) for the template. Focus on areas Pass 1 was weak:
- If Pass 1 missed tests → ask Pass 2 to focus on test coverage gaps
- If Pass 1 missed security → ask Pass 2 to focus on auth, injection, secrets
- If Pass 1 missed performance → ask Pass 2 to focus on N+1, memory, scaling

Run Pass 2 in parallel the same way as Pass 1.

### Step 5: Claude Verifies Pass 2 (Oracle-Aware)

Same verification as Step 3. Merge with Pass 1 verified findings, deduplicate.

### Step 6: Write Output

Compile all findings into a single markdown file:

```
docs/code-review-YYYY-MM-DD.md
```

Group by verification status, then by severity:

```markdown
## Proven Defects (test-verified)
### CRITICAL
### HIGH
### MEDIUM

## Behavioral Mismatches (needs spec check)
### HIGH
### MEDIUM

## Observations (read-verified, low confidence)
### HIGH
### MEDIUM
### LOW

## False Positives Dropped
(list for transparency)
```

Each finding includes:
- The original finding with file:line
- Verification method used (test / read)
- For test-verified: the test file location and what the test asserts
- For behavioral mismatches: what spec check is needed
- Notes on which are already tracked in GitHub issues

### Step 7: Clean Up Review Tests

After writing the output:
1. Ask the user if they want to **keep** the verification tests (as regression tests) or **remove** them
2. If removing, delete all files/test blocks prefixed with `review-verify` or `test_review_verify_`
3. If keeping, remove the `review-verify` prefix and integrate into the existing test suite

### Step 8: File Issues (if requested)

Check recent issues with `gh issue view` to match the project's existing format. Cross-reference all findings against open issues. Only file genuinely new findings.

When filing, include verification status:
- PROVEN DEFECT → file with high confidence
- BEHAVIORAL MISMATCH → file with "needs spec check" label
- OBSERVATION → only file if user explicitly requests

## Rules

- **NEVER ask Gemini for scores or rubrics** — always ask for specific issues
- **ALWAYS split into parallel reviews** — never send entire repo in one pass
- **ALWAYS use `-m gemini-3-pro-preview`** — never rely on auto-routing
- **ALWAYS use `--output-format json 2>/dev/null`**
- **ALWAYS classify findings by oracle strength** before choosing verification method
- **NEVER auto-verify findings with weak/no oracle** — present as observations
- **NEVER count test errors (import/syntax) as bug confirmation** — only assertion failures count
- **ALWAYS downgrade oracle_strength if spec_source is "inferred"**
- **ALWAYS cross-reference** existing GitHub issues before filing
- **ALWAYS run as background Bash commands** for parallelism
- **ALWAYS dispatch test-writing to Sonnet subagents** to protect orchestrator context
