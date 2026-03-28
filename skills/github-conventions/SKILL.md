---
name: github-conventions
description: Create GitHub issues, PRs, and link them for the Colex platform repo (getcolex/colex-platfrom). Use when asked to "create an issue", "make a PR", "push to GitHub", "assign to someone", "put this on GitHub", or any GitHub workflow task.
---

# GitHub Conventions — Colex Platform

Repo: `getcolex/colex-platfrom` (the typo is intentional — do not correct it).

## Labels

Always apply priority + effort + area + type.

**Priority** — based on production impact:
- `P0` — Production is broken or data is at risk. Drop everything.
- `P1` — Needed before launch or for a stable product. Blocks users or revenue.
- `P2` — Post-launch improvement. Nice to have, not blocking anyone.

**Effort** — based on implementation scope:
- `E0` — One file, < 1 hour. Config change, copy fix, single-line bug.
- `E1` — Half day to full day. Single feature, 2-5 files, clear scope.
- `E2` — Multi-day. Touches multiple services, needs a plan doc, has phases.

**Area** — tag ALL services the issue touches:
- `area:frontend` — React/Mantine/Tailwind code in `frontend/`
- `area:backend` — Directus extensions in `backend/extensions/`
- `area:tools-server` — Python FastAPI or Node piece-runner in `tools-server/`

**Type** — pick one: `enhancement`, `bug`, `security`, `infrastructure`, `production-readiness`

## Issue Format

```
Title: [Optional P0/P1/P2]: Concise description

## Problem
[What's wrong or missing, 1-2 paragraphs]

## Solution
[Architecture, key design decisions as numbered bold items with rationale]

### What's Implemented (if code exists)
[Per-phase or per-component breakdown]

### Test Coverage
[Table: layer | count | what's covered]

### Known Limitations
[Numbered list]

### Files Changed
[New files, modified files with brief descriptions]
```

## PR Format

```
Title: feat/fix/test: concise description

## Summary
[3-5 bullets]

Closes #NNN. Relates to #NNN.

## Test plan
- [ ] make test-ci passes
- [ ] specific E2E or manual tests

## Known limitations
[if any]

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## Commands

```bash
# Create issue
gh issue create --repo getcolex/colex-platfrom \
  --title "Title" \
  --label "enhancement,area:backend,P1,E2" \
  --assignee "username" \
  --body "$(cat <<'EOF'
...body...
EOF
)"

# Push branch
git push origin branch-name

# Create PR linked to issue
gh pr create --repo getcolex/colex-platfrom \
  --base main --head branch-name \
  --assignee "username" \
  --title "feat: description" \
  --body "$(cat <<'EOF'
...body...
EOF
)"
```

## Branch Naming

`feat/<description>`, `fix/<description>`, `feature/<description>`

## Team

| Handle | Role |
|--------|------|
| `raghu-lgtm` | Engineer / reviewer |
| `parijat2801` | Owner |
