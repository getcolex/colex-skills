# Simple Plan — Examples

Two real plans that demonstrate the format.

## Example 1: Task Retry System (M8)

**M8: Task Retry + Error Recovery**

1. A task has `retry_max` (how many retries allowed, 0 = none) and `retry_count` (how many have happened).

2. When a task fails — whether first attempt or retry — `handleTaskFailure` uses a single atomic SQL WHERE (`retry_count < retry_max AND exec_status = 'running'`) to check and increment; if under limit, task becomes `exec_status: 'idle'` with `retry_after` set 30s ahead; if at limit, `failTask` marks it permanently `exec_status: 'errored'`. The `exec_status: 'running'` guard means if something else already changed the task's state (e.g., Restart), the WHERE matches 0 rows and both branches are skipped — no-op.

3. A background scanner runs every 10s, finds idle tasks where `retry_after <= now` and `garden_status: 'ready'`, and dispatches them to the executor; `garden_status` stays ready throughout the retry cycle so no `evaluate()` is needed between retries.

4. The executor's `startTask` atomically claims the task (same pattern — single SQL WHERE on `exec_status IN ('idle') AND garden_status = 'ready'`) setting `exec_status: 'running'` and clearing `retry_after`; if two executors race, only one row updates.

5. When a task is permanently errored, the UI shows the error, renders the task's existing output type as editable (tables stay tables, text stays text — empty scaffold if no data exists), and shows an Approve button; Approve calls `completeTask` (`exec_status → 'done'`) then `postTaskData` writes to the ledger and triggers `evaluate()`, which unblocks downstream tasks.

6. Pause sets `project.phase = 'paused'` (with `paused_from` tracking whether it was `'active'` or `'testing'`); the scanner filters by project phase and skips paused projects; no task-level fields change, so pending `retry_after` values survive and the scanner picks them up naturally after Resume.

7. Resume sets `project.phase` back to the `paused_from` value; Restart resets all non-running tasks (`exec_status → idle`, `retry_count → 0`, `retry_after → null`, `garden_status → blocked`, clears ledger/blackboard/status cache) then calls `evaluate()` which recalculates readiness and sets unblocked tasks to `garden_status: 'ready'`; Stop Test does the same reset but sets phase to drafting.

8. Restart is blocked by `hasActiveExecution` when any task is running, has a future `retry_after`, or has `approval_status: 'pending'` (HITL approval gates configured on tasks, separate from the errored-task manual completion in sentence 5) — user must Pause first. Restart's `whereNot({ exec_status: 'running' })` is a safety net so a running task is never corrupted even if the check is bypassed.

9. The scanner is cross-tenant (`{admin: true}` accountability), groups retry tasks by `user_created`, and dispatches with `{admin: true, user: userId}` so the executor resolves the correct tenant; tasks with missing `user_created` are skipped and logged.

**Files:**

| File | Change |
|------|--------|
| `v2/task-lifecycle.ts` | Add `handleTaskFailure`, `retry_count`/`retry_after` fields |
| `garden/index.ts` | Scanner endpoint, Pause/Resume/Restart handlers |
| `v2/types.ts` | Add retry fields to Task type |
| `frontend/.../TaskOutputCard.jsx` | Error state UI + Approve button |

**What does NOT change:** `evaluate.ts`, `materialize.ts`, `rule-graph.ts`, `commit-task-output.ts`.

---

## Example 2: Semantic Check Names (M10d)

**M10d: Check `data_key` — Semantic Rule Paths**

1. Checks get an optional `data_key` field — a short snake_case name like `"enquiry"` or `"suppliers"`. The LLM sets this when creating checks. Format: `/^[a-z][a-z0-9_]*$/`, nullable, validated on both CREATE and PATCH. DB column added to `tb_checks`, plumbed through types.ts, repository.ts, instantiate.ts, and the Zod schema in index.ts.

2. One pure function `resolveChecks(checks)` builds a name-to-UUID map from all checks with `data_key`, then deep-clones each check's rule conditions replacing data_key references with UUIDs — `condition.checkId` resolved directly, `condition.path` resolved on the base segment only (so `"enquiry.port"` becomes `"uuid-1.port"`). Uses `switch(condition.type)` for type-safe narrowing across all condition variants (`fact_exists`, `check_resolved`, `all_of`, etc). Returns original array untouched when no checks have data_keys. **Invariant: `check.id` is never changed** — only rule conditions are rewritten.

3. Resolution is called at exactly two points, both before existing code runs: (a) `snapshot.ts` — one line before `buildRuleGraph`, so the evaluation engine only sees UUIDs; (b) `validate-rules.ts` — one line before `buildRuleGraph`, so cycle detection works with data_key references. Zero changes to `evaluate.ts`, `materialize.ts`, `rule-graph.ts`, `resolvePath`, or `extractWaitingFor`.

4. `validate-spec.ts` catches authoring errors before workflow starts: `duplicate_data_key` (same name on two checks), `invalid_data_key_format` (fails regex), `data_key_id_collision` (data_key equals any check's UUID — prevents silent misrouting where resolver redirects a reference intended for check A to check B), `unresolvable_path` (path/checkId doesn't match any check ID or data_key), and `dot_notation_on_collect_all` (dot-notation on a `collect_all` check — engine can't traverse arrays, use `count_gte` instead). Disabled conditions (`enabled: false`) are skipped.

5. The system prompt tells the LLM: every check should have a `data_key`, must be unique per project, must be snake_case. Includes examples for `fact_exists`, `fact_equals`, `check_resolved`, and explicitly `count_gte` (LLMs copy patterns). Documents that dot-notation only works on `keep_latest` checks.

6. To fix project 423: set `data_key` on the three existing checks (`enquiry`, `suppliers`, `emails`), then trigger re-evaluation. The resolver will rewrite `fact_exists("enquiry")` to `fact_exists("uuid-1")` and the check will resolve.

**Files:**

| File | Change |
|------|--------|
| `v2/check-resolver.ts` | NEW — `resolveChecks`, `DATA_KEY_REGEX`, internals |
| `v2/check-resolver.test.ts` | NEW — all condition types, nesting, immutability, passthrough |
| `v2/types.ts` | Add `data_key?: string \| null` to `Check` |
| `v2/repository.ts` | Add `data_key` to column mapping |
| `v2/instantiate.ts` | Add `data_key` to `TemplateCheck` + `insertCheck` |
| `garden/index.ts` | Zod schema, CREATE, PATCH allowlist + format validation |
| `v2/evaluation/snapshot.ts` | One import + one line |
| `v2/validate-rules.ts` | One import + one line |
| `v2/validate-spec.ts` | 5 new issue types, lookup sets, path/collision validation |
| `chat/garden-system-prompt.ts` | data_key docs + examples |

**What does NOT change:** `evaluate.ts`, `materialize.ts`, `rule-graph.ts`, `resolvePath`, `extractWaitingFor`, `commit-task-output.ts`.
