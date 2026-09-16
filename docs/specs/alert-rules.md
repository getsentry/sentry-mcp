# Alert rule editing

`update_alert_rule` edits an existing **Alert** in Sentry's Alerts UI. An Alert
is a notification workflow; the connected monitors decide what it watches.
This operation changes the alert's name, enabled state, notification frequency,
environment, owner, triggers, filters, and notification actions. It does not
change monitor connections or Metric Monitor detection queries and thresholds.

## Tool flow

The tool belongs to the `project-management` skill and is available through
`search_sentry_tools` and `execute_sentry_tool`. It does not add a top-level MCP
tool.

1. Find the alert with `find_alert_rules`.
2. Read its complete configuration with `get_alert_rule(kind='issue', ...)`.
   The existing `issue` selector identifies workflow alerts. The `metric`
   selector still reads the separate metric alert API.
3. Execute `update_alert_rule` with its workflow ID and the fields to change.
   Exact-name lookup requires a project and rejects ambiguous or incomplete
   search results.

Omitted fields remain unchanged. Explicit `null` clears `owner` or
`environment`. `frequencyMinutes` accepts zero. The handler reads the current
alert and always sends its name and enabled state: Sentry's workflow API
defaults `enabled` to `true` even for updates.

`triggers` replaces the trigger conditions. `actionFilters` replaces the full
list of action groups, including their conditions and actions. Copy the complete
configuration from the read result, retain existing IDs, and edit the intended
values. Omitting a group or action from this replacement removes it. An empty
array explicitly removes all action groups.

The read and update results expose the documented editable configuration in
structured content. Component IDs are included because they are needed for
subsequent edits. Lists are not truncated; unrelated backend metadata is omitted.

## Changing a Slack destination

Read the alert, copy all `actionFilters`, and change the Slack action's
`config.targetDisplay` to the new channel name. Preserve `integrationId`, action
IDs, filters, and all other actions. If the copied `targetIdentifier` still
contains the old channel ID, the handler removes it so Sentry resolves the new
name using that Slack integration. An explicitly supplied new channel ID is
preserved. The integration must have access to the destination.
If Sentry saves the alert without resolving a Slack channel ID, the tool reports
that the alert was saved but the destination remains unresolved. Read it again
and retry with the channel name and explicit channel ID.

## Authorization and project scope

The operation declares `org:read`, `project:read`, and `alerts:write` scopes.
Both stdio device authorization and hosted OAuth request `alerts:write`.
Existing OAuth tokens do not gain new scopes automatically; reconnect if the
token lacks alert write access.

For a project-constrained session, the handler reads the workflow's project
scope and permits the write only when every affected project is the constrained
project. Shared alerts, all-project alerts, and alerts without project evidence
are rejected. An organization-scoped session can edit shared alerts.

## API contract

The implementation uses the existing Sentry API client with:

- `GET /organizations/{organization}/workflows/{id}/`
- `PUT /organizations/{organization}/workflows/{id}/`
- `GET /organizations/{organization}/workflows/{id}/project-scope/`

The workflow validators, serializers, Slack action validator, and project-scope
endpoint were checked against Sentry source. Writes are synchronous. Creation,
deletion, and Metric Monitor operations are separate changes.
