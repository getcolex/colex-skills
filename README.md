# Colex Skills

Claude Code skills for development workflows.

## Skills

| Skill | Description |
|-------|-------------|
| [gemini-sidekick](skills/gemini-sidekick/) | Delegate tasks to Google Gemini CLI with 1M token context and free Google Search |
| [gemini-code-review](skills/gemini-code-review/) | Two-pass parallel Gemini code review with automatic Claude verification |
| [tdd-plan-executor](skills/tdd-plan-executor/) | Execute implementation plans using strict TDD with Gemini review and sonnet subagents |

## Installation

Copy a skill folder into `~/.claude/skills/` to make it available globally:

```bash
cp -r skills/gemini-sidekick ~/.claude/skills/
```

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI
- [Gemini CLI](https://github.com/google-gemini/gemini-cli) (for gemini-based skills)
