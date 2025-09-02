# McpAgent Architecture Documentation

## Overview

McpAgent is a base class from the Cloudflare agents library that provides the foundation for building MCP (Model Context Protocol) servers as Durable Objects. It handles the protocol transport, state management, and lifecycle of MCP server instances.

Our Sentry MCP implementation extends this base class to provide authenticated, constraint-scoped access to Sentry's API through MCP tools and resources.

## Key Components

### 1. Sentry MCP Agent Implementation

```typescript
class SentryMCPBase extends McpAgent<
  Env,
  { constraints?: Constraints },
  WorkerProps & {
    organizationSlug?: string;
    projectSlug?: string;
  }
> {
  // MCP server created in constructor for performance
  server = new McpServer({
    name: "Sentry MCP",
    version: LIB_VERSION,
  });
  
  // Lifecycle methods
  async init(): Promise<void>;
  async fetch(request: Request): Promise<Response>;
  
  // State management (simplified)
  state: { constraints?: Constraints };
  setState(state): void;
}
```

### 2. Transport Methods and Constraint Handling

McpAgent supports two transport protocols:

- **`serve()`**: Streamable HTTP transport (recommended)
- **`serveSSE()`**: Server-Sent Events transport (legacy)

Our implementation adds **constraint verification** before routing to handlers:

```typescript
// Usage in index.ts
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    
    // SSE endpoint
    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      return SentryMCP.serveSSE("/sse").fetch(request, env, ctx);
    }
    
    // Pattern match for constraint extraction
    const pattern = new URLPattern({ pathname: "/mcp/:org?/:project?" });
    const result = pattern.exec(url);
    if (result) {
      const { groups } = result.pathname;
      
      // Extract constraints from URL
      const organizationSlug = groups?.org ?? "";
      const projectSlug = groups?.project ?? "";
      
      // Verify access using OAuth token
      const verification = await verifyConstraintsAccess(
        { organizationSlug, projectSlug },
        {
          accessToken: ctx.props?.accessToken,
          sentryHost: env.SENTRY_HOST || "sentry.io",
        }
      );
      
      if (!verification.ok) {
        return new Response(verification.message, {
          status: verification.status,
        });
      }
      
      // Mutate props with verified constraints
      ctx.props.constraints = verification.constraints;
      
      return SentryMCP.serve(pattern.pathname).fetch(request, env, ctx);
    }
    
    return new Response("Not found", { status: 404 });
  },
};
```

## Lifecycle

### 1. Durable Object Creation

```
Request arrives → URL pattern matching → Constraint verification → 
OAuth Provider validates token → Extracts props from token → 
Mutates props with constraints → Creates DO with sessionId → 
DO instance created → init() called
```

**Key points:**
- DO ID (sessionId) is generated from connection context by agents library
- Different constraint contexts get separate DO instances
- Props are mutated with verified constraints before DO creation
- DO persists in memory between requests (~30 seconds idle timeout)

### 2. Request Flow

```
First Request (DO Creation):
1. URL pattern matching extracts org/project from path
2. verifyConstraintsAccess() validates org/project exist and user has access
3. OAuth provider validates token
4. Props mutated with verified constraints
5. DO instance created with unique sessionId for this constraint context
6. init() called - configures MCP server with constraints
7. fetch() called for the request (guaranteed after init() completes)
8. Returns response

Subsequent Requests (Same Constraint Context):
1. Routes to existing DO instance (same sessionId)
2. fetch() called - init() is NOT called again
3. Returns response

After Hibernation:
1. DO wakes from hibernation
2. init() called to restore state and reconfigure MCP server
3. fetch() called for the request (guaranteed after init() completes)
4. Returns response
```

**Important Lifecycle Guarantee**: McpAgent ensures `init()` always completes before `fetch()` is called. This is guaranteed both on DO creation and when waking from hibernation.

**Constraint Immutability**: Once props are mutated with constraints and the DO is created, the constraint configuration remains immutable throughout the DO's lifetime.

### 3. Method Responsibilities

**`init()`**:
- Called when DO is created or wakes from hibernation
- Configures the MCP server with user authentication and constraints
- Restores constraint state from props
- NOT called for every request

**`fetch()`**:
- Called for EVERY request
- Handles the actual MCP protocol communication
- Can access `this.props` including mutated constraints
- All MCP tools automatically scoped to the constraint context
- Returns the MCP response

## Props System

Props are the bridge between OAuth, constraint verification, and the Durable Object:

```typescript
// Base props from OAuth
type WorkerProps = ServerContext & {
  id: string;           // User ID from OAuth token
  name: string;         // User name
  scope: string;        // OAuth scopes
  accessToken: string;  // Sentry API token
};

// Extended props with constraints
type ExtendedProps = WorkerProps & {
  organizationSlug?: string;  // Extracted from URL
  projectSlug?: string;       // Extracted from URL
  constraints?: Constraints;  // Verified constraints
};
```

**How props work:**
1. URL pattern matching extracts org/project from request path
2. `verifyConstraintsAccess()` validates constraints using OAuth token
3. OAuth provider decrypts the OAuth token and extracts base props
4. Props are mutated with verified constraints before DO creation
5. DO can access complete props via `this.props`

**Important:** Props are mutated once during request routing, then remain immutable throughout the DO's lifetime.

## Constraint Verification System

The constraint verification system validates org/project access before DO creation:

```typescript
export async function verifyConstraintsAccess(
  { organizationSlug, projectSlug }: Constraints,
  { accessToken, sentryHost }: { accessToken: string; sentryHost?: string }
): Promise<
  | { ok: true; constraints: Constraints }
  | { ok: false; status: number; message: string; eventId?: string }
> {
  // Verify organization exists and user has access
  const org = await api.getOrganization(organizationSlug);
  const regionUrl = org.links?.regionUrl || null;
  
  // Verify project access if specified
  if (projectSlug) {
    await api.getProject(
      { organizationSlug, projectSlugOrId: projectSlug },
      regionUrl ? { host: new URL(regionUrl).host } : undefined
    );
  }
  
  return {
    ok: true,
    constraints: { organizationSlug, projectSlug, regionUrl },
  };
}
```

**Benefits:**
- Early validation prevents unauthorized access
- Regional URL detection for proper API routing
- Consistent error handling with proper HTTP status codes
- Integration with Sentry error tracking

## State Management

Our implementation uses simplified state management focused on constraints:

```typescript
// State structure
type State = {
  constraints?: Constraints;
};

// In init()
if (!this.state) {
  this.setState({
    constraints: this.props.constraints,
  });
}

// Access state
const constraints = this.state.constraints || {};
```

State is persisted automatically and restored after hibernation. The constraints from props are preserved in state for consistency.

## Storage

Durable Objects have access to persistent storage:

```typescript
// Store data
await this.ctx.storage.put("key", value);

// Retrieve data
const value = await this.ctx.storage.get("key");

// Delete data
await this.ctx.storage.delete("key");
```

Storage persists across DO hibernation and restarts.

## Hibernation

After ~30 seconds of inactivity:
1. DO goes to sleep (removed from memory)
2. State is persisted to storage
3. On next request, DO wakes up
4. `init()` is called to restore state
5. Normal request processing resumes

## Integration with OAuth Provider

The OAuth provider and McpAgent work together:

```
OAuth Provider                          McpAgent
-------------                          ---------
1. Receives request                    
2. Validates OAuth token               
3. Extracts props from token          
4. Generates DO ID from props         
5. Gets/creates DO instance     →     Constructor called (if new)
6. Passes props to DO           →     Props available as this.props
7. Calls handler.fetch()        →     init() called (if new/hibernated)
                                →     fetch() called
                                ←     Returns response
8. Returns response to client
```

## Limitations and Constraints

1. **Static handler creation**: `serve()` and `serveSSE()` are static methods, can't access instance data
2. **Props are immutable**: Set once at DO creation, can't be updated
3. **URL rewriting**: Original paths lost during transport, must use headers
4. **One DO per user**: DO ID based on userId, all user requests go to same instance
5. **No request context in init()**: Can't access request data during initialization
6. **Constraint immutability**: Constraints are verified and set once at DO creation, remaining immutable throughout the DO's lifetime. Different constraint contexts create separate DO instances via unique sessionIds.

## Best Practices

1. **Verify constraints early**: Use `verifyConstraintsAccess()` before DO creation
2. **Use storage sparingly**: Storage operations are expensive
3. **Cache in memory**: Use instance variables for frequently accessed data
4. **Prepare for hibernation**: Constraints are preserved in state automatically
5. **Trust lifecycle guarantees**: McpAgent ensures init() completes before fetch()
6. **Leverage immutable constraints**: Once set, constraints don't change - design accordingly

## Implementation Reference

The actual implementation can be found in:
- Main class: @packages/mcp-cloudflare/src/server/lib/mcp-agent.ts
- Constraint utilities: @packages/mcp-cloudflare/src/server/lib/constraint-utils.ts
- Type definitions: @packages/mcp-cloudflare/src/server/types.ts

## Related Documentation

- OAuth Architecture: @docs/cloudflare/oauth-architecture.md — How OAuth provider integrates
- MCP Transport (stdio) Implementation: @packages/mcp-server/src/transports/stdio.ts — Core server transport
- Constraint DO Analysis: @docs/cloudflare/constraint-do-analysis.md — Alternative architectures considered
