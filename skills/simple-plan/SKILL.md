---
name: simple-plan
description: Compress implementation plans into readable, information-dense numbered prose. Use when writing implementation plans, design documents, or technical specs — especially plans that will be reviewed by humans or sent to LLMs (Gemini, ChatGPT) for feedback. Replaces verbose task-by-task plans with compact numbered sentences where every sentence carries a design decision, mechanism, or invariant. Triggers on "write a plan", "simple plan", "compress this plan", or when a plan needs to be readable by both humans and LLMs.
---

# Simple Plan

Compress implementation plans into numbered prose. Each sentence carries a decision. No filler.

**Announce:** "I'm using the simple-plan skill to write this plan."

## The Format

A simple plan has three sections:

1. **Title + one-line goal**
2. **Numbered paragraphs** — the design, compressed
3. **Files table + "what does NOT change"**

No headers per task. No code blocks repeating what prose says. No step-by-step TDD ceremony.

## Rules

### Every sentence earns its place

Each sentence states a mechanism, a design decision, a constraint, an invariant, or an edge case. Delete sentences that do none of these.

Bad: "This function will be used to resolve data keys."
Good: "`resolveChecks(checks)` builds a name-to-UUID map, deep-clones rule conditions replacing references — returns original array untouched when no checks have data_keys."

### Inline the "why" with the "what"

Don't separate rationale from mechanism.

Bad: "We use an atomic SQL WHERE. This prevents race conditions."
Good: "The executor's `startTask` atomically claims the task (single SQL WHERE on `exec_status IN ('idle')`) — if two executors race, only one row updates."

### Name the guard, state the consequence

Bad: "There is a check to prevent duplicate execution."
Good: "The `exec_status: 'running'` guard means if something else already changed the task's state, the WHERE matches 0 rows — no-op."

### Parentheticals for context, not separate sentences

"Pause sets `project.phase = 'paused'` (with `paused_from` tracking whether it was `'active'` or `'testing'`); the scanner filters by project phase and skips paused projects."

### Semicolons chain related mechanisms

"Resume sets `project.phase` back to the `paused_from` value; Restart resets all non-running tasks then calls `evaluate()` which recalculates readiness."

### Code references are inline, not blocks

Use backtick-wrapped names: `handleTaskFailure`, `exec_status: 'idle'`, `retry_count < retry_max`. No fenced code blocks unless showing a data structure that cannot be described in prose.

### Files table replaces per-task file lists

One table at the end. File path, what changes. Below it: "What does NOT change" — explicitly list untouched files to make the boundary clear.

### Follow the data flow

Number points by how data flows through the system: data model first, then runtime mechanism, then validation, then UX.

## Anti-Patterns

- **Code blocks restating prose.** If the paragraph describes the behavior, a code block adds nothing.
- **Separate "Design Decisions" sections.** Inline them as parentheticals.
- **Headers per task.** Numbers replace headers.
- **Verification steps.** `make test-quick` belongs in the executor skill, not here.
- **Restating known context.** If this follows brainstorming, skip the problem statement.

## When to Use

| Situation | Skill |
|-----------|-------|
| Human review, LLM feedback, design approval | **simple-plan** |
| Dispatching agents to write code (needs exact code, test commands) | `superpowers:writing-plans` |
| Both | Write **simple-plan** for approval, expand to `writing-plans` for execution |

## Writing Quality

Apply these Strunk principles:

- **Omit needless words.** Density comes from cutting.
- **Active voice.** "`handleTaskFailure` uses an atomic WHERE" not "an atomic WHERE is used."
- **Positive form.** "The scanner skips paused projects" not "does not process."
- **Emphatic words last.** "If two executors race, only one row updates" — consequence lands last.

## Examples

Read [references/examples.md](references/examples.md) for two real plans demonstrating the format.

## Output

Save to `docs/plans/YYYY-MM-DD-<feature-name>.md`.
