---
name: sentry-issue-search
description: Translate natural-language issue searches into direct `list_issues` calls. Use when asked to "show issues", "find bugs", "what problems do we have", "show user feedback", "issues assigned to me", "critical issues", or similar grouped issue searches in Sentry without `search_issues`. Resolves "me" with `whoami`, maps natural language to Sentry issue query syntax, and picks the correct sort.
---

Replace `search_issues` by translating the request into `list_issues(...)`.

## Step 1: Confirm this is an issue-list request

Use this skill when the user wants grouped issue cards, not counts or raw events.

Route elsewhere when:

- The user gives an exact issue ID or issue URL: use `get_issue_details` or `get_sentry_resource`.
- The user wants counts, totals, averages, or grouped metrics: use `list_events`.
- The user wants raw error, log, or span rows: use `list_events`.

## Step 2: Normalize shared inputs

- Parse `org/project` shorthand directly when present.
- If organization or project is unclear, use `find_organizations` or `find_projects`.
- If the request refers to "me", "my", or "myself" for assignment, call `whoami` and use the returned email in `assignedOrSuggested:EMAIL`.

## Step 3: Build the issue query

Read [issue-query-patterns.md](./references/issue-query-patterns.md) before constructing the `query` and `sort`.

## Step 4: Execute directly

Call `list_issues(...)` with:

- `organizationSlug`
- `projectSlugOrId` if known
- translated `query`
- chosen `sort`
- `limit`

Do not narrate the translation unless the user asks.
