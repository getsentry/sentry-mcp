## Why

Hosted MCP OAuth should support OAuth Client ID Metadata Documents (CIMD) so MCP clients can use an HTTPS metadata URL as `client_id` instead of relying only on Dynamic Client Registration. MCP `2025-11-25` makes CIMD a recommended interoperability path, and the current hosted Cloudflare OAuth proxy has the required Workers compatibility flag but does not enable or advertise CIMD support.

## What Changes

- Enable CIMD support in the Cloudflare OAuth provider used by the hosted MCP server.
- Advertise `client_id_metadata_document_supported: true` from root and path-scoped authorization-server metadata.
- Preserve Dynamic Client Registration as a fallback for clients that do not support CIMD.
- Validate URL-based `client_id` authorization flows against fetched metadata, including redirect URI and client authentication method constraints.
- Keep protected-resource metadata and `WWW-Authenticate` challenges scoped to the exact `/mcp...` resource path.
- Ensure the OAuth approval UI exposes enough client and redirect-origin information for users to make trust decisions.
- Give the hosted demo chat a first-party CIMD client identity while keeping it separate from the `/mcp` protected resource.

## Capabilities

### New Capabilities

- `hosted-oauth-cimd`: Hosted Cloudflare OAuth supports and advertises Client ID Metadata Documents while preserving DCR fallback and scoped MCP resource behavior.

### Modified Capabilities

- None.

## Impact

- `packages/mcp-cloudflare/src/server/index.ts`
- `packages/mcp-cloudflare/src/server/authorization-server-metadata.ts`
- `packages/mcp-cloudflare/src/server/lib/approval-dialog.ts`
- `packages/mcp-cloudflare/src/server/oauth/routes/authorize.ts`
- `packages/mcp-cloudflare/src/server/routes/chat-oauth.ts`
- `packages/mcp-cloudflare/src/server/routes/chat.ts`
- Cloudflare package OAuth and metadata tests
- `packages/mcp-test-client/src/auth/oauth.ts` for optional CIMD QA and RFC 8707 token-resource parity
- `AGENTS.md` package/OAuth/transport boundary guidance
