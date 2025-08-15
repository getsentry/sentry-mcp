# McpAgent Architecture Documentation

## Overview

McpAgent is a base class from the Cloudflare agents library that provides the foundation for building MCP (Model Context Protocol) servers as Durable Objects. It handles the protocol transport, state management, and lifecycle of MCP server instances.

## Key Components

### 1. McpAgent Base Class

```typescript
class McpAgent<Env, State, Props> extends DurableObject {
  // Props passed from OAuth provider
  props: Props;
  
  // MCP server instance (must be provided by subclass)
  abstract server: McpServer | Server;
  
  // Lifecycle methods
  abstract init(): Promise<void>;
  fetch(request: Request): Promise<Response>;
  
  // State management (from agents library)
  state: State;
  setState(state: State): void;
  
  // Static methods for creating handlers
  static serve(path: string): Handler;
  static serveSSE(path: string): Handler;
}
```

### 2. Transport Methods

McpAgent supports two transport protocols:

- **`serve()`**: Streamable HTTP transport (recommended)
- **`serveSSE()`**: Server-Sent Events transport (legacy)

These are **static methods** that return request handlers:

```typescript
// Usage in index.ts
const oAuthProvider = new OAuthProvider({
  apiHandlers: {
    "/mcp": SentryMCP.serve("/*"),     // Returns a handler object
    "/sse": SentryMCP.serveSSE("/*"),  // Returns a handler object
  },
  // ...
});
```

## Lifecycle

### 1. Durable Object Creation

```
Request arrives → OAuth Provider validates token → Extracts props from token → 
Creates DO with ID based on props → DO instance created → init() called
```

**Key points:**
- DO ID is generated from props (typically userId)
- One DO instance per unique ID (one per user)
- DO persists in memory between requests (~30 seconds idle timeout)

### 2. Request Flow

```
First Request (DO Creation):
1. OAuth provider validates token
2. Extracts props (userId, accessToken, etc.)
3. Creates DO instance with ID from props
4. Calls init() on DO - ONCE
5. Calls fetch() for the request (guaranteed after init() completes)
6. Returns response

Subsequent Requests (Same User):
1. OAuth provider validates token
2. Routes to existing DO instance
3. Calls fetch() - init() is NOT called again
4. Returns response

After Hibernation:
1. DO wakes from hibernation
2. Calls init() to restore state
3. Calls fetch() for the request (guaranteed after init() completes)
4. Returns response
```

**Important Lifecycle Guarantee**: McpAgent ensures `init()` always completes before `fetch()` is called. This is guaranteed both on DO creation and when waking from hibernation.

### 3. Method Responsibilities

**`init()`**:
- Called when DO is created or wakes from hibernation
- Should create/configure the MCP server
- Should restore any persisted state
- NOT called for every request

**`fetch()`**:
- Called for EVERY request
- Handles the actual MCP protocol communication
- Can access `this.props` set by OAuth provider
- Returns the MCP response

## Props System

Props are the bridge between OAuth and the Durable Object:

```typescript
interface WorkerProps {
  id: string;           // User ID from OAuth token
  accessToken: string;  // Sentry API token
  name: string;         // User name
  scope: string;        // OAuth scopes
}
```

**How props work:**
1. OAuth provider decrypts the OAuth token
2. Extracts encrypted props from token storage
3. Passes props to DO via `ctx.props`
4. DO can access via `this.props`

**Important:** Props are set once when DO is created and don't change during its lifetime.

## URL Rewriting Challenge

The agents library internally rewrites URLs:

```
Original: /mcp/sentry/javascript
After rewrite: /streamable-http
```

This happens inside the transport layer before reaching our DO's fetch() method.

**Implications:**
- Original path information is lost
- Can't use URL path for routing inside DO
- Must use alternative methods (headers) to pass path information

## State Management

McpAgent provides state management capabilities:

```typescript
// Initial state
initialState: State;

// Get current state
this.state;

// Update state
this.setState(newState);

// State change handler
onStateUpdate(state: State, source: "server" | Connection): void;
```

State is persisted automatically and restored after hibernation.

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
6. **Constraint mutability**: While ideally each DO would be coupled to specific constraints (like in .mcp.json configurations), the current architecture requires handling constraint changes since DOs are created per-user, not per-constraint-set

## Best Practices

1. **Handle reconfiguration in fetch()**: Since init() isn't called for every request
2. **Use storage sparingly**: Storage operations are expensive
3. **Cache in memory**: Use instance variables for frequently accessed data
4. **Prepare for hibernation**: Always persist critical state
5. **Trust lifecycle guarantees**: McpAgent ensures init() completes before fetch()

## Example Implementation

```typescript
class SentryMCPBase extends McpAgent<Env, State, WorkerProps> {
  server!: McpServer;
  
  async init() {
    // Called once on DO creation or hibernation wake
    // Restore state from storage
    const savedData = await this.ctx.storage.get("data");
    
    // Create MCP server
    this.server = new McpServer({...});
    
    // Configure server with props
    await configureServer({
      server: this.server,
      context: {
        accessToken: this.props.accessToken,  // From OAuth
        userId: this.props.id,                // From OAuth
        // ...
      }
    });
  }
  
  async fetch(request: Request): Promise<Response> {
    // Called for every request
    // Handle any request-specific logic
    
    // Check if reconfiguration needed
    if (needsReconfiguration(request)) {
      await this.reconfigure(request);
    }
    
    // Process request with MCP server
    return super.fetch(request);
  }
}

// Export with static handlers
export default class SentryMCP extends SentryMCPBase {
  // Static methods inherited from McpAgent
}
```

## Related Documentation

- [OAuth Architecture](./oauth-architecture.md) - How OAuth provider integrates
- [MCP Transport Implementation](../lib/mcp-transport.ts) - Our implementation
- [Constraint DO Analysis](./constraint-do-analysis.md) - Alternative architectures considered