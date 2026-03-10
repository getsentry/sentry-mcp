---
name: sentry-event-search
description: Translate natural-language event searches into direct `list_events` calls. Use when asked to "find errors", "show logs", "count issues", "look up spans or traces", "find slow endpoints", "find LLM calls", "count tool calls", "sum tokens", or similar Sentry event searches without `search_events`. Chooses the right dataset, maps natural language to Sentry query syntax, fields, sort, and time windows, and uses `whoami` when user identity filters are needed.
---

Replace `search_events` by translating the request into `list_events(...)`.

## Step 1: Confirm this is an event search

Use this skill when the user wants:

- raw errors, logs, or spans
- counts, sums, averages, percentiles, or grouped metrics
- traces, latency, AI/LLM calls, token usage, or MCP tool execution

Route elsewhere when:

- The user gives an exact trace ID or trace URL: use `get_trace_details` or `get_sentry_resource`.
- The user gives an exact issue ID or issue URL: use `get_issue_details` or `get_sentry_resource`.
- The user wants grouped issue cards: use `list_issues`.

## Step 2: Normalize shared inputs

- Parse `org/project` shorthand directly when present.
- If organization or project is unclear, use `find_organizations` or `find_projects`.
- If the query refers to the current user in event data, call `whoami` and prefer exact `user.id` or `user.email` filters.

## Step 3: Build the event query

Read [event-query-patterns.md](./references/event-query-patterns.md) before choosing `dataset`, `query`, `fields`, `sort`, and `statsPeriod`.

## Step 4: Execute directly

Call `list_events(...)` with:

- `organizationSlug`
- `projectSlug` if known
- chosen `dataset`
- translated `query`
- `fields`
- `sort`
- `statsPeriod`
- `limit`

Do not narrate the translation unless the user asks.
