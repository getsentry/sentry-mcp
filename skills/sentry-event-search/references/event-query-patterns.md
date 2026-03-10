# Event Query Patterns

Use this reference when translating natural language into `list_events(...)`.

## Dataset selection

- `errors`: exceptions, crashes, stack traces, unhandled errors
- `logs`: log lines, severity filtering, debugging output
- `spans`: traces, HTTP calls, database work, slow endpoints, AI/LLM calls, token usage, MCP tools

For ambiguous operational searches, prefer `spans`.

## Core syntax rules

- Use Sentry search syntax, not SQL.
- Never use `IS NULL`, `IS NOT NULL`, `yesterday()`, `today()`, or `now()`.
- Use `has:field` and `!has:field` for field presence checks.
- Put relative time windows in `statsPeriod`, not in the query string.
- Always choose an explicit `sort`.
- If `sort` uses a field, include that field in `fields`.
- For aggregate queries, `fields` should contain only group-by fields and aggregate functions.

## Default sorts

- `errors`: `-timestamp`
- `logs`: `-timestamp`
- `spans`: `-span.duration`

## Aggregate patterns

- total count:
  - `fields=['count()']`, `sort='-count()'`
- grouped count:
  - `fields=['field', 'count()']`, `sort='-count()'`
- distinct values:
  - also use `['field', 'count()']`, sorted by `-count()`
- averages and sums:
  - use `avg(...)`, `sum(...)`, `p75(...)`, `p95(...)` as needed

## "Me" references

If the query refers to the current user in event data:

1. Call `whoami`.
2. Prefer exact `user.id` or `user.email` filters.

## Performance and span heuristics

For performance investigations:

- use `dataset='spans'`
- prefer aggregates over raw samples
- group by `transaction`
- include `count()`
- prefer `p75(span.duration)` or `p95(span.duration)`

Use duck typing for span classes:

- web vitals: `has:measurements.lcp`, `has:measurements.cls`, `has:measurements.inp`
- database: `has:db.statement` or `has:db.system`
- HTTP: `has:http.method` or `has:http.url`
- AI/LLM: `has:gen_ai.system` or `has:gen_ai.request.model`
- MCP tools: `has:mcp.tool.name`

Use `is_transaction:true` only when the user explicitly wants transaction boundaries.

## LLM and self-debugging patterns

Prefer `spans` for:

- which models were called
- how many tool calls happened
- which prompts are slow
- how many input or output tokens were used
- which MCP tools fail or take longest

Useful fields:

- identity: `gen_ai.request.model`, `gen_ai.system`, `mcp.tool.name`
- token usage: `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`
- timing: `span.duration`, `transaction`, `span.op`
- correlation: `trace`

Reusable translations:

- distinct models:
  - `dataset='spans'`
  - `fields=['gen_ai.request.model', 'count()']`
  - `sort='-count()'`
- tool-call counts:
  - `dataset='spans'`
  - `fields=['mcp.tool.name', 'count()']`
  - `sort='-count()'`
- token-heavy models:
  - `dataset='spans'`
  - `fields=['gen_ai.request.model', 'sum(gen_ai.usage.input_tokens)', 'sum(gen_ai.usage.output_tokens)']`
- slow endpoints:
  - `dataset='spans'`
  - `fields=['transaction', 'p75(span.duration)', 'count()']`
  - `sort='-p75(span.duration)'`

## When to route away

- Exact trace ID or trace URL -> `get_trace_details` or `get_sentry_resource`
- Exact issue ID or issue URL -> `get_issue_details` or `get_sentry_resource`
- Grouped issue lists -> `list_issues`
