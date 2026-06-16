## 1. API Client Surface

- [x] 1.1 Add schemas and types for native issue integrations, link config fields, native link responses, and Sentry App installations.
- [x] 1.2 Add `listIssueIntegrations`, `getIssueIntegrationLinkConfig`, and `linkNativeExternalIssue` API client methods for the group integration endpoints.
- [x] 1.3 Add `listSentryAppInstallations` and `createSentryAppExternalIssueLink` API client methods for platform external issue links.
- [x] 1.4 Add API client tests for request paths, methods, request bodies, and response parsing.

## 2. Link Resolution Helpers

- [x] 2.1 Implement canonical URL parsers for Jira/Jira Server, GitHub/GitHub Enterprise, GitLab, Bitbucket, Azure DevOps/VSTS, Linear, and Shortcut.
- [x] 2.2 Implement native integration resolution from parsed URL, host metadata, and Sentry link config validation.
- [x] 2.3 Implement Sentry App installation resolution from parsed URL without exposing UUIDs in errors.
- [x] 2.4 Implement native link payload construction from URL parser output and Sentry link config defaults.
- [x] 2.5 Implement Sentry App payload construction from URL parser output.
- [x] 2.7 Add focused helper tests for provider parsing, native resolution, Sentry App resolution, ambiguity, unsupported URL shapes, and helper separation.

## 3. `update_issue` Tool

- [x] 3.1 Add `externalIssueUrl` to the input schema and tool description.
- [x] 3.2 Extend validation so link-only requests are valid and unsupported or ambiguous external link URLs produce `UserInputError`.
- [x] 3.3 Resolve and validate external link targets before any status, ignore, or assignment mutation.
- [x] 3.4 Execute native integration and Sentry App link writes after any required Sentry issue update.
- [x] 3.5 Format successful link changes in the `## Changes Made` section and include current linked issue details when available.
- [x] 3.6 Return explicit partial-success output when the Sentry issue update succeeds but the external link write fails.
- [x] 3.7 Document in tool description that `externalIssueUrl` links an existing external issue and does not create a new ticket.

## 4. Mocks And Tests

- [x] 4.1 Add MSW mocks for issue integration listing, native integration link config, native integration link PUT, Sentry App installation listing, and Sentry App external issue POST.
- [x] 4.2 Add `update_issue` tests for native link-only success, combined update plus native link, URL parsing for each supported native provider, unsupported URL shapes, and ambiguous native integrations.
- [x] 4.3 Add `update_issue` tests for Linear and Shortcut Sentry App link success, ambiguous Sentry App installations, and no UUID leakage.
- [x] 4.4 Add regression tests proving failed link resolution does not call the issue update endpoint.
- [x] 4.5 Add regression tests proving link write failure after issue update is reported as partial success.

## 5. Generated Artifacts And Verification

- [x] 5.1 Run `pnpm run --filter @sentry/mcp-core generate-definitions` after tool schema and description changes.
- [x] 5.2 Run `pnpm run measure-tokens` and verify the `update_issue` description remains acceptable for tool-token budget.
- [x] 5.3 Run `pnpm run tsc`.
- [x] 5.4 Run `pnpm run lint`.
- [x] 5.5 Run `pnpm run test`.
