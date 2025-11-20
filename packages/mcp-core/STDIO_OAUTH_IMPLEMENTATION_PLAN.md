# OAuth Implementation Plan for Stdio MCP Server

## Overview

This document describes the implementation of OAuth authentication for the stdio-based MCP server, allowing users to run `npx @sentry/mcp-server` without providing an access token upfront. Instead, the server will trigger an OAuth browser flow to obtain an access token from the Cloudflare OAuth proxy.

## Goals

1. Enable OAuth authentication for stdio MCP server
2. Eliminate need for users to manually create and provide access tokens
3. Provide seamless browser-based authentication flow
4. Cache tokens for reuse across sessions
5. Support re-authentication via `--reauth` flag

## Key Requirements

### 1. Host Compatibility
- **OAuth ONLY works with default `sentry.io` host** (`mcp.sentry.dev` proxy)
- Custom/self-hosted Sentry instances MUST still use `--access-token` flag
- Clear error messages when OAuth is unavailable

### 2. OAuth Flow Type
- Use **Web Application Flow** (not Device Flow)
- Device Flow is not yet supported by the Cloudflare OAuth proxy
- Local callback server on loopback (127.0.0.1)

### 3. Client Registration
- Dynamically register client using RFC 7591
- Client name format: `"Sentry MCP Server (hostname)"` where hostname is from `os.hostname()`
- Differentiates from test client: `"Sentry MCP Test Client (hostname)"`

### 4. Configuration Storage
- Store credentials in `~/.config/sentry-mcp-server/config.json`
- **DO NOT share config with test client** (`~/.config/sentry-mcp/`)
- Per-MCP-host client registration
- Token caching with expiration (5-minute buffer)

### 5. Port Configuration
- Use port **6363** for OAuth callback server
- Test client uses port 8765 (avoid conflicts)
- Redirect URI: `http://127.0.0.1:6363/callback`

### 6. CLI Flags
- Add `--reauth` flag to force re-authentication
- Remove `--logout` behavior (not needed)

## Implementation Status

### ✅ Completed Steps

#### 1. Created Auth Module Files

**`packages/mcp-server/src/auth/constants.ts`**
```typescript
export const OAUTH_REDIRECT_PORT = 6363;
export const OAUTH_REDIRECT_URI = `http://127.0.0.1:${OAUTH_REDIRECT_PORT}/callback`;
```

**`packages/mcp-server/src/auth/config.ts`**
- Copied from test client, modified config directory
- Config stored in `~/.config/sentry-mcp-server/config.json`
- Key methods:
  - `getOAuthClientId(mcpHost)` - Retrieve stored client ID
  - `setOAuthClientId(mcpHost, clientId)` - Store client ID
  - `getAccessToken(mcpHost)` - Get cached token (checks expiration)
  - `setAccessToken(mcpHost, token, expiresIn)` - Cache token
  - `removeAccessToken(mcpHost)` - Clear cached token
  - `clearAllTokens()` - Clear all cached tokens

**`packages/mcp-server/src/auth/oauth.ts`**
- Main OAuth client implementation
- Uses `os.hostname()` in client name: `Sentry MCP Server (hostname)`
- Key methods:
  - `registerClient()` - Dynamic client registration at `/oauth/register`
  - `startCallbackServer()` - Local HTTP server on port 6363
  - `generatePKCE()` - Creates verifier and SHA256 challenge
  - `generateState()` - Random state for CSRF protection
  - `exchangeCodeForToken()` - Exchanges auth code for access token
  - `getAccessToken()` - Main entry point (checks cache first)
  - `authenticate()` - Full OAuth flow with browser opening

#### 2. Updated CLI Parser

**`packages/mcp-server/src/cli/parse.ts`**
- Added `reauth: { type: "boolean" }` to options
- Added to `parseArgv()` return value
- Added to `merge()` function to pass through from CLI to MergedArgs

**`packages/mcp-server/src/cli/types.ts`**
- Added `reauth?: boolean` to `CliArgs` interface
- Added `reauth?: boolean` to `MergedArgs` interface
- Changed `accessToken: string` to `accessToken?: string` in `ResolvedConfig`

#### 3. Updated CLI Resolve

**`packages/mcp-server/src/cli/resolve.ts`**
- Removed validation requiring `accessToken`
- Added comment: `// Access token is optional - may be provided later via OAuth flow`
- Validation now happens in `index.ts` based on host compatibility

#### 4. Integrated OAuth Flow

**`packages/mcp-server/src/index.ts`** (lines 62-121)
- Changed to use `const merged = merge(cli, env)` and `let cfg = finalize(merged)`
- Added OAuth flow logic after `cfg` creation:
  - Check if OAuth can be used: `const canUseOAuth = !cfg.sentryHost || cfg.sentryHost === "sentry.io"`
  - Determine MCP proxy URL: `const mcpProxyUrl = cfg.mcpUrl || "https://mcp.sentry.dev"`
  - If no access token provided:
    - Error if custom host: `die()` with clear message about needing `--access-token`
    - Handle `--reauth` flag: clear cached tokens
    - Create `OAuthClient` instance
    - Call `getAccessToken()` to perform OAuth flow
    - Update `cfg.accessToken` with obtained token
  - Clear error messages for all scenarios

#### 5. Added Dependencies

**`packages/mcp-server/package.json`**
- Added `"open": "^10.1.0"` to dependencies
- Used by OAuth client to open browser automatically

### ⏳ Pending Steps

#### 6. Run Quality Checks

**Commands to run:**
```bash
cd packages/mcp-server

# Install new dependency
pnpm install

# Type checking
pnpm run tsc

# Linting
pnpm -w run lint

# Unit tests
pnpm test
```

**Expected issues to fix:**
- Import errors if any
- Type mismatches
- Linting issues (formatting, unused imports)

#### 7. Update Documentation

**Files to update:**

**`packages/mcp-server/README.md`**
- Add OAuth flow section
- Explain when OAuth vs access token is used
- Document `--reauth` flag
- Add examples of OAuth usage

**`docs/releases/stdio.mdc`**
- Add OAuth authentication section
- Document auto-detection behavior
- Add troubleshooting for OAuth issues
- Update environment variables section

**`docs/testing-stdio.md`**
- Add section on testing OAuth flow
- Document testing with cached tokens
- Document testing `--reauth` flag

**`CLAUDE.md` (optional)**
- Add note about OAuth support in Core References or Quick Reference

#### 8. Test OAuth Flow Manually

**Test scenarios:**

1. **First-time OAuth flow**
```bash
cd packages/mcp-server
pnpm start
# Should: Open browser, register client, get token, cache it
```

2. **Cached token reuse**
```bash
pnpm start
# Should: Use cached token, no browser opening
```

3. **Re-authentication**
```bash
pnpm start --reauth
# Should: Clear cache, open browser, get new token
```

4. **Custom host error**
```bash
pnpm start --host=sentry.example.com
# Should: Error with message about needing --access-token
```

5. **Access token override**
```bash
pnpm start --access-token=sntrys_xxx
# Should: Skip OAuth, use provided token
```

6. **Token expiration**
```bash
# Edit ~/.config/sentry-mcp-server/config.json
# Set tokenExpiresAt to past timestamp
pnpm start
# Should: Refresh token automatically
```

#### 9. Update Cloudflare OAuth Proxy

**Action required:**
The Cloudflare OAuth proxy needs to allow the new redirect URI.

**Redirect URI to add:**
```
http://127.0.0.1:6363/callback
```

**Where to update:**
- Cloudflare OAuth proxy configuration
- Check if dynamic registration already allows localhost redirects
- May need to add to allowlist if restricted

## Architecture Details

### OAuth Flow Sequence

```
1. User runs: npx @sentry/mcp-server
   ↓
2. index.ts: No access token provided, host is sentry.io
   ↓
3. Create OAuthClient with mcpHost = "https://mcp.sentry.dev"
   ↓
4. OAuthClient.getAccessToken()
   ├─ Check ConfigManager for cached token
   │  └─ If found and not expired → Return token
   └─ If not found → authenticate()
      ↓
5. authenticate(): Register client if needed
   ├─ Check ConfigManager for clientId
   └─ If not found → registerClient()
      ├─ POST /oauth/register with client metadata
      └─ Store clientId in config
      ↓
6. Start local callback server on port 6363
   ↓
7. Generate PKCE verifier and challenge
   ↓
8. Generate state for CSRF protection
   ↓
9. Build authorization URL with params:
   - client_id
   - redirect_uri: http://127.0.0.1:6363/callback
   - response_type: code
   - scope: (empty, determined by user in OAuth UI)
   - state
   - code_challenge
   - code_challenge_method: S256
   ↓
10. Open browser with authorization URL
    ↓
11. User approves in browser, selects skills
    ↓
12. Browser redirects to http://127.0.0.1:6363/callback?code=...&state=...
    ↓
13. Local server receives callback
    ├─ Verify state matches
    └─ Extract code
    ↓
14. exchangeCodeForToken()
    ├─ POST /oauth/token with:
    │  - grant_type: authorization_code
    │  - client_id
    │  - code
    │  - redirect_uri
    │  - code_verifier
    └─ Receive access_token
    ↓
15. Store token in ConfigManager with expiration
    ↓
16. Return access_token to index.ts
    ↓
17. index.ts: Update cfg.accessToken
    ↓
18. Continue with normal server startup
```

### Config File Structure

**Location:** `~/.config/sentry-mcp-server/config.json`

**Format:**
```json
{
  "oauthClients": {
    "https://mcp.sentry.dev": {
      "clientId": "abc123...",
      "mcpHost": "https://mcp.sentry.dev",
      "registeredAt": "2025-01-20T10:00:00.000Z",
      "accessToken": "encrypted_token_here",
      "tokenExpiresAt": "2025-01-20T11:00:00.000Z"
    }
  }
}
```

### Security Considerations

1. **PKCE (Proof Key for Code Exchange)**
   - Uses SHA256 hashing
   - Protects against authorization code interception
   - Required for public clients (no client secret)

2. **State Parameter**
   - Random 16-byte base64url-encoded string
   - Prevents CSRF attacks
   - Verified on callback

3. **Loopback Redirect**
   - Uses 127.0.0.1 (not localhost)
   - Port 6363 specific to this client
   - HTTP acceptable for loopback per OAuth 2.1

4. **Token Storage**
   - Stored in user's home directory
   - File permissions should be user-readable only
   - Tokens have expiration with 5-minute buffer

5. **Client Registration**
   - Per-machine client (identified by hostname)
   - No client secret (public client)
   - Token endpoint auth method: "none"

## Error Handling

### Custom Host Without Access Token

**Scenario:** User runs with `--host=sentry.example.com` and no `--access-token`

**Behavior:**
```
Error: Access token is required when using a custom Sentry host.

OAuth authentication is only available for the default Sentry host (sentry.io).
For self-hosted Sentry instances, please provide an access token:

  --access-token=YOUR_TOKEN
  or set SENTRY_ACCESS_TOKEN environment variable
```

### OAuth Flow Failure

**Scenario:** Browser-based OAuth fails (user denies, network error, etc.)

**Behavior:**
```
OAuth authentication failed: <error details>

If you continue to have issues, you can provide an access token directly:
  --access-token=YOUR_TOKEN
```

### Token Expiration

**Scenario:** Cached token is expired (within 5-minute buffer)

**Behavior:**
- Automatically removes expired token
- Returns `null` from `getAccessToken()`
- Triggers new OAuth flow
- No user intervention required

## Testing Checklist

### Unit Tests
- [ ] Test ConfigManager methods
- [ ] Test OAuth state generation
- [ ] Test PKCE generation
- [ ] Test token expiration logic
- [ ] Test URL building

### Integration Tests
- [ ] Test full OAuth flow end-to-end
- [ ] Test cached token reuse
- [ ] Test --reauth flag
- [ ] Test custom host error
- [ ] Test access token override
- [ ] Test token expiration and refresh

### Manual Tests
- [ ] Fresh OAuth flow on clean system
- [ ] OAuth flow with browser already open
- [ ] Multiple OAuth flows (re-authentication)
- [ ] Token caching across restarts
- [ ] Custom host behavior
- [ ] Access token override behavior

## Open Questions / TODOs

1. **Cloudflare Proxy Configuration**
   - Need to verify redirect URI `http://127.0.0.1:6363/callback` is allowed
   - Check if dynamic registration allows all localhost redirects
   - May need manual allowlist update

2. **Error Messages**
   - Review all error messages for clarity
   - Add troubleshooting URLs if needed
   - Consider adding link to docs

3. **Documentation**
   - Add FAQ section for common OAuth issues
   - Add screenshots of OAuth flow?
   - Document token location for manual cleanup

4. **Future Enhancements**
   - Add `--list-tokens` command to show cached tokens
   - Add `--clear-tokens` command to clear all tokens
   - Support for multiple MCP hosts in config
   - Token refresh support (if proxy supports it)

## Code References

### Key Files Modified/Created

1. **Auth Module:**
   - `packages/mcp-server/src/auth/constants.ts`
   - `packages/mcp-server/src/auth/config.ts`
   - `packages/mcp-server/src/auth/oauth.ts`

2. **CLI Updates:**
   - `packages/mcp-server/src/cli/parse.ts`
   - `packages/mcp-server/src/cli/types.ts`
   - `packages/mcp-server/src/cli/resolve.ts`

3. **Main Integration:**
   - `packages/mcp-server/src/index.ts` (lines 62-121)

4. **Dependencies:**
   - `packages/mcp-server/package.json` (added `open@^10.1.0`)

## Timeline

- **Phase 1 (Completed):** Implementation of auth module and CLI integration
- **Phase 2 (Current):** Quality checks and bug fixes
- **Phase 3 (Next):** Documentation updates
- **Phase 4 (Final):** Manual testing and Cloudflare proxy configuration

## Success Criteria

The implementation is successful when:

1. ✅ Users can run `npx @sentry/mcp-server` without `--access-token`
2. ✅ OAuth flow opens browser automatically
3. ✅ Token is cached for reuse
4. ✅ `--reauth` flag clears cache and triggers new OAuth flow
5. ✅ Custom hosts require `--access-token` with clear error
6. ✅ All quality checks pass (tsc, lint, test)
7. ✅ Documentation is updated
8. ✅ Manual testing confirms all scenarios work

## Notes

- This implementation closely mirrors the test client OAuth implementation
- Key difference: separate config directory to avoid conflicts
- Port 6363 chosen to avoid conflicts with test client (8765) and common development ports
- Client name includes hostname to differentiate multiple machines accessing same MCP host
