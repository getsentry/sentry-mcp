# Manual Testing Guide: OAuth Flow & AsyncLocalStorage

This guide provides steps to manually test the new stateless MCP handler with AsyncLocalStorage and OAuth integration.

## Architecture Overview

The new architecture eliminates Durable Objects and uses:
- **AsyncLocalStorage** for per-request constraint scoping
- **`experimental_createMcpHandler`** from Cloudflare agents library
- **`getMcpAuthContext()`** for OAuth context retrieval
- **Stateless request handling** with dynamic context resolution

## Automated Test Coverage

✅ **All automated tests passing** (81 tests total):
- ✅ AsyncLocalStorage constraint isolation (9 tests)
- ✅ MCP handler integration (14 tests)
- ✅ Server context resolution (8 tests)
- ✅ Constraint verification (9 tests)
- ✅ OAuth helpers (9 tests)
- ✅ All other existing tests

## Manual Testing Checklist

### Local Testing (Development)

#### 1. Start Local Dev Server

```bash
cd packages/mcp-cloudflare
pnpm dev
```

Expected: Server starts on http://localhost:8788

#### 2. Test Basic MCP Endpoint

```bash
# Without constraints
curl http://localhost:8788/mcp

# With org constraint
curl http://localhost:8788/mcp/sentry-mcp-evals

# With org and project constraints
curl http://localhost:8788/mcp/sentry-mcp-evals/cloudflare-mcp
```

Expected:
- Should return 401 (no auth context in local dev without OAuth)
- This is correct behavior - OAuth is required

### Production Testing (Deployed Environment)

#### 1. Deploy to Cloudflare Workers

```bash
cd packages/mcp-cloudflare
pnpm build
pnpm deploy
```

Expected: Deployment succeeds, shows worker URL

#### 2. Test OAuth Flow

**Initial Authorization:**

1. Navigate to your deployed worker URL (e.g., `https://mcp.sentry.dev`)
2. Click "Connect to Sentry" or initiate OAuth flow
3. Verify redirect to Sentry authorization page
4. Grant permissions for:
   - `org:read`
   - `project:read`
   - `issue:read`
   - `issue:write`
5. Verify redirect back to your app
6. Check that OAuth callback succeeds and stores token

**Expected Flow:**
- OAuth state parameter is signed and time-limited (10 minutes)
- Token exchange succeeds
- User is authenticated and can access MCP tools

#### 3. Test MCP Tool Calls with Constraints

Using the test client or MCP inspector:

```bash
# In another terminal, use the test client
cd packages/mcp-test-client

# Test without constraints (should have access to all orgs)
pnpm start:oauth

# Test with org constraint (should scope to specific org)
# This requires the worker to be configured with URL pattern /mcp/:org
```

**Test Cases:**

1. **No constraints** (`/mcp`):
   ```
   - Call find_organizations tool
   - Should return all orgs user has access to
   - Call find_issues with organizationSlug parameter
   - Should work for any org
   ```

2. **Org constraint** (`/mcp/:org`):
   ```
   - Call find_issues WITHOUT organizationSlug parameter
   - Should automatically inject the org from URL
   - Try to access different org
   - Should fail with permission error
   ```

3. **Org + Project constraint** (`/mcp/:org/:project`):
   ```
   - Call find_issues WITHOUT org or project parameters
   - Should automatically inject both from URL
   - Try to access different project
   - Should fail with permission error
   ```

#### 4. Test Concurrent Requests (Constraint Isolation)

This requires multiple simultaneous requests to different constraint paths:

```bash
# Terminal 1: Request with org1
curl -H "Authorization: Bearer $TOKEN" \
  https://mcp.sentry.dev/mcp/org1

# Terminal 2: Simultaneously request with org2
curl -H "Authorization: Bearer $TOKEN" \
  https://mcp.sentry.dev/mcp/org2
```

**Expected:**
- Each request should see only its own constraints
- No cross-contamination between requests
- Response should match the requested org

#### 5. Test OAuth Token Refresh

1. Wait for token to expire (or manually expire it)
2. Make another MCP tool call
3. Verify token is automatically refreshed
4. Verify tool call succeeds with new token

**Expected:**
- Automatic token refresh happens transparently
- User doesn't need to re-authenticate
- Tool calls continue working

#### 6. Test Error Cases

**No Authentication:**
```bash
curl https://mcp.sentry.dev/mcp/test-org
```
Expected: 401 Unauthorized

**Invalid Organization:**
```bash
curl -H "Authorization: Bearer $TOKEN" \
  https://mcp.sentry.dev/mcp/nonexistent-org-12345
```
Expected: 404 Not Found with clear error message

**Invalid Project:**
```bash
curl -H "Authorization: Bearer $TOKEN" \
  https://mcp.sentry.dev/mcp/valid-org/nonexistent-project
```
Expected: 404 Not Found with clear error message

**Insufficient Permissions:**
```bash
# Try to use a write operation with read-only scopes
```
Expected: 403 Forbidden

### Integration Testing with MCP Clients

#### Claude Desktop

1. Add server configuration to `claude_desktop_config.json`:
   ```json
   {
     "mcpServers": {
       "sentry": {
         "url": "https://mcp.sentry.dev/mcp",
         "transport": "http"
       }
     }
   }
   ```

2. Restart Claude Desktop
3. Verify OAuth flow initiates on first use
4. Test tool calls:
   - `find_organizations`
   - `find_issues` with constraints
   - `get_issue_details`

**Expected:**
- Tools appear in Claude's tool list
- OAuth flow completes successfully
- Tools execute with correct constraint scoping

#### Cursor IDE

Similar process with Cursor's MCP configuration.

## Verification Points

After testing, verify:

### ✅ AsyncLocalStorage Isolation
- [ ] Concurrent requests don't see each other's constraints
- [ ] Nested async operations maintain context
- [ ] Constraints are properly cleaned up after request

### ✅ OAuth Integration
- [ ] Initial authorization flow works
- [ ] Token storage and retrieval works
- [ ] Token refresh works automatically
- [ ] getMcpAuthContext() returns correct values

### ✅ Constraint Verification
- [ ] Organization access is verified before tool execution
- [ ] Project access is verified when specified
- [ ] Invalid constraints return appropriate errors
- [ ] Region URL is properly extracted and used

### ✅ Tool Execution
- [ ] Tools receive correct context with constraints
- [ ] getConstraints() returns expected values in tools
- [ ] Scopes are properly enforced
- [ ] Error handling works correctly

## Monitoring & Debugging

### Check Cloudflare Logs

```bash
npx wrangler tail
```

Watch for:
- OAuth callback requests
- Constraint verification calls
- Tool execution traces
- Any errors or warnings

### Check Sentry (Dogfooding)

The app sends telemetry to Sentry:
1. Go to https://sentry.io/organizations/sentry-mcp-evals/
2. Check for any errors in the last hour
3. Look for traces with AsyncLocalStorage context
4. Verify constraint information in traces

### Debug Logs

Key log messages to look for:
- `"Ignoring invalid scopes from OAuth provider"` (warning)
- `"Organization not found"` (error)
- `"Project not found"` (error)
- `"No authentication context available"` (error)

## Known Limitations

1. **AsyncLocalStorage in Cloudflare Workers**: Requires `nodejs_compat` compatibility flag
2. **OAuth State Timeout**: 10-minute expiry on OAuth state parameters
3. **Experimental API**: `experimental_createMcpHandler` may change in future releases

## Rollback Plan

If issues are found in production:

1. Revert to main branch:
   ```bash
   git checkout main
   ```

2. Redeploy:
   ```bash
   cd packages/mcp-cloudflare
   pnpm deploy
   ```

3. The old Durable Objects architecture will be restored

## Success Criteria

✅ All tests pass (automated)
✅ OAuth flow completes successfully (manual)
✅ Constraints are properly isolated (manual)
✅ Tools execute with correct context (manual)
✅ No errors in production logs (monitoring)
✅ Performance is acceptable (< 500ms p95)

## Next Steps After Validation

1. Update documentation in `docs/architecture.mdc`
2. Update deployment docs in `docs/deployment.mdc`
3. Merge PR and deploy to production
4. Monitor for 24 hours
5. Close related issues/tickets
