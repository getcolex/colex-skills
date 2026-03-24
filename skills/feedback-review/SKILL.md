---
name: feedback-review
description: Process external review feedback on implementation plans. Use when the user shares reviewer feedback (from Gemini, ChatGPT, Opus, humans, or any external source) on a plan document and wants each finding verified before applying changes. Triggers on "here's some feedback", "review feedback", "what do you think of this feedback", "gemini found these issues", or when reviewer findings are pasted into the conversation.
---

# Feedback Review

Process external review feedback on plans by verifying each finding against the actual code before proposing changes.

**Announce:** "I'm using the feedback-review skill to process this review."

## The Process

### Step 1: Parse findings into a numbered list

Read each finding from the reviewer. Restate it in one sentence — what they claim, and where.

### Step 2: Classify each finding

| Type | Meaning |
|------|---------|
| **Bug** | Logical error, race condition, broken invariant |
| **Simplification** | Something can be removed or merged |
| **Clarification** | Ambiguous wording that could mislead an implementer |
| **Missing** | A case or path the plan forgot to cover |

### Step 3: Verify each finding against the code

For every non-trivial claim, read the actual source code. Dispatch parallel Explore agents when findings touch different files.

Check:
- Does the code actually work the way the reviewer assumes?
- Is the architecture what they think it is (e.g., streaming vs batch)?
- Are the function signatures and call patterns what they describe?

Mark each finding: **Verified**, **Partially correct**, or **False positive** — with one sentence of evidence.

### Step 4: Present findings table to user

| # | Finding | Type | Verdict | Evidence | Proposed action |
|---|---------|------|---------|----------|-----------------|
| 1 | ... | Bug | Verified | `reducers.ts:21` receives array | Update point N |
| 2 | ... | Simplification | False positive | Misread architecture | None |

**Wait for user approval before making any changes.**

### Step 5: Apply approved updates

Edit the plan document. After applying:
- Scan for negative language ("don't", "never", "avoid", "not", "stays as-is", "unchanged", "vestigial but must compile"). Rewrite as positive instructions — what the agent should *do*.
- Verify the fit issues table still matches the updated points.
- Verify the files table covers any new files introduced by changes.

## Rules

- Verify before trusting. Reviewers (especially LLMs) hallucinate about architecture, call patterns, and data flow.
- Present before applying. The user decides which changes to accept.
- One sentence of evidence per finding. Link to file:line when possible.
- Parallel verification. Dispatch Explore agents for independent findings touching different files.
- False positives are valuable. Flag them explicitly — they reveal what the reviewer misunderstands about the system.
