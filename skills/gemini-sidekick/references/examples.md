# Gemini Sidekick Usage Examples

## Codebase Architecture Review

```bash
cd /path/to/project && gemini -m gemini-3-pro-preview -p "Analyze the architecture of this codebase. Identify: 1) Main modules and their responsibilities 2) Data flow between components 3) External dependencies 4) Potential architectural concerns" --output-format json 2>/dev/null
```

## Security Audit

```bash
cd /path/to/project && gemini -m gemini-3-pro-preview -p "Scan this codebase for security vulnerabilities. Focus on: SQL injection, XSS, authentication flaws, secrets in code, insecure dependencies. List each finding with file path, line context, and severity." --output-format json 2>/dev/null
```

## Web Research

```bash
gemini -m gemini-3-pro-preview -p "Research the latest best practices for PostgreSQL connection pooling in Node.js applications. Compare PgBouncer vs built-in pg pool vs Prisma connection pooling. Include pros, cons, and recommendations." --output-format json 2>/dev/null
```

## Large Log Analysis

```bash
cat /var/log/app/error.log | gemini -m gemini-3-pro-preview -p "Analyze these error logs. Group by error type, identify root causes, and suggest fixes in priority order." --output-format json 2>/dev/null
```

## Large Diff Review

```bash
git diff main...HEAD | gemini -m gemini-3-pro-preview -p "Review this diff for: 1) Bugs or logic errors 2) Security issues 3) Performance concerns 4) Missing edge cases. Be specific with file paths and line references." --output-format json 2>/dev/null
```

## Specific File Deep Analysis

```bash
gemini -m gemini-3-pro-preview -p "Analyze @./src/services/payment.ts in depth. Document: 1) All public methods and their contracts 2) Error handling patterns 3) Edge cases handled and not handled 4) Suggestions for improvement" --output-format json 2>/dev/null
```

## Multi-File Comparison

```bash
gemini -m gemini-3-pro-preview -p "Compare @./src/api/v1/routes.ts and @./src/api/v2/routes.ts. What changed between v1 and v2? Are there any breaking changes? Any regressions?" --output-format json 2>/dev/null
```

## Documentation Generation

```bash
cd /path/to/project && gemini -m gemini-3-pro-preview -y -p "Generate a comprehensive API documentation markdown file at docs/API.md covering all REST endpoints in src/routes/. Include method, path, request/response schemas, and examples." --output-format json 2>/dev/null
```

## Dependency Analysis

```bash
gemini -m gemini-3-pro-preview -p "Analyze @./package.json and @./package-lock.json. Identify: 1) Outdated dependencies 2) Known vulnerabilities 3) Unused dependencies 4) Conflicting version requirements" --output-format json 2>/dev/null
```

## Second Opinion on Design

```bash
gemini -m gemini-3-pro-preview -p "I'm designing a multi-tenant system where each tenant gets isolated data in a shared PostgreSQL database. Current approach: row-level security with tenant_id columns. Review this approach. What are the pitfalls? Would schema-per-tenant be better? What about connection pooling implications?" --output-format json 2>/dev/null
```
