# Sentry-Bearer Cloudflare Auth

## Overview

The Cloudflare HTTP transport supports an explicit upstream Sentry API token in
the MCP request `Authorization` header:

```http
Authorization: Sentry-Bearer <sentry_api_token>
```

This mode lets trusted clients that already manage Sentry API tokens use the
remote MCP transport without first completing the MCP OAuth flow.

## Motivation

Before this feature, explicit Sentry API tokens were only usable with the
stdio transport. Remote HTTP clients had to use MCP OAuth, even when an
upstream provider had already obtained and refreshed a Sentry token.

The goal is to add a remote equivalent of stdio `--access-token`: the worker
does not validate, store, exchange, or refresh the token. It forwards the token
through the normal MCP server context, and the existing Sentry API client uses
it for upstream API calls.

## Design

`Authorization: Sentry-Bearer <token>` is an explicit direct-auth signal. The
Cloudflare entrypoint handles matching `/mcp...` requests before invoking the
MCP OAuth provider.

Direct-auth requests:

- skip MCP OAuth token validation
- skip grant lookup and grant revocation
- skip upstream Sentry token refresh paths
- do not store the token in KV
- do not pre-validate the token against Sentry
- use the token as `ServerContext.accessToken`
- rely on Sentry API responses for token validity and permissions

`Authorization: Bearer <token>` keeps its existing meaning as a downstream MCP
OAuth access token. Missing auth keeps returning the normal OAuth challenge.
Malformed `Sentry-Bearer` auth returns a direct `401` instead of falling back
to OAuth.

## Interface

### Header

```http
Authorization: Sentry-Bearer <sentry_api_token>
```

The token value must be a single non-empty header token. The worker treats it
as opaque.

### URL

The direct mode uses the same MCP endpoint shapes as OAuth:

```text
/mcp
/mcp/:organizationSlug
/mcp/:organizationSlug/:projectSlug
```

The URL path is still injected into `ServerContext.constraints`. Unlike OAuth,
direct mode does not pre-verify that the token can access the constrained
organization or project before initializing the MCP server. The upstream
Sentry API remains the permission boundary for actual tool calls.

### Skills

Direct mode defaults to all active MCP skills. Clients can narrow tool
exposure with query parameters:

```text
/mcp?skills=inspect,triage
/mcp?disable-skills=seer
```

Invalid skill names return `400`. At least one valid skill must remain enabled.

## Examples

Direct remote MCP configuration for clients that support custom HTTP headers:

```json
{
  "mcpServers": {
    "sentry": {
      "url": "https://mcp.sentry.dev/mcp",
      "headers": {
        "Authorization": "Sentry-Bearer ${SENTRY_ACCESS_TOKEN}"
      }
    }
  }
}
```

Manual MCP request:

```bash
curl https://mcp.sentry.dev/mcp \
  -H "Authorization: Sentry-Bearer $SENTRY_ACCESS_TOKEN" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Implementation

1. Detect `Sentry-Bearer` authorization at the Cloudflare entrypoint before
   routing to the OAuth provider.
2. Reject missing or malformed direct tokens with `401` and a
   `WWW-Authenticate: Sentry-Bearer ...` challenge.
3. Build the MCP server with the provided token, resolved skills, parsed URL
   constraints, and direct-auth telemetry.
4. Reuse the existing Sentry API client paths through `ServerContext`.
5. Keep OAuth refresh, grant lifecycle, and upstream-401 revocation logic scoped
   to OAuth-authenticated requests.

## Testing

Coverage should verify:

- direct `Sentry-Bearer` requests reach the MCP handler without OAuth props
- `Bearer` requests still route through MCP OAuth
- malformed `Sentry-Bearer` requests return `401` without invoking OAuth
- direct mode applies token-scoped rate limiting with hashed token keys
- direct mode supports skill narrowing and rejects invalid skills
- direct mode does not pre-verify URL constraints
- OAuth stale-grant and upstream-401 revocation behavior remains unchanged

## Migration

This is additive. Existing OAuth clients continue using `Authorization:
Bearer <mcp_access_token>`, OAuth discovery, and token refresh unchanged.
Existing stdio clients continue using `--access-token` or
`SENTRY_ACCESS_TOKEN`.

## Future Work

- Add first-class test-client support for custom remote headers if remote
  direct-token QA becomes common.
- Consider a dedicated rate-limiter binding for direct upstream tokens if the
  traffic profile diverges from authenticated OAuth users.
