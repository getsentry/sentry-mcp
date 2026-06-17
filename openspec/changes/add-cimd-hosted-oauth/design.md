## Context

The hosted MCP server runs behind the Cloudflare Worker in `packages/mcp-cloudflare`. OAuth is delegated to `@cloudflare/workers-oauth-provider`, while this repo owns MCP-specific routing, path-scoped protected-resource metadata, a compatibility authorization-server metadata shim for `/mcp...` paths, and the approval dialog shown before redirecting to Sentry OAuth.

MCP `2025-11-25` recommends OAuth Client ID Metadata Documents (CIMD). In CIMD, a client can use an HTTPS metadata document URL as its OAuth `client_id`, and the authorization server fetches that document to learn the client name, redirect URIs, and supported authentication method. The installed Cloudflare OAuth provider supports this when `clientIdMetadataDocumentEnabled: true` is set and the Worker has the `global_fetch_strictly_public` compatibility flag. The Wrangler configs already include that flag, but the provider option and metadata advertisement are missing.

The implementation must preserve the existing hosted OAuth behavior:

- `/oauth/register` remains available for Dynamic Client Registration.
- `/mcp`, `/mcp/{org}`, and `/mcp/{org}/{project}` resources remain path-scoped.
- Protected-resource metadata continues to round-trip exact resource path and query.
- Authorization-server metadata compatibility documents continue to pre-populate RFC 8707 `resource` on the authorization endpoint.
- Expected OAuth request failures remain user-correctable 4xx responses logged with `logWarn`, not Sentry issues.

## Goals / Non-Goals

**Goals:**

- Enable CIMD in the hosted Cloudflare OAuth provider.
- Advertise CIMD support from root and path-scoped authorization-server metadata.
- Preserve Dynamic Client Registration as the compatibility fallback.
- Verify URL-client authorization requests succeed only when fetched metadata is valid.
- Ensure invalid client metadata fails closed without open redirect behavior.
- Display enough client identity and redirect destination context in the consent UI for URL-based clients.
- Keep scoped MCP resource discovery and authorization behavior unchanged.

**Non-Goals:**

- Do not remove DCR.
- Do not change stdio auth or Sentry device-code auth.
- Do not replace the Cloudflare provider's CIMD implementation with a custom fetcher unless tests prove provider behavior is insufficient.
- Do not add enterprise allowlists, ID-JAG, or managed authorization policy in this change.
- Do not require repo-local `mcp-test-client` CIMD support before shipping server support.
  Optional CIMD mode may still be added as local QA support.

## Decisions

### Enable CIMD through the Cloudflare provider

Set `clientIdMetadataDocumentEnabled: true` on the existing `new OAuthProvider(...)` construction in `packages/mcp-cloudflare/src/server/index.ts`.

Rationale: the provider already owns client lookup, auth request parsing, redirect URI validation, and DCR storage. Using its CIMD support keeps one source of truth for OAuth client behavior and minimizes security-sensitive custom code.

Alternative considered: implement custom CIMD fetching before calling provider APIs. That would duplicate URL validation, metadata parsing, and redirect URI rules, increasing SSRF and validation risk.

### Keep DCR enabled

Leave `clientRegistrationEndpoint: "/oauth/register"` unchanged.

Rationale: MCP clients should prefer CIMD when advertised, but older or simpler clients still rely on DCR. Removing DCR would be an interoperability regression.

Alternative considered: gate DCR behind a compatibility flag. This creates rollout complexity without a current security or product requirement.

### Advertise support in both root and scoped metadata

Root authorization-server metadata is produced by the Cloudflare provider, so tests should confirm it includes `client_id_metadata_document_supported: true` after the provider option is enabled. The repo-owned scoped compatibility metadata in `authorization-server-metadata.ts` must add the same field directly.

Rationale: MCP clients can discover authorization metadata through root RFC 8414 discovery or through the existing path-scoped compatibility endpoints. Both paths must expose consistent capability information so SDK clients choose CIMD instead of DCR when available.

Alternative considered: advertise CIMD only at root. That leaves path-scoped clients on DCR even though the server supports CIMD.

### Treat provider CIMD failures as expected OAuth 4xx failures

Invalid client metadata, metadata fetch failures, redirect URI mismatches, and disallowed client auth methods should return OAuth client errors and be logged as warnings where this repo catches them.

Rationale: these are user/client-correctable failures and should not generate Sentry issues.

Alternative considered: capture all provider lookup failures. That would create noise and could log attacker-controlled metadata URLs or redirect values more broadly than necessary.

### Harden consent display for URL-based clients

The approval dialog already shows client name and redirect destination. For URL-shaped `client_id` values, it should also display the client metadata URL or a sanitized host/path derived from that URL. The redirect URI and redirect host must remain visible, including localhost redirect URIs.

Rationale: CIMD changes client identity from an opaque registered client to a fetched document. A friendly client name alone is not enough for a safe consent decision.

Alternative considered: rely only on fetched `client_name`. That is easy to spoof and weakens user trust decisions.

### Give the hosted demo chat a separate CIMD client identity

Expose a first-party OAuth client metadata document for the hosted demo chat at
`/.well-known/oauth-client/demo-chat.json`. The document describes the web chat
client only: `client_uri` is the deployment root, `redirect_uris` contains only
`/api/auth/callback`, and `/mcp` remains the protected resource requested through
the RFC 8707 `resource` parameter.

Use this CIMD client ID on HTTPS origins. Keep Dynamic Client Registration for
local HTTP development, where a public HTTPS metadata URL is not available.

Rationale: the demo chat backend connects to `/mcp` as an MCP client, but the
MCP server must not identify as its own OAuth client. A separate chat CIMD
document makes the client/resource boundary explicit and gives production a
stable path to dogfood CIMD without adding localhost redirect URIs to the
production client identity.

Alternative considered: use the deployment root or `/mcp` URL as the chat
`client_id`. That blurs the OAuth client and protected resource roles and makes
the consent identity less precise.

## Risks / Trade-offs

- [Risk] Enabling URL-based client IDs expands outbound fetch behavior from the Worker. -> Mitigation: rely on the provider's CIMD validation and keep `global_fetch_strictly_public`; add tests for failure cases and avoid custom fetch bypasses.
- [Risk] Some clients may react differently once metadata advertises CIMD and stop using DCR. -> Mitigation: test an MCP SDK client with `clientMetadataUrl`, test DCR-only clients, and roll out through canary.
- [Risk] Consent UI could hide important client origin details. -> Mitigation: add focused UI tests that assert client identity URL/host, redirect URI, and redirect host are visible.
- [Risk] Scoped metadata could drift from root metadata. -> Mitigation: add tests for root, `/mcp`, `/mcp/{org}`, and `/mcp/{org}/{project}` authorization metadata.
- [Risk] Testing the third-party provider's full behavior may require Worker-runtime support or network fetch mocking. -> Mitigation: prefer integration tests through the Worker route where feasible; otherwise mock only external metadata URL fetches and keep provider APIs real.
- [Risk] The same Worker serves the chat client metadata and validates that metadata through OAuth. -> Mitigation: keep the route public read-only, request-origin-aware, and covered by route tests plus deployed HTTPS smoke testing.

## Migration Plan

1. Add failing tests for metadata advertisement, provider configuration, CIMD authorization behavior, invalid metadata failures, consent identity display, and unchanged scoped resource behavior.
2. Enable `clientIdMetadataDocumentEnabled: true` and add scoped metadata advertisement.
3. Update the approval dialog only if tests show URL-based client identity is not clear enough.
4. Run Cloudflare package tests and type checks.
5. Run the full quality gate before merge.
6. Deploy to canary first and watch OAuth telemetry for invalid client errors, metadata fetch failures, redirect URI failures, and DCR volume changes.

Rollback is a code revert of the provider option and scoped metadata field. Keeping DCR enabled means clients that previously worked through DCR continue to have a fallback during rollback.

## Open Questions

- Should CIMD be always on in production after tests pass, or should the provider option be controlled by an environment flag for canary-only rollout?
- Should the Cloudflare OAuth provider dependency be upgraded before enabling CIMD, or is the installed version sufficient once the targeted tests pass?
