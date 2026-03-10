# Issue Query Patterns

Use this reference when translating natural language into `list_issues(...)`.

## When to use `list_issues`

Use `list_issues` for grouped issue and feedback lists:

- unresolved issues
- bugs affecting many users
- noisiest problems
- issues assigned to a person
- user feedback
- quick wins / actionable issues

Do not use `list_issues` for counts or aggregations.

## Core syntax rules

- Use Sentry issue search syntax, not SQL.
- Relative time goes in the query, for example `lastSeen:-24h` or `firstSeen:-7d`.
- `lastSeen` means recent activity.
- `firstSeen` means newly created issues.
- Do not default to `level:error` just because the user says "critical", "important", or "severe". Those usually mean impact, not explicit severity level filtering.

## High-value filters

- unresolved: `is:unresolved`
- unassigned: `is:unassigned`
- feedback: `issueCategory:feedback`
- production only: `environment:production`
- release-specific: `release:VALUE`
- user impact threshold: `userCount:>N`

## Sort choices

- `date`: recent activity / default
- `freq`: highest event volume
- `new`: newest issues by first seen time
- `user`: most affected users

Choose sort based on the user's actual intent:

- recent or active -> `date`
- noisiest -> `freq`
- newest -> `new`
- most users affected -> `user`

## "Me" references

For assignment filters:

1. Call `whoami`.
2. Use the returned email in `assignedOrSuggested:EMAIL`.

Examples:

- "issues assigned to me" -> `assignedOrSuggested:user@example.com`
- "my feedback issues" -> `issueCategory:feedback assignedOrSuggested:user@example.com`

## Seer actionability

Use `issue.seer_actionability` when the user asks for easy fixes, quick wins, low-hanging fruit, or actionable issues.

- quick wins / easy to fix -> `issue.seer_actionability:[high,super_high]`
- actionable issues -> `issue.seer_actionability:[medium,high,super_high]`
- trivial fixes -> `issue.seer_actionability:super_high`

Usually combine this with `is:unresolved`.

## Reusable translations

- unresolved issues:
  - `query='is:unresolved'`, `sort='date'`
- worst issues affecting the most users:
  - `query='is:unresolved'`, `sort='user'`
- noisiest issues:
  - `query='is:unresolved'`, `sort='freq'`
- new issues from last week:
  - `query='is:unresolved firstSeen:-7d'`, `sort='new'`
- active issues from last week:
  - `query='is:unresolved lastSeen:-7d'`, `sort='date'`
- user feedback in production:
  - `query='issueCategory:feedback environment:production'`, `sort='date'`

## When to route away

- Exact issue ID or issue URL -> `get_issue_details` or `get_sentry_resource`
- Counts, totals, trends, grouped metrics -> `list_events`
