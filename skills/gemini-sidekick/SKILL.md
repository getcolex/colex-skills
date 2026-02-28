---
name: gemini-sidekick
description: Delegate tasks to Google Gemini CLI as a sidekick agent with 1M token context and free Google Search. Use when Claude needs to (1) analyze large codebases or files that exceed Claude's context window, (2) perform web research with Google Search grounding, (3) review architecture across many files, (4) analyze large logs or diffs, (5) get a second opinion on code or design, or (6) offload read-heavy analysis to preserve Claude's context for editing. Triggers on keywords like "use gemini", "ask gemini", "gemini research", "large context analysis", or when Claude proactively determines Gemini's 1M context or Google Search would be more effective than Claude subagents.
---

# Gemini Sidekick

Invoke Google Gemini CLI as a subprocess for tasks where its 1M token context window or native Google Search grounding provide an advantage over Claude subagents.

## When to Use Gemini vs Claude Subagents

| Use Gemini | Use Claude Subagent |
|---|---|
| Read/analyze many files (>50) | Edit files (Write/Edit tools) |
| Web research | TDD implementation |
| Architecture review across large codebase | Focused single-file changes |
| Parse large logs/diffs (>100KB) | Multi-step tool orchestration |
| Summarize documentation | Tasks needing Claude's tool suite |
| Second opinion on design | Tasks requiring conversation memory |

## Invocation Patterns

### Research / Analysis (read-only, no tool approval needed)

```bash
gemini -m gemini-3-pro-preview -p "PROMPT" --output-format json 2>/dev/null
```

### Code Analysis with File References

```bash
gemini -m gemini-3-pro-preview -p "PROMPT @./src/" --output-format json 2>/dev/null
```

### File-Editing Tasks (auto-approve tools)

```bash
gemini -m gemini-3-pro-preview -y -p "PROMPT" --output-format json 2>/dev/null
```

## Invocation Rules

1. ALWAYS use `-m gemini-3-pro-preview` — never rely on auto-routing
2. Always use `--output-format json` for parseable output
3. Always redirect stderr: `2>/dev/null`
4. Parse the `response` field from JSON output
4. Use `@./path/` references in prompts to include files/directories in context
5. Use `-y` / `--yolo` ONLY when Gemini should edit files or run shell commands
6. Default to read-only (no `-y`) unless the task explicitly requires writes
7. Set working directory with `cd /path/to/project &&` before invocation
8. For piped input: `cat file | gemini -p "instruction" --output-format json 2>/dev/null`
9. For file references in prompts use `@` syntax: `gemini -p "Review @./src/index.ts"`

## JSON Output Structure

```json
{
  "response": "The model's text answer",
  "stats": {
    "models": { ... },
    "tools": { "totalCalls": 0, "totalSuccess": 0, ... }
  },
  "error": null
}
```

On failure, `response` is null and `error` contains `{ "type": "...", "message": "..." }`.

Exit codes: 0=success, 1=API error, 41=auth failure, 42=input error, 53=turn limit.

## Error Handling

1. If exit code is non-zero, read the JSON `error` field
2. If `gemini` command not found — inform user to install: `npm install -g @google/gemini-cli`
3. If auth error (41) — inform user to run `gemini` interactively to re-authenticate
4. If rate limited (response contains 429) — wait 60s and retry once, then report to user
5. Never retry more than once automatically

## Prompt Engineering for Gemini

When constructing prompts for Gemini:
- Be specific and direct — Gemini responds well to structured requests
- For codebase analysis, specify what to look for: patterns, bugs, architecture, etc.
- For research, ask for sources and specifics
- Prefix with role context when helpful: "As a senior engineer reviewing this codebase..."
- Keep prompts under 2000 chars — use `@file` references or stdin piping for large inputs

## Usage Examples

See [references/examples.md](references/examples.md) for concrete invocation examples across common use cases.
