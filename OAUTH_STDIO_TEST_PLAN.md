# OAuth Stdio Testing Plan

## Test Environment
- Branch: `oauth-stdio`
- Config location: `~/.config/sentry-mcp-server/config.json`
- OAuth proxy: `https://mcp.sentry.dev`
- Callback port: `6363`

## Test Scenarios

### ✅ Test 1: First-Time OAuth Flow
**Command:**
```bash
cd packages/mcp-server
pnpm start
```

**Expected behavior:**
1. Detects no config exists
2. Detects no access token provided
3. Detects sentry.io host (can use OAuth)
4. Registers OAuth client
5. Opens browser to `https://mcp.sentry.dev/oauth/authorize`
6. User approves in browser
7. Callback received on port 6363
8. Exchanges code for token
9. Saves token to `~/.config/sentry-mcp-server/config.json`
10. Server starts with token

**What to verify:**
- Browser opens automatically
- OAuth approval UI shown
- Config file created with token
- Server starts successfully

---

### ✅ Test 2: Cached Token Reuse
**Command:**
```bash
cd packages/mcp-server
pnpm start
```

**Expected behavior:**
1. Reads config file
2. Finds valid cached token
3. Skips OAuth flow
4. Server starts immediately

**What to verify:**
- No browser opening
- Console says "Using cached OAuth token"
- Server starts quickly

---

### ✅ Test 3: Re-authentication (--reauth)
**Command:**
```bash
cd packages/mcp-server
pnpm start --reauth
```

**Expected behavior:**
1. Console says "Clearing cached OAuth tokens..."
2. Clears tokens from config
3. Performs fresh OAuth flow
4. Opens browser again
5. Gets new token
6. Server starts

**What to verify:**
- Browser opens (even with cached token)
- Config updated with new token
- Server starts successfully

---

### ✅ Test 4: Custom Host Error
**Command:**
```bash
cd packages/mcp-server
pnpm start --host=sentry.example.com
```

**Expected behavior:**
1. Detects custom host
2. Detects no access token
3. Shows error:
   ```
   Error: Access token is required when using a custom Sentry host.

   OAuth authentication is only available for the default Sentry host (sentry.io).
   For self-hosted Sentry instances, please provide an access token:

     --access-token=YOUR_TOKEN
     or set SENTRY_ACCESS_TOKEN environment variable
   ```
4. Exits with error code

**What to verify:**
- Clear error message
- Mentions OAuth is sentry.io only
- Shows how to provide token

---

### ✅ Test 5: Access Token Override
**Command:**
```bash
cd packages/mcp-server
pnpm start --access-token=sntrys_test_token_12345
```

**Expected behavior:**
1. Detects access token provided
2. Skips OAuth flow entirely
3. Uses provided token
4. Server starts

**What to verify:**
- No OAuth flow triggered
- No browser opening
- Server uses provided token

---

### ✅ Test 6: Token Expiration
**Setup:**
1. First get a valid token (Test 1 or 2)
2. Manually edit `~/.config/sentry-mcp-server/config.json`
3. Set `tokenExpiresAt` to a past timestamp

**Command:**
```bash
cd packages/mcp-server
pnpm start
```

**Expected behavior:**
1. Reads config
2. Detects token expired (with 5-minute buffer)
3. Removes expired token
4. Performs fresh OAuth flow
5. Gets new token
6. Server starts

**What to verify:**
- OAuth flow triggered automatically
- Browser opens
- New token saved with new expiration

---

## Additional Tests

### Test 7: Port Already in Use
**Setup:**
```bash
# In another terminal, occupy port 6363
nc -l 6363
```

**Expected behavior:**
- Error about port 6363 already in use
- Clear error message

### Test 8: User Denies OAuth
**Setup:**
- Start OAuth flow
- Click "Deny" in browser

**Expected behavior:**
- Error callback received
- Clear error message shown
- Server exits gracefully

---

## Test Results

| Test | Status | Notes |
|------|--------|-------|
| 1. First-time OAuth | ⏳ Pending | |
| 2. Cached token reuse | ⏳ Pending | |
| 3. Re-authentication | ⏳ Pending | |
| 4. Custom host error | ⏳ Pending | |
| 5. Access token override | ⏳ Pending | |
| 6. Token expiration | ⏳ Pending | |
| 7. Port conflict | ⏳ Optional | |
| 8. User denial | ⏳ Optional | |

---

## Commands Reference

```bash
# Run with OAuth (default sentry.io)
pnpm start

# Force re-auth
pnpm start --reauth

# Use access token (skip OAuth)
pnpm start --access-token=YOUR_TOKEN

# Custom host (requires token)
pnpm start --host=custom.sentry.io --access-token=YOUR_TOKEN

# Check config
cat ~/.config/sentry-mcp-server/config.json

# Clear config
rm -rf ~/.config/sentry-mcp-server/

# Check if server is listening
lsof -i :6363
```
