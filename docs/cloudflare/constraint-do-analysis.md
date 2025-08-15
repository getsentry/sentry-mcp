# Analysis: Constraint-Based Durable Objects

## Current Architecture

Currently:
- **One DO per user**: All requests from same user go to same DO instance
- **Constraints change dynamically**: Same DO handles `/mcp/org1` and `/mcp/org2`
- **Server reconfiguration required**: When constraints change, we reconfigure the MCP server

## Proposed Alternative: Constraint-Based DOs

Create separate DO instances based on user + constraints:

```
DO ID = hash(userId + organizationSlug + projectSlug)
```

### Examples

User "alice" (ID: "user-123"):
- `/mcp` → DO ID: `user-123`
- `/mcp/sentry` → DO ID: `user-123:sentry`
- `/mcp/sentry/javascript` → DO ID: `user-123:sentry:javascript`
- `/mcp/acme` → DO ID: `user-123:acme` (different DO!)

## Pros

1. **No reconfiguration needed**: Each DO is configured once with its constraints
2. **Better isolation**: Different contexts are truly isolated
3. **Simpler code**: No need to detect constraint changes
4. **Natural caching**: Each context maintains its own state
5. **Parallel processing**: User can work in multiple contexts simultaneously

## Cons

1. **More DO instances**: Multiplies DOs by number of unique constraint combinations
2. **State fragmentation**: User state split across multiple DOs
3. **Cold starts**: Each new context requires DO initialization
4. **Memory usage**: More DOs = more memory overhead
5. **Billing implications**: More DO instances and storage usage

## Implementation Challenges

### 1. OAuth Provider Integration

The OAuth provider currently:
- Decrypts token and extracts props (userId, accessToken)
- Creates DO based on these props
- Passes props to the DO

To include constraints, we'd need to:
- Extract constraints BEFORE creating the DO
- Include constraints in the DO ID generation
- Pass constraints as part of props or separately

### 2. Agents Library Limitations

The `McpAgent.serve()` and `McpAgent.serveSSE()` methods:
- Are static methods that return handlers
- Don't have access to request context when creating DO ID
- Rely on OAuth provider to handle DO creation

We'd need to either:
- Modify how the agents library creates DOs (not feasible - external dependency)
- Intercept DO creation in the OAuth provider (complex)
- Create a custom wrapper that manages DO routing (very complex)

### 3. URL Rewriting Issue

The agents library rewrites URLs to `/streamable-http`, so:
- Original path with constraints is lost
- We currently use headers to pass constraints
- With constraint-based DOs, we'd need to ensure correct DO is selected BEFORE URL rewriting

## Feasibility Assessment

### Option 1: Modify OAuth Provider (Complex)

```typescript
// In OAuth provider's apiHandler processing
const extractConstraintsFromPath = (path: string) => {
  // Extract org/project from path
  return { org, project };
};

const createDOId = (userId: string, constraints: any) => {
  if (!constraints.org) return userId;
  if (!constraints.project) return `${userId}:${constraints.org}`;
  return `${userId}:${constraints.org}:${constraints.project}`;
};

// When creating DO
const constraints = extractConstraintsFromPath(request.url);
const doId = createDOId(props.userId, constraints);
const doInstance = env.MCP_OBJECT.idFromName(doId);
```

**Problem**: OAuth provider is external - we can't modify it easily.

### Option 2: Custom DO Router (Very Complex)

Create an intermediate DO that routes to constraint-specific DOs:

```typescript
class MCPRouter extends DurableObject {
  async fetch(request: Request) {
    const constraints = extractConstraints(request);
    const targetDOId = createConstraintBasedId(this.userId, constraints);
    const targetDO = this.env.MCP_OBJECT.idFromName(targetDOId);
    
    // Forward request to constraint-specific DO
    return this.env.MCP_OBJECT.get(targetDO).fetch(request);
  }
}
```

**Problems**:
- Adds complexity and latency
- Requires significant architectural changes
- Still need to handle OAuth integration

### Option 3: Keep Current Approach (Recommended)

The current approach of reconfiguring on constraint changes is actually simpler because:
- Works with existing OAuth provider
- Works with existing agents library
- Single source of truth for user state
- Already implemented and working

## Recommendation

**Keep the current architecture** with server reconfiguration because:

1. **Constraint changes are infrequent**: Users typically work in one context for extended periods
2. **Reconfiguration is fast**: Creating new McpServer instance is lightweight
3. **Simpler architecture**: One DO per user is easier to reason about
4. **Works with existing dependencies**: No need to modify OAuth provider or agents library
5. **Lower operational overhead**: Fewer DOs to manage and monitor

The performance cost of reconfiguration (milliseconds) is negligible compared to the complexity of implementing constraint-based DOs.

## Alternative Optimization

If reconfiguration performance becomes an issue, consider:

1. **Lazy reconfiguration**: Only reconfigure when actually calling a tool, not on every request
2. **Multiple server instances**: Keep a cache of configured servers for recent constraints
3. **Optimized reconfiguration**: Find ways to update constraints without full server recreation

But these optimizations should only be implemented if performance profiling shows they're needed.