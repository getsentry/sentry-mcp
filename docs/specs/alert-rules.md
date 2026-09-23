# Alert inspection

`find_alert_rules` and `get_alert_rule` inspect Alerts through the searchable
catalog (`search_sentry_tools` and `execute_sentry_tool`). No new direct tools
or write scopes are required.

The `issue` selector reads Sentry Alerts: notification workflows that can be
shared across projects and monitors, cover all projects, or have no connected
sources. Omit `projectSlug` to search the organization, including unattached
Alerts. A project filter selects associated Alerts; it does not make a shared
Alert exclusive to that project.

Lists contain compact summaries and independent pagination for each family.
Use `get_alert_rule(kind='issue', ruleIdOrName='<id>', ...)` for the full detail.
Name lookups reject ambiguous or incomplete searches; numeric IDs with an
explicit kind avoid ambiguity between workflow and legacy metric IDs.

## Detail contract

Issue Alert detail returns structured `alertRule` content:

- Name, enabled state, notification frequency, environment, owner and timestamps.
- Complete trigger and action groups, with all conditions, notification actions
  and component IDs. Provider-native action `config` and `data` are retained;
  unrelated backend metadata is excluded.
- `scope.projectIds` and `scope.includesAllProjects`, identifying the real
  association rather than just the requested project.
- `sources`: connected monitors, their type, project, enabled state,
  configuration, conditions and data sources. Metric query windows are explicitly
  `timeWindowSeconds`. Cron schedules and Uptime checks preserve their own units.

Source IDs support correlating connections. Source 403/404 responses appear as
`unavailable`; authentication failures and server errors propagate normally.
Unknown or missing source configuration is explicitly marked unavailable.
Uptime request headers and bodies are omitted and identified as omitted fields,
consistent with keeping credentials out of inspection responses.

In a project-constrained session, shared Alerts remain readable when associated
with that project. Other projects' source configuration is not exposed:
sources are marked `outside_project_constraint`, and scope includes
`limitedToProject` and, for a concrete project list, `outsideProjectCount`.
The real all-projects flag remains visible without guessing a project count.
Detached or unrelated Alerts are rejected for constrained sessions.

## Legacy metrics and interpretation

`kind='metric'` continues to use the existing metric alert API until the Metric
Monitor read migration. With `kind='all'`, an HTTP 410 from that API does not
hide valid workflow results: `warnings` explicitly reports that metrics were
unavailable; listing also sets `pagination.metric` to `null`. Other errors
propagate. Empty metric results in this case do not mean no Metric Monitors exist.

Current configuration helps explain which Alerts could match an issue. It does
not prove a notification was delivered historically. In particular, last-triggered
timestamps are not evidence of successful delivery.

The implementation uses workflow detail/list, workflow project scope, and
detector detail endpoints, verified against Sentry's endpoint and serializer
source. Project scope is a private endpoint; missing access fails explicitly.
