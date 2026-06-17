## 1. Metadata and Configuration Tests

- [x] 1.1 Add/extend worker entrypoint tests to assert `new OAuthProvider(...)` receives `clientIdMetadataDocumentEnabled: true` while preserving `/oauth/register`.
- [x] 1.2 Add/extend authorization-server metadata tests for `/.well-known/oauth-authorization-server` to assert `client_id_metadata_document_supported: true` and `registration_endpoint` are present.
- [x] 1.3 Add/extend scoped authorization-server metadata tests for `/mcp`, `/mcp/{org}`, and `/mcp/{org}/{project}` to assert CIMD support and resource-bound authorization endpoints.
- [x] 1.4 Add/extend Wrangler config tests or static assertions to guard that prod, canary, and test configs keep `global_fetch_strictly_public`.

## 2. CIMD OAuth Flow Tests

- [x] 2.1 Add a valid URL-client authorization test where fetched metadata has matching `client_id`, allowed `redirect_uris`, compatible grant/response types, and `token_endpoint_auth_method: "none"`.
- [x] 2.2 Add an approval POST test proving the selected redirect URI is validated against fetched CIMD metadata before upstream redirect.
- [x] 2.3 Add failure tests for metadata fetch non-200, `client_id` mismatch, missing or empty `redirect_uris`, unlisted requested `redirect_uri`, and disallowed `token_endpoint_auth_method`.
- [x] 2.4 Confirm invalid CIMD requests return expected 4xx OAuth/client errors and do not produce upstream authorization redirects.

## 3. Scoped Resource Regression Tests

- [x] 3.1 Keep or add protected-resource metadata coverage for exact `/mcp...` path and query preservation.
- [x] 3.2 Keep or add `WWW-Authenticate` coverage proving the patched `resource_metadata` parameter is path-specific and appears exactly once.
- [x] 3.3 Confirm existing DCR authorization and `/oauth/register` tests still pass with CIMD enabled.

## 4. Server Implementation

- [x] 4.1 Add `clientIdMetadataDocumentEnabled: true` to the Cloudflare `OAuthProvider` options in `packages/mcp-cloudflare/src/server/index.ts`.
- [x] 4.2 Add `client_id_metadata_document_supported: true` to `createScopedAuthorizationServerMetadataResponse(...)`.
- [x] 4.3 Preserve existing DCR registration endpoint behavior and existing RFC 8707 resource binding behavior.
- [x] 4.4 Verify expected client-side OAuth failures are logged with `logWarn` and do not become Sentry-captured issues.

## 5. Consent UI

- [x] 5.1 Add approval-dialog tests asserting CIMD clients show fetched client name plus URL client ID or sanitized client host/path.
- [x] 5.2 Add or preserve approval-dialog tests asserting redirect URI, redirect hostname, and localhost redirect URIs remain visible.
- [x] 5.3 Update `packages/mcp-cloudflare/src/server/lib/approval-dialog.ts` if needed to display URL-based client identity clearly and safely.

## 6. Validation and QA

- [x] 6.1 Run `pnpm --filter @sentry/mcp-cloudflare test`.
- [x] 6.2 Run `pnpm --filter @sentry/mcp-cloudflare tsc`.
- [x] 6.3 Run `pnpm run tsc && pnpm run lint && pnpm run test` before merge.
- [ ] 6.4 Manually QA with an MCP SDK OAuth client configured with `clientMetadataUrl` and verify CIMD is preferred when advertised.
- [ ] 6.5 Manually QA a DCR-only client to confirm fallback compatibility.

## 7. Hosted Demo Chat CIMD Dogfood

- [x] 7.1 Add a public first-party CIMD document for the hosted demo chat at `/.well-known/oauth-client/demo-chat.json`.
- [x] 7.2 Use the demo chat CIMD URL as `client_id` on HTTPS origins while preserving DCR for local HTTP development.
- [x] 7.3 Include the `/mcp` RFC 8707 `resource` parameter in demo chat authorization and token exchange requests.
- [x] 7.4 Add route-level tests for chat metadata, HTTPS CIMD selection, local DCR fallback, and token-resource propagation.
- [x] 7.5 Update repo agent guidance to clarify package roles, OAuth roles, and transport boundaries.
