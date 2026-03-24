---
name: plan-review
description: Staff-engineer review of a technical implementation plan. Use when asked to review a plan, design doc, or technical spec — especially before implementation starts. Triggers on "review this plan", "review like a staff engineer", "check for consistency", "what's wrong with this plan", or when a plan document needs critical evaluation against the actual codebase. Produces a read-only review — no changes to the plan itself.
---

# Plan Review

Staff-engineer review of a technical plan against the actual codebase. Read-only — output is a review, not edits.

**Announce:** "I'm using the plan-review skill to review this plan."

## Process

### Phase 1: Understand the codebase BEFORE reading the plan

Launch 2-4 parallel Explore agents targeting the subsystems the plan touches. Determine targets from the plan's title, file table, or user context — but do NOT read the plan body yet.

Each agent should read actual code (function signatures, interfaces, registries, data flows) — not just file names. The goal: build an independent mental model so you can catch where the plan's assumptions diverge from reality.

**What to look for:**
- How are similar features implemented today? (patterns, interfaces, registries)
- What does the code at each integration point actually look like?
- What can be reused vs. must be built new?

### Phase 2: Read the plan twice

**First pass:** Understand the design. Note the core principle, the data flows, the phase ordering.

**Second pass:** Track every falsifiable claim:
1. Every claim about the existing codebase — is it accurate?
2. Every responsibility assignment — consistent across all sections?
3. Every data flow — trace end-to-end, every hop specified?
4. Every env var, secret, or credential — who has it, who needs it, consistent?
5. Every endpoint — referenced in prose AND listed in tables?
6. Every phase — description matches what the files table says is built when?

### Phase 3: Write the review

Structure as five sections. See [references/review-structure.md](references/review-structure.md) for detailed checklists per section.

1. **What's good** — 3-5 decisions to protect. Line numbers. Why they're correct.
2. **Pushback** — things to reconsider. Ordered by blast radius (most rework if wrong → first). Each: what plan says, why it's a problem, concrete alternative, what you save.
3. **Consistency issues** — cross-reference every section against every other section. See checklist in references.
4. **Unanswered questions** — assumptions the plan doesn't verify. Each: the assumption, why it might be wrong, how to verify, whether it blocks Phase 1 or can defer.
5. **Simplification opportunities** — 5 concrete ways to cut scope while preserving external behavior. Each: what to cut, why behavior is preserved, what you save, any tradeoff.

## Rules

- **Codebase first, plan second.** Never read the plan before exploring the codebase. Prevents confirmation bias.
- **Read code, not file names.** If the plan says "reuses template engine from data-queries.ts:25-77", read those lines.
- **Trace every data flow end-to-end.** "Executor fetches credential, passes to Node" — does the executor have the context to do this? What function? What parameter?
- **Check the seams.** Most plan bugs live at component boundaries. If "Node returns auth_error, executor retries" — who re-fetches the credential? Who passes the new one?
- **Anchor every claim.** Every "this exists" or "this can be reused" must be verified against actual code.
- **No changes to the plan.** Output is a review. The author decides what to act on.
- **Be direct.** Over-engineered → say so. Under-specified → say so. The goal is to find problems before they become code.
