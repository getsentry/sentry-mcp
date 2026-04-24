# OAuth Sign-Out Playbook

Reference for diagnosing why users of the remote MCP server (`mcp.sentry.dev`) lose their authenticated session. Covers the token lifecycle, every failure mode we've identified, what each one looks like in telemetry, and the diagnostic path for a specific user complaint.

## Token lifecycle

Upstream: Sentry's OAuth issues a 30-day access token + rotating refresh token on a completed `/oauth/authorize` flow. `ApiToken.expires_at` defaults to `now + 30 days` (see `~/src/sentry/src/sentry/models/apitoken.py`).

MCP wrapper: `@cloudflare/workers-oauth-provider` issues its own shorter-lived wrapper access token (default 1h) backed by the same stored grant. Clients refresh against our `/oauth/token`; we do **not** refresh upstream — we reuse the cached upstream access token for its full 30d lifetime. See `packages/mcp-cloudflare/src/server/oauth/helpers.ts:530`.

```
MCP client ──(refresh wrapper token)──> /oauth/token ──> tokenExchangeCallback
                                                            │
                                                            ├─ local expires_at in future → cached_valid_local
                                                            ├─ local expired → probe /api/0/auth/ upstream
                                                            │                   ├─ 200 → cached_valid_probed, extend 2h
                                                            │                   ├─ 4xx → upstream_rejected, mark invalid
                                                            │                   └─ 5xx/timeout → verification_indeterminate
                                                            └─ new wrapper access token issued

MCP client ──(tool call)──> /mcp ──> mcp-handler ──> tool handler ──> SentryApiService (upstream /api/0/…)
                                        │                                  │
                                        ├─ upstreamTokenInvalid → revoke   └─ 401 here is currently only surfaced as
                                        └─ rate limit check                   UserInputError to the client
```

## Failure modes

| Mode | Trigger | Currently visible in telemetry | Detected by |
|---|---|---|---|
| **Natural 30d expiry** | Upstream `expires_at` passes | Yes | Probe path in `tokenExchangeCallback` → `upstream_rejected` |
| **Premature Sentry-side invalidation (SSO / org / password / admin)** | Sentry revokes before `expires_at` | Yes | Tool call surfaces 401 → `grant_revoked{reason:upstream_rejected_in_use}` + grant revoked via `onUpstreamUnauthorized` callback |
| **Stale grants from before `refreshToken` was stored in props** | Old grants from pre-#537 deploys | Yes | `mcp-handler` → `grant_revoked{reason:stale_props_no_refresh}` |
| **Client-side state loss (DCR state reset, fresh install, reinstall)** | Client drops its stored `client_id`/`refresh_token` | Indirectly | High `/oauth/register` volume and `register:callback` ratio per `client_family` |
| **Invalid redirect URI at authorize** | Client sends an `redirect_uri` that's not registered | Yes | Log `OAuth authorization failed: Invalid redirect URI` with `clientId`/`redirectUri`/`registeredUris`/`clientName` |
| **Upstream probe transient (5xx / rate limit / network)** | Sentry side instability | Yes | `token_exchange{outcome:verification_indeterminate, probe_reason:…}` (does not force sign-out) |

## Telemetry surface

All metrics live in the `mcp-server` project on Sentry. Attribute values deliberately avoid the substring `"token"` because Sentry's default PII scrubber replaces those values with `[Filtered]` at ingest (see PR #916 for the migration).

### `mcp.oauth.token_exchange` (counter)

Fired for every `grant_type=refresh_token` request. Splits by `outcome`:

- `cached_valid_local` — fast path, local expiry still in future by >2 min
- `cached_valid_probed` — probe confirmed still valid, `accessTokenExpiresAt` extended by 2h
- `upstream_rejected` — probe returned 4xx, grant marked invalid, next `/mcp` request will revoke
- `verification_indeterminate` — probe returned 5xx/429/network error; wrapper falls back to default behavior, grant stays alive

Attributes:

- `outcome` — see above
- `client_family` — bucketed User-Agent (`claude-code`, `cursor`, `codex`, `copilot`, `claude-desktop`, `opencode`, `reactor-netty`, `java-http-client`, `go-http-client`, `python`, `bun`, `node`, `other`, `unknown`)
- `grant_shape` — currently always `refreshable`
- `probe_status` — upstream HTTP status on outcomes where a probe fired (`200` / `400` / `401` / `403` / `429` / `500` / …)
- `probe_reason` — `rate_limit` / `server_error` / `unknown` on `verification_indeterminate`
- `expired_on_schedule` — on `upstream_rejected` only; `"true"` if `upstreamExpiresAt` is in the past, `"false"` if scheduled expiry is still in the future, `"unknown"` for legacy grants. **Currently only produces `"true"` or `"unknown"` — see Gap #1.**

User is set via `Sentry.setUser({ id: rawProps.id })` in the callback, so metrics can be filtered by `user.id`.

### `mcp.oauth.grant_revoked` (counter)

Fired when we revoke a stored grant — either the MCP handler on a subsequent request, or the `onUpstreamUnauthorized` callback on a mid-session 401.

Attributes:

- `reason` — `stale_props_no_refresh` / `upstream_rejected` / `upstream_rejected_in_use`
- `client_family`
- `user.id` (via `Sentry.setUser`)

`upstream_rejected_in_use` indicates Sentry returned 401 to a tool call while the stored access token still looked locally valid — the sub-30d sign-out signal users typically report. The grant is revoked via `env.OAUTH_PROVIDER.revokeGrant` under `ctx.waitUntil`, short-circuiting the death-spiral where subsequent refreshes kept handing out wrapper tokens backed by a dead upstream token.

### `mcp.oauth.callback_completed` (counter)

Fired on a successful `/oauth/callback`. Pairs with `grant_revoked` to derive per-user session lifetime.

Attributes:

- `client_family` — resolved from the DCR-registered `client_name` (not the browser User-Agent, which is always a browser string on this endpoint)
- `user.id`

### `mcp.oauth.register` (counter)

Fired from the `wrappedOAuthProvider` after the library handles a successful `/oauth/register`.

Attributes:

- `client_family` — from the client's User-Agent (accurate here — DCR is hit directly by the MCP client, not via browser)

### Structured logs

`OAuth authorization failed: Invalid redirect URI` (both GET and POST `/oauth/authorize`) and `Redirect URI not registered for client on callback` now carry `clientId`, `redirectUri`, `registeredUris`, `clientName` as `extra` fields.

## Diagnostic queries

Copy/paste-ready. All use the Sentry MCP's `search_events` natural-language query.

### Is a specific user being revoked?

```
metric mcp.oauth.grant_revoked filtered by user.id:"<id>" sum of value grouped by reason over 30 days
```

### Per-client sign-out rate

```
metric mcp.oauth.grant_revoked sum of value grouped by client_family, reason over 24 hours
```

### Probe-failure status distribution (is Sentry ever returning 403/400?)

```
metric mcp.oauth.token_exchange filtered by outcome:upstream_rejected sum of value grouped by probe_status over 7 days
```

### Session-lifetime proxy (callbacks vs revocations per client)

```
metric mcp.oauth.callback_completed sum of value grouped by client_family over 7 days
metric mcp.oauth.grant_revoked sum of value grouped by client_family over 7 days
```

### Register storm attribution

```
metric mcp.oauth.register sum of value grouped by client_family over 7 days
```

### Upstream instability bucket

```
metric mcp.oauth.token_exchange filtered by outcome:verification_indeterminate sum of value grouped by probe_reason over 24 hours
```

### Invalid redirect URI failures by client

```
logs message:"Invalid redirect URI" over 24 hours, sorted by timestamp
```

## Known gaps

### Gap #1 — Premature Sentry-side invalidation — **closed**

When Sentry invalidates a user's access token between issuance and the 30d `expires_at` (SSO session ends, user changes password, admin revokes, org membership changes), this surfaces as a 401 from Sentry when the user's tool call hits the upstream API. Previously invisible: the grant stayed alive and `tokenExchangeCallback` kept issuing wrapper tokens backed by a dead upstream token (death spiral).

Now:

1. `handleApiError` (`packages/mcp-core/src/internal/tool-helpers/api.ts`) no longer wraps `ApiAuthenticationError` as `UserInputError` — it re-throws so the server-level catch can act on it.
2. The tool-handler catch block in `packages/mcp-core/src/server.ts` detects `ApiAuthenticationError` and invokes `context.onUpstreamUnauthorized` when present.
3. The Cloudflare transport wires `onUpstreamUnauthorized` to emit `grant_revoked{reason:upstream_rejected_in_use}` and revoke the grant via `env.OAUTH_PROVIDER.revokeGrant` under `ctx.waitUntil`.
4. The user-facing error text is now "Authorization Expired — please re-authorize" instead of a misleading "Input Error."

What `expired_on_schedule` doesn't help with is still true: the probe only fires when local expiry passes, so the probe-time classification can never show `"false"`. Left in place for legacy compatibility but ignored in queries.

### Gap #2 — `handleApiError` misclassified 401 — **closed**

Fixed alongside Gap #1. `ApiAuthenticationError` now propagates unwrapped.

### Gap #3 — tool-call `clientInfo` lost on stateless transport

`mcp.client.name` is `null` on 100% of tool-call spans because `createMcpHandler` (from `agents@0.3.10`) creates a fresh `WorkerTransport` per request, and `clientInfo` is only captured during `initialize`. Documented at `packages/mcp-cloudflare/src/server/lib/mcp-handler.ts`. Closing this would require persisting `clientInfo` keyed by MCP session id and reinjecting it per-request. Not blocking for OAuth diagnosis (user-agent family is an adequate substitute for the sign-out investigation) but worth fixing for tool-level telemetry.

## Runbook — "a user says they got signed out"

1. **Check `grant_revoked` for the user** over the relevant window:
   `metric mcp.oauth.grant_revoked filtered by user.id:"<id>" grouped by reason over 30 days`
2. **Interpret the `reason`:**
   - `upstream_rejected_in_use` — Sentry invalidated the token mid-session (SSO / org / password / admin revocation). Most common for sub-30d sign-outs. The grant was revoked automatically; user should re-auth cleanly on next request.
   - `upstream_rejected` — natural 30d expiry (probe path). Expected.
   - `stale_props_no_refresh` — legacy grant predating PR #537. Expected, one-time.
3. **If no revocations are recorded** (reason counts are empty), the user hasn't been revoked server-side. Either they're still authenticated and the perception is wrong, OR the client lost local state and re-registered without going through `/oauth/callback`:
   - Check `mcp.oauth.register grouped by client_family` for that client — high register:callback ratio (claude-code and cursor re-register on every cold start) is normal client behavior, not a server-side sign-out.
4. **If reporting a specific time**, query `POST /oauth/token` transactions for that `user.id` around that timestamp. Transaction duration and child `GET /api/0/auth/` span tell you whether probes fired.

## Related PRs

- #916 — restored sign-out telemetry (scrubber rename) and reduced probe volume.
- #917 — carried probe status as a metric attribute.
- #918 — added `client_family`, user tagging, `callback_completed` / `register` metrics, `probe_reason`, structured Invalid-redirect-URI fields.
- #919 — added `expired_on_schedule` on `upstream_rejected`. Operationally inert (see Gap #1 closure note).
- _(next)_ — closes Gaps #1 and #2: tool-call 401 detection, grant revocation, `grant_revoked{reason:upstream_rejected_in_use}`.
