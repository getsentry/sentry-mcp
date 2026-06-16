## Why

Users can inspect linked external issues through MCP today, but they cannot link a Sentry issue to Jira, GitHub, Linear, or other issue trackers without leaving the agent workflow. This is now a visible source of friction in issue #228, and Sentry already exposes the needed UI-backed APIs with provider-specific constraints.

## What Changes

- Extend `update_issue` so it can link a Sentry issue to an existing external issue by URL, in addition to status, ignore, assignment, and reason-comment updates.
- Support native Sentry issue-tracking integrations such as Jira, GitHub, GitLab, Bitbucket, and Azure DevOps through Sentry's group integration endpoint.
- Support Sentry App/platform external links, including Linear and Shortcut-style app links, through the Sentry App external issue endpoint.
- Keep the user-facing API minimal for linking: require only `externalIssueUrl`.
- Resolve the target integration from URL shape, installed native integrations, Sentry App installations, and Sentry's own link configuration. Do not expose native integration ids, Sentry App installation UUIDs, provider hints, or provider form fields as normal user-facing parameters.
- Fail before mutating the Sentry issue when the requested external link target is ambiguous, unavailable, or missing required fields.
- Report partial success clearly when a Sentry status/assignment update succeeds but the subsequent external link operation fails.
- Keep this in `update_issue`; do not add a new MCP tool.

## Capabilities

### New Capabilities

- `issue-linking`: Tool behavior for linking Sentry issues to existing external issue trackers through native integrations and Sentry Apps.

### Modified Capabilities

- None.

## Impact

- `packages/mcp-core/src/tools/update-issue.ts`: new minimal link input parameters, provider URL parsing, validation, execution ordering, and response formatting.
- `packages/mcp-core/src/api-client/client.ts`, `schema.ts`, and `types.ts`: client methods and schemas for integration issue config/linking and Sentry App installation/linking APIs.
- `packages/mcp-core/src/tools/update-issue.test.ts` and API client tests: coverage for link-only, combined update-and-link, ambiguity, validation, and partial-failure behavior.
- `packages/mcp-server-mocks/src/index.ts`: mock responses for native integration linking and Sentry App external issue links.
- Generated tool definitions after schema/description changes.
- Upstream Sentry APIs used by this change:
  - `GET /api/0/organizations/{org}/issues/{issue}/integrations/{integration_id}/?action=link`
  - `PUT /api/0/organizations/{org}/issues/{issue}/integrations/{integration_id}/`
  - `GET /api/0/organizations/{org}/sentry-app-installations/`
  - `POST /api/0/sentry-app-installations/{uuid}/external-issues/`
