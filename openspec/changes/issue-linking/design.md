## Context

`update_issue` currently updates status, ignore state, assignment, and optional reason comments. `get_issue_details` already reads platform external links through `GET /organizations/{org}/issues/{issue}/external-issues/`, but there is no write path.

Sentry has two separate external issue systems:

- Native integrations store `ExternalIssue` plus `GroupLink` and are driven by `GroupIntegrationDetailsEndpoint`. The UI links existing issues with `PUT /organizations/{org}/issues/{issue}/integrations/{integration_id}/`. The required internal fields are provider-specific, but the real providers Sentry supports can be derived from canonical issue URLs in the common case.
- Sentry Apps store `PlatformExternalIssue` and are driven by `SentryAppInstallationExternalIssuesEndpoint`. The endpoint is `POST /sentry-app-installations/{uuid}/external-issues/` with `issueId`, `webUrl`, `project`, and `identifier`. The UUID is an installation UUID, not a user-facing provider id.

The implementation must not use the Sentry App endpoint as a universal Jira/GitHub/Linear solution. It only covers installed Sentry Apps. Native Jira/GitHub-style integrations need the native integration endpoint so provider hooks, comments, sync behavior, and activity are preserved.

## Goals / Non-Goals

**Goals:**

- Add external issue linking to `update_issue` without increasing MCP tool count.
- Support link-only and combined update-plus-link calls.
- Prefer native integration linking when the target provider is a native issue-tracking integration.
- Support Sentry App/platform links when the target is an installed Sentry App, including Linear and Shortcut-style URLs.
- Keep the tool API minimal: link by URL only.
- Keep provider discovery, URL parsing, and payload construction reusable for future external issue creation.
- Validate all link preconditions before mutating the Sentry issue.
- Keep user-facing errors actionable and avoid exposing native integration ids, installation UUIDs, or provider form fields unless needed for diagnostics.

**Non-Goals:**

- Creating new external issues or tickets.
- Unlinking external issues.
- Replacing provider-specific Sentry integration configuration.
- Supporting arbitrary custom Sentry App link schemas.
- Exposing provider-specific form fields as a public MCP API.
- Changing upstream Sentry APIs.

## Decisions

### Use A Minimal Link API

Add only one external linking parameter to `update_issue`:

- `externalIssueUrl`: full URL of the external issue to link.

Rationale: the expected user workflow is "link this Sentry issue to this external issue URL." Native providers need internal fields, but those fields are implementation details that can be parsed from canonical URLs and validated against Sentry's link config.

Alternative considered: exposing `externalIssueIntegrationId`, `externalIssueIdentifier`, `externalIssueProject`, `externalIssueFields`, and `externalIssueKind`. This is more flexible, but it leaks Sentry internals into the MCP API and makes common linking harder for agents. The implementation can still use these concepts internally.

### Separate Link Semantics From Future Create Semantics

Name helper types and API client methods around external issue operations rather than around one provider form. Suggested internal boundaries:

- `parseExternalIssueUrl(url)` returns provider, host/account context, and issue identity for linking.
- `resolveExternalIssueTarget(...)` resolves native integration id or Sentry App installation UUID.
- `buildExternalIssueLinkPayload(...)` creates the internal native or platform link payload.

Do not add creation parameters in this change. Future creation should be a separate action with its own explicit inputs, likely `externalIssueProvider`, optional `externalIssueProject`, optional `externalIssueTitle`, and optional `externalIssueDescription`, because creation does not have an existing URL to parse.

Rationale: linking and creating share provider discovery, but they do not share the same user input model. Linking starts from a canonical external URL. Creating starts from desired ticket metadata and provider defaults.

Alternative considered: add an `externalIssueAction` parameter now with `link` as the only supported value. That is unnecessary API surface until creation exists.

### Resolve Native Integrations Through Sentry's Group Integration List

For native linking, call `GET /organizations/{org}/issues/{issue}/integrations/` to list issue-capable integrations and existing links. Resolve to one integration by:

1. URL parser result for known native providers.
2. Provider host metadata where available, such as GitHub Enterprise, GitLab self-managed, Jira Server, or Azure DevOps instance URLs.
3. Sentry link config validation. For source-control integrations, fetch candidate link configs and choose the integration whose repository choices contain the parsed repository.

If resolution yields zero or multiple integrations, throw `UserInputError` listing candidate provider/name values and ask the user to use a URL that maps to one installed integration or adjust duplicate integration access in Sentry. Do not mutate.

Rationale: users should not need to know Sentry integration ids. Canonical URLs include enough provider-specific context for the supported native providers:

- Jira/Jira Server: `/browse/PROJ-123` -> `externalIssue=PROJ-123`.
- GitHub/GitHub Enterprise: `/{owner}/{repo}/issues/{number}` -> `repo=owner/repo`, `externalIssue=number`.
- GitLab: `/{group}/{project}/-/issues/{iid}` -> `externalIssue=group/project#iid`.
- Bitbucket: `/{workspace}/{repo}/issues/{id}` -> `repo=workspace/repo`, `externalIssue=id`.
- Azure DevOps/VSTS: `/_workitems/edit/{id}` -> `externalIssue=id`.

Alternative considered: search organization integrations globally. The group integration endpoint is better because it already filters to issue-capable integrations and includes existing issue links for that group.

### Build Native Link Payload Internally

After resolving a native integration, fetch link config with `GET /organizations/{org}/issues/{issue}/integrations/{integration_id}/?action=link`.

Build the `PUT` body from the provider parser and config defaults:

1. Start with default values from returned config fields so Sentry's existing backlink/comment defaults are preserved.
2. Override the link target fields parsed from the URL.
3. Validate all config fields marked `required` have non-empty values.
4. For repo/project select fields, verify the parsed repo/project appears in config choices when choices are available.

If required internal fields remain missing, throw `UserInputError` explaining that the URL shape is unsupported for that provider. Do not ask users to provide raw form fields in the first version.

Rationale: this mirrors Sentry's UI behavior while keeping provider-specific forms out of the public MCP API.

Alternative considered: expose an `externalIssueFields` escape hatch. That would support more edge cases, but it is not minimal and effectively asks the LLM/user to understand Sentry's private integration form contract.

### Resolve Sentry App Installations Without Exposing UUIDs

When the URL matches a known Sentry App provider such as `linear` or `shortcut`, call `GET /organizations/{org}/sentry-app-installations/`. Match installations by exact URL-derived app slug. The installation UUID remains internal.

Build the Sentry App payload internally from URL parsers:

- Linear: `linear.app/.../issue/ENG-123/...` -> `project=ENG`, `identifier=ENG-123`.
- Shortcut: `app.shortcut.com/.../story/123/...` -> `project=shortcut`, `identifier=123`.

Rationale: the installation UUID is an implementation detail, and the endpoint only creates platform external links.

Alternative considered: require `externalIssueProject` and `externalIssueIdentifier`. That mirrors the upstream endpoint but makes the MCP API worse; those fields can be inferred well enough for platform links because Sentry does not validate them against the remote provider.

### Mutation Order And Partial Failure

Order handler execution as:

1. Parse issue parameters and fetch current issue.
2. Validate status/assignment/ignore/link inputs.
3. Resolve external link target and build the internal link payload if linking is requested.
4. If no Sentry issue update is needed and only a reason comment is requested, preserve current no-change behavior.
5. Apply Sentry issue status/assignment/ignore update if needed.
6. Apply external link.
7. Post reason comment if requested.
8. Return a combined result.

Resolution and payload validation happen before any mutation. If the issue update succeeds but the external link write fails, return a partial-success message that names the completed Sentry update and the failed link operation.

Rationale: ambiguous or invalid linking must not accidentally change issue state. Once a combined request starts mutating, partial failure needs explicit reporting.

Alternative considered: link first, then update. Existing `update_issue` semantics center on issue updates, and linking may depend on a valid fetched issue id; update first also keeps existing status output anchored on the updated issue.

## Risks / Trade-offs

- URL inference can be wrong for self-hosted or customized integrations -> only infer for recognized URL shapes and exact single matches; otherwise return an unsupported or ambiguous URL error.
- Dynamic provider config can require fields not derivable from a URL -> fail with an actionable unsupported-shape error rather than exposing raw form fields.
- Sentry App and native integration links may both match a provider token -> prefer native integrations for native provider URLs; use Sentry App matching for app-only providers like Linear and Shortcut.
- Combined update-plus-link can partially succeed -> validate before mutation and report link write failures as partial success.
- Adding parameters increases `update_issue` token footprint -> keep descriptions concise and regenerate definitions, then measure token cost.
- The upstream group integration endpoint is deprecated in Sentry source but still powers the UI path -> use it because it is the current behavior source; revisit if Sentry introduces a replacement public endpoint.
