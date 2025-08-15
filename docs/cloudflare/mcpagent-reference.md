# McpAgent Quick Reference

## Common Scenarios and Solutions

### Q: When is init() called?
**A:** Only twice:
1. When the DO is first created
2. When the DO wakes from hibernation

NOT called for every request.

### Q: When is fetch() called?
**A:** For EVERY request to the DO.

### Q: How are Durable Objects identified?
**A:** By the user ID from OAuth props. One DO per user.

### Q: Can I access request data in init()?
**A:** No. init() has no request context. Use fetch() for request-specific logic.

### Q: How do I handle different URL paths (e.g., /mcp/org1 vs /mcp/org2)?
**A:** 
1. URL paths are lost due to rewriting
2. Pass constraints via headers in your wrapper
3. Handle changes in fetch(), not init()
4. Reconfigure server when constraints change

### Q: Why do constraints need to be in headers?
**A:** The agents library rewrites URLs from `/mcp/org/project` to `/streamable-http`, losing path info. Headers survive this rewrite.

### Q: What's the lifecycle of a typical session?

```
User connects to /mcp/org1:
1. OAuth validates token
2. DO created (if new) or reused (if exists)
3. init() called (if new)
4. fetch() called with org1 constraint
5. Server configured for org1

User switches to /mcp/org2 (same session):
1. OAuth validates token  
2. Same DO instance reused
3. init() NOT called
4. fetch() called with org2 constraint
5. Server MUST be reconfigured for org2

After 30 seconds idle:
1. DO hibernates
2. State saved to storage

User reconnects:
1. DO wakes up
2. init() called
3. fetch() called
4. Server configured with last saved constraints
```

### Q: What data should I store in storage vs memory?

**Storage** (survives hibernation):
- User preferences
- MCP client info
- Last used constraints
- Critical state

**Memory** (instance variables):
- Cached data
- Temporary state
- Computed values
- Current configuration

### Q: How do props work?

Props are:
- Set ONCE when DO is created
- Immutable during DO lifetime
- Passed from OAuth provider
- Available as `this.props`

Props contain:
- `id`: User ID
- `accessToken`: API token
- `name`: User name
- `scope`: OAuth scopes

### Q: Can I modify how the DO ID is generated?
**A:** No, not easily. The OAuth provider controls this, and it uses the user ID from the OAuth token.

### Q: How do I handle errors?

```typescript
async fetch(request: Request): Promise<Response> {
  try {
    // Your logic
    return super.fetch(request);
  } catch (error) {
    // Log error
    console.error('[ERROR]', error);
    
    // Return error response
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
```

### Q: What happens during hibernation?

1. DO removed from memory after ~30 seconds idle
2. Storage is persisted
3. Memory variables are lost
4. On wake: init() called, storage available

### Q: How do I test constraint changes?

```typescript
// In fetch() method
const newConstraints = this.extractConstraints(request);
const constraintKey = this.getConstraintKey(newConstraints);

if (constraintKey !== this.currentConstraintKey) {
  console.log('Constraints changed:', {
    old: this.currentConstraintKey,
    new: constraintKey
  });
  await this.reconfigureServer(newConstraints);
}
```

### Q: What's the difference between serve() and serveSSE()?

- **serve()**: Streamable HTTP transport (recommended, newer)
- **serveSSE()**: Server-Sent Events transport (legacy, still supported)

Both return handlers for the OAuth provider's apiHandlers.

### Q: Can I have multiple DOs for different constraints?
**A:** Not with the current architecture. The OAuth provider creates DOs based on user ID only. To have constraint-based DOs, you'd need to modify the OAuth provider or create a routing layer.

## Common Pitfalls

1. **Assuming init() is called for each request** - It's not!
2. **Trying to access request data in init()** - Not available!
3. **Forgetting to handle hibernation** - Persist critical state!
4. **Not reconfiguring when constraints change** - Server uses old constraints!
5. **Storing too much in storage** - It's expensive, use memory when possible!
6. **Expecting URL paths in fetch()** - They're rewritten to `/streamable-http`!

## Debugging Tips

```typescript
// Log lifecycle events
async init() {
  console.log('[INIT] DO initialized', {
    userId: this.props.id,
    timestamp: new Date().toISOString()
  });
}

async fetch(request: Request) {
  console.log('[FETCH] Request received', {
    headers: Object.fromEntries(request.headers),
    timestamp: new Date().toISOString()
  });
}

// Track constraint changes
if (this.needsReconfiguration(constraints)) {
  console.log('[RECONFIGURE] Constraints changed', {
    old: this.currentConstraints,
    new: constraints
  });
}
```