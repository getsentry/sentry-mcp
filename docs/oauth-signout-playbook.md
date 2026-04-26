# OAuth Sign-Out Playbook

Reference for diagnosing why users of the remote MCP server (`mcp.sentry.dev`) lose their authenticated session. Covers the token lifecycle, every failure mode we've identified, what each one looks like in telemetry, and the diagnostic path for a specific user complaint.

## Token lifecycle

Upstream: Sentry's OAuth issues a 30-day access token + rotating refresh token on a completed `/oauth/authorize` flow. `ApiToken.expires_at` defaults to `now + 30 days` (see `getsentry/sentry` `src/sentry/models/apitoken.py`).

MCP wrapper: `@cloudflare/workers-oauth-provider` issues its own shorter-lived wrapper access token (default 1h) backed by the same stored grant. Clients refresh against our `/oauth/token`; we do **not** refresh upstream — we reuse the cached upstream access token for its full 30d lifetime. See `tokenExchangeCallback` in `packages/mcp-cloudflare/src/server/oauth/helpers.ts`.

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
                                        ├─ upstreamTokenInvalid → revoke   └─ 401 → ServerContext.onUpstreamUnauthorized
                                        └─ rate limit check                   → revoke grant + emit grant_revoked
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
| **Same-user concurrent session interference** | Another session of the same user re-authorizes | Resolved by passing `revokeExistingGrants: false` — see Gap #4 below | n/a after fix |

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

User is set via `Sentry.setUser({ id: rawProps.id })` in the callback, so metrics can be filtered by `user.id`. Sub-30d sign-outs surface via `mcp.oauth.grant_revoked{reason:upstream_rejected_in_use}`, not on this metric.

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

Before: Sentry invalidating a token between issuance and its 30d `expires_at` (SSO session end, password change, admin revoke, org change) only showed up as a 401 on the user's tool call. `handleApiError` wrapped it as `UserInputError`, the grant stayed alive, the next `/oauth/token` refresh took the `cached_valid_local` fast path, and the client got a new wrapper token backed by the same dead upstream token — the death spiral.

After:

- `handleApiError` re-throws `ApiAuthenticationError` unwrapped.
- `server.ts` tool-handler catch detects it (walking `error.cause` up to 3 levels) and invokes `context.onUpstreamUnauthorized`.
- `use_sentry`'s tool wrapper does the same check before re-throwing, so 401s inside the embedded agent aren't absorbed by the AI SDK.
- The Cloudflare transport's `onUpstreamUnauthorized` emits `grant_revoked{reason:upstream_rejected_in_use}` and calls `env.OAUTH_PROVIDER.revokeGrant` under `ctx.waitUntil`. `workers-oauth-provider` stores tokens under `token:userId:grantId:*` in KV and validates every access token via a KV lookup, so revoking the grant invalidates all outstanding wrapper tokens too — the client's next `/mcp` request gets a 401 and is forced into a clean re-auth.
- `formatErrorForUser` returns "Authorization Expired — please re-authorize" instead of falling through to the generic Input Error template.

### Gap #2 — `handleApiError` misclassified 401 — **closed**

Fixed alongside Gap #1. `ApiAuthenticationError` now propagates unwrapped and triggers a dedicated branch in `formatErrorForUser`.

### Gap #3 — tool-call `clientInfo` lost on stateless transport

`mcp.client.name` is `null` on 100% of tool-call spans because `createMcpHandler` (from `agents@0.3.10`) creates a fresh `WorkerTransport` per request, and `clientInfo` is only captured during `initialize`. Closing this would require persisting `clientInfo` keyed by MCP session id (e.g., in `MCP_CACHE` KV) and reinjecting it per-request. Not blocking for OAuth diagnosis — user-agent family is an adequate substitute — but worth fixing for tool-level telemetry.

### Gap #4 — Same-user concurrent session interference — **closed**

`workers-oauth-provider`'s `completeAuthorization` defaulted to revoking every existing grant for `(userId, clientId)` whenever a new authorization completed. Because Claude Code persists its DCR `client_id` across processes (e.g., across project folders, or after an update triggers re-auth in one session), one process re-authorizing would silently invalidate every other active session for the same user. The affected sessions saw 401s from the OAuth library on their next `/mcp` request — *before* reaching our handler — so no `grant_revoked` metric ever fired. See issue #924.

We now pass `revokeExistingGrants: false` to `completeAuthorization`. Multiple grants for the same `(userId, clientId)` coexist; each lives until its own `refreshTokenTTL` (30d) or an explicit revoke. This matches how mainstream OAuth servers (Google, GitHub, Auth0, etc.) behave; the library's prior default was an unusual policy.

Trade-off: KV storage holds extra grant entries (each up to 30d). Not a real concern at current scale. Library-side auto-revokes remain the only revocation pathway invisible to our metrics — a follow-up could explicitly count `listUserGrants` matches before each completion.

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
- #919 — added `expired_on_schedule` on `upstream_rejected`. Removed in #920 once we realized the probe path can't produce `"false"` by construction.
- #920 — closes Gaps #1 and #2 via tool-call 401 detection, grant revocation, and `grant_revoked{reason:upstream_rejected_in_use}`. Also removes the unreachable `expired_on_schedule` attribute and its `upstreamExpiresAt` grant field.
