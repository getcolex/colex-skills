# Review Structure Reference

Detailed checklists for each section of the plan review.

## 1. What's Good (3-5 items)

The author needs to know what to protect during iteration. For each:
- Anchor to specific line numbers
- State WHY it's correct (not just "good idea")
- Explain what would break if this decision were reversed

## 2. Pushback (ordered by blast radius)

Lead with the item that, if wrong, causes the most rework. For each:

- **What the plan says** — quote with line references
- **Why it's a problem** — pick exactly one: over-engineered, inconsistent, risky, under-specified, wrong assumption about codebase
- **What to do instead** — concrete alternative, not "consider rethinking"
- **What you save** — files, phases, concepts, failure modes, lines of code

Categories to scan for:

| Category | What to look for |
|----------|-----------------|
| Over-engineering | Features that could be deferred, abstractions for one use case, infrastructure that could be a function |
| Layer violations | Logic that crosses the responsibility boundaries the plan defines |
| Wrong reuse assumptions | Plan says "reuse X" but X doesn't do what the plan thinks |
| Missing error paths | Happy path specified, failure path hand-waved |
| Premature generalization | user_id field "for future use", configurable things with one config |
| Unnecessary new concepts | Could be implemented by extending an existing concept |

## 3. Consistency Issues

Cross-reference every section against every other section. Specific checks:

### Responsibility boundaries vs detail sections
- For each row in the responsibility table: does every detail section respect those boundaries?
- If a section says layer X does something, does the table say X owns that?
- If the table says "No" for a capability, does any section require it?

### Env vars and secrets
- List every env var mentioned anywhere in the plan
- For each: which service has it? Which services need it? Are those consistent?
- Are generation commands provided for secrets?

### Endpoints
- List every endpoint mentioned in prose
- List every endpoint in endpoint tables
- Diff the two lists — flag any that appear in one but not the other

### Data flows
- For each data flow described in prose, trace every hop:
  - Who sends? Who receives? What format? What auth?
  - Does the sender have the data it claims to send?
  - Does the receiver do what the plan says with it?

### Phase ordering vs file table
- For each phase: are the files it builds listed in the files table?
- For each file in the files table: is it assigned to a phase?
- Does the phase ordering respect dependencies? (File X modified in Phase 3 but needed in Phase 2?)

### Naming consistency
- Is the same concept called the same thing everywhere? (e.g., "skill docs" vs "guidance", "tools-server" vs "Python bridge")
- Are field names consistent? (e.g., `encrypted_credentials` vs `credentials` vs `auth`)

### Stale references
- After simplifications or rewrites: are there leftover references to removed components, old endpoint names, previous phase numbering, or deleted files?

## 4. Unanswered Questions

Things the plan assumes but doesn't verify. For each:

- **The assumption** — what the plan takes for granted
- **Why it might be wrong** — specific risk
- **How to verify** — experiment, code to read, or measurement (with estimated time)
- **Blocks Phase 1?** — Yes (must verify before building) or No (can defer)

Common sources of unverified assumptions:
- "Reuses existing X" — has anyone confirmed X works for this use case?
- "Already threaded through" — has anyone read the code to confirm?
- Package size, cold start time, memory usage — measured or estimated?
- Third-party library behavior — tested with real credentials or only with mocks?
- Framework capabilities — does the framework actually support what the plan assumes?

## 5. Simplification Opportunities (exactly 5)

Concrete ways to reduce scope while preserving external behavior. For each:

- **What to cut** — specific component, field, endpoint, phase, or concept
- **Why behavior is preserved** — the user-visible outcome is identical
- **What you save** — files, phases, concepts, failure modes, implementation time
- **Tradeoff** — what you lose (future flexibility, error quality, observability, etc.)

Where to look for simplification:
- Fields that store what could be derived at runtime
- Separate endpoints that could be one endpoint
- Separate phases that could be merged
- Infrastructure that could be a function call
- Custom implementations where a framework feature exists
- UI that could be replaced by admin tooling for v1
- Abstractions for one current use case
- Validation layers that duplicate each other

## Cross-Cutting Concerns (check throughout all 5 sections)

These apply to plans the same way the `/simplify` skill applies them to code. Check these during every section, not as a separate pass.

### Reuse
- Does the plan propose building something that already exists in the codebase? (Phase 1 codebase exploration should catch this)
- Does it propose a new utility/helper/module where an existing one could be extended?
- Are two planned components doing the same thing with slight variation?

### Separation of concerns
- Does the responsibility table hold? Does every proposed function/module/endpoint have exactly one owner?
- Are there planned components that mix concerns (e.g., a module that both decrypts AND writes to DB)?
- Does the plan create coupling between layers that the responsibility table says are independent?

### Efficiency in proposed data flows
- **Hot path vs cold path:** Is expensive work (crypto, network calls, DB queries) on the per-request path when it could be at startup, cached, or batched?
- **N+1 patterns:** Does the plan propose fetching something per-item when it could be batched? (e.g., credential fetch per piece execution vs. cached per tenant)
- **Redundant operations:** Does the same data get fetched, computed, or validated in multiple places along the same flow?
- **Missed concurrency:** Are phases or operations listed as sequential when they have no data dependency and could run in parallel?
