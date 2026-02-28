---
name: tdd-plan-executor
description: |
  Execute implementation plans using TDD with Gemini review and sonnet subagents.
  Orchestrates a 7-step process: Gemini reviews the plan, sonnet agents write failing
  tests (RED), you review the tests for correctness, sonnet agents implement (GREEN),
  you verify, Gemini reviews the diff, you fix issues, then commit. Use when:
  (1) User provides a plan file to execute (e.g., "execute this plan", "implement this plan")
  (2) User says "run the plan", "TDD plan", or references a plan document
  (3) After a plan has been written with superpowers:writing-plans or similar
  Requires: gemini CLI installed, plan file with per-task details (files, test code, implementation)
---

# TDD Plan Executor

Execute implementation plans with strict TDD, sonnet subagents for speed, and Gemini for review.

**Announce:** "I'm using the TDD plan executor to implement this plan."

## Related Skills

| Skill | Relationship |
|-------|-------------|
| `superpowers:writing-plans` | Creates the plan file this skill consumes. Use it first. |
| `superpowers:test-driven-development` | The underlying TDD methodology. This skill applies it via sonnet agents. |
| `gemini-sidekick` | Gemini CLI invocation details. This skill uses Gemini for reviews. |
| `superpowers:finishing-a-development-branch` | Use AFTER this skill completes to handle merge/PR. |
| `superpowers:executing-plans` | **Do NOT use alongside this skill.** This skill replaces it with a TDD+Gemini workflow. |

## Prerequisites

- A plan file with per-task details: files to modify, test code, implementation code
- `gemini` CLI installed (`npm install -g @google/gemini-cli`)
- Project test command known (check CLAUDE.md or Makefile)

## The Process

### Step 1: Gemini Reviews the Plan

Send the plan file AND all source files referenced in it to Gemini for review.

```bash
gemini -m gemini-3-pro-preview -p "Review this implementation plan. Check:
1. Will the RED-phase tests fail for the right reasons?
2. Are the implementations minimal and correct?
3. Any risks, gaps, or edge cases?
4. Are there architectural issues (e.g., Rules of Hooks, invalid HTML)?

Plan: @path/to/plan.md

Source files:
@path/to/file1.ts
@path/to/file2.jsx
..." --output-format json 2>/dev/null | jq -r '.response'
```

**Context budget:** Stay under 200K tokens (~20% of Gemini's 1M). For plans referencing >30 files, split into multiple Gemini calls grouped by service or concern.

**After Gemini responds:**
- Verify each finding against the actual code — do NOT blindly trust
- Fix real issues by updating the plan file
- Note false positives and move on

### Step 2: RED Phase — Sonnet Agents Write Failing Tests

Dispatch sonnet agents (Task tool, `model: "sonnet"`) to write failing tests.

**Grouping:** Parallelize independent work. Group by file or service:
- Tests touching different files → parallel agents
- Tests touching the same file → single agent

**Agent instructions must include:**
- The exact test code from the plan (updated with Gemini feedback)
- Which test file to edit and where to add tests
- "Write tests ONLY — do NOT modify implementation files"

### Step 3: Review the Tests

**You must read every test the agents wrote.** Check:

1. Does each test match the plan's intent?
2. Does each assertion test the RIGHT behavior (not implementation details)?
3. Are there missing edge cases flagged by Gemini that need tests?
4. Are event handlers correct (e.g., `e.target.checked` for checkboxes, not `e.target.value`)?

If tests are missing or wrong, fix them directly.

Then run the tests and confirm each fails for the RIGHT reason:

```bash
cd <service> && npx vitest run path/to/test.file
# or: cd <service> && python3 -m pytest path/to/test_file.py -v
```

Summarize in a table:

| Test | Failure Reason | Correct? |
|------|---------------|----------|
| test name | why it failed | yes/no |

**STOP if any test fails for the wrong reason** (import error, syntax error, wrong assertion). Fix before proceeding.

### Step 4: GREEN Phase — Sonnet Agents Implement

Dispatch sonnet agents to write minimal implementations.

**Each agent gets:**
- The failing test file (so it knows what to satisfy)
- The source file to modify
- Exact implementation instructions from the plan
- "Make the failing tests pass. Do NOT modify test files."

**Grouping:** Same as RED phase — parallelize by file independence.

### Step 5: Verify GREEN

Run the project's full quick test suite:

```bash
make test-quick  # or equivalent from CLAUDE.md
```

If failures, fix directly — do not re-dispatch agents for small fixes.

### Step 6: Gemini Reviews the Diff

Generate a diff of all changes and send to Gemini:

```bash
git diff HEAD -- path/to/changed/files > /tmp/review.diff
cat /tmp/review.diff | gemini -m gemini-3-pro-preview -p "Review this diff for:
1. Bugs in the implementation
2. Edge cases not covered
3. HTML/accessibility issues
4. Framework pattern violations
5. Test quality — do tests verify the right behavior?

Context: [brief description of what was implemented]" --output-format json 2>/dev/null | jq -r '.response'
```

**Context budget:** Diffs are usually small (<500 lines). If the diff exceeds 100K tokens, split by service.

### Step 7: Fix Issues from Review

For each Gemini finding:
1. Verify against the actual code — is it a real issue?
2. If real: fix it directly (small fixes don't need agents)
3. If false positive: note and move on

Then run the test suite again:

```bash
make test-quick  # or equivalent
```

### Step 8: Commit

Commit with a descriptive message. Run the test suite one final time before committing.

Report to user: what was implemented, what Gemini flagged, final test results.

## When to Stop

- A test fails for the wrong reason in Step 3 → fix before continuing
- `make test-quick` fails in Step 5 → fix before continuing
- Gemini finds a critical architectural issue → discuss with user
- You don't understand a plan task → ask the user, don't guess

## Anti-Patterns

- **Don't read full agent output into your context.** Verify files were created/modified, spot-check a few lines. Agents are disposable; your context is not.
- **Don't skip test review (Step 3).** Agents write plausible-looking tests that test the wrong thing. You must verify.
- **Don't blindly trust Gemini.** Always verify findings against actual code.
- **Don't re-dispatch agents for small fixes.** Fix 1-3 line issues directly.
- **Don't skip the Gemini plan review (Step 1).** It catches architectural issues that are expensive to fix later.
