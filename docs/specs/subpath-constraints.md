# Subpath-Based MCP Constraints Specification

## Overview

This specification describes the implementation of URL path-based constraints for the Sentry MCP server. Clients can connect to specific URL paths to restrict their MCP session to specific organizations and/or projects.

## Problem Statement

Currently, MCP sessions have access to all organizations and projects that the authenticated user can access. This creates security and usability concerns:
- Clients may accidentally access the wrong organization's data
- There's no way to scope a session to a specific project
- Multi-tenant environments need better isolation

## Solution

Support URL path-based constraints where clients connect to:
- `/mcp` - No constraints (backward compatible)
- `/mcp/{organizationSlug}` - Constrained to specific organization
- `/mcp/{organizationSlug}/{projectSlug}` - Constrained to organization and project

Same pattern for SSE endpoints:
- `/sse` - No constraints
- `/sse/{organizationSlug}` - Organization constraint
- `/sse/{organizationSlug}/{projectSlug}` - Full constraints

## Technical Implementation

### Key Discoveries

1. **OAuth Provider Path Matching**: The OAuth provider uses `startsWith` for path matching, meaning a handler registered for `/mcp` will also match `/mcp/org/project`

2. **Header Communication**: Constraints can be passed from the handler to the Durable Object via custom headers

3. **Session Persistence**: Constraints are stored in Durable Object storage and persist across requests

### Implementation Components

#### 1. Constraint-Aware Handler (`mcp-constraint-handler.ts`)
```typescript
export function createConstraintAwareMcpHandler(basePath: "/mcp" | "/sse") {
  // Wraps the base MCP handler
  // Extracts constraints from URL path using parseMcpPath
  // Adds constraints as headers (X-MCP-Constraint-Org, X-MCP-Constraint-Project)
  // Forwards modified request to base handler
}
```

#### 2. Enhanced MCP Transport (`mcp-transport.ts`)
```typescript
class SentryMCPBase extends McpAgent {
  // Override fetch to extract constraints from headers
  async fetch(request: Request): Promise<Response> {
    // Extract constraints from X-MCP-Constraint-* headers
    // Store in Durable Object storage for persistence
    // Pass to parent fetch
  }
  
  async init() {
    // Include constraints in ServerContext
    // constraints: this.constraints
  }
}
```

#### 3. URL Path Parser (`mcp-router.ts`)
```typescript
export function parseMcpPath(pathname: string): ParsedMcpPath | null {
  // Parses /mcp, /mcp/:org, /mcp/:org/:project
  // Returns { basePath, constraints }
}
```

#### 4. Constraint Validation (`constraint-validation.ts`)
```typescript
export function validateConstraints(
  params: ConstraintParams,
  context: ServerContext
): void {
  // Validates tool parameters against session constraints
  // Throws UserInputError on violation
}
```

## Interface

### URL Patterns
```
/mcp/{organizationSlug}/{projectSlug}
/mcp/{organizationSlug}
/mcp

/sse/{organizationSlug}/{projectSlug}
/sse/{organizationSlug}
/sse
```

### Constraint Validation
```typescript
interface Constraints {
  organizationSlug?: string;
  projectSlug?: string;
}

function validateConstraints(
  params: ConstraintParams,
  context: ServerContext
): void {
  // Throws UserInputError if constraints are violated
}
```

### Error Messages
```
Organization constraint violation: This session is restricted to organization 
'acme-corp' but you tried to access 'other-org'.

Project constraint violation: This session is restricted to project 'frontend' 
but you tried to access 'backend'.
```

## Implementation Status

### Completed
- ✅ URL parsing logic (`mcp-router.ts`)
- ✅ Constraint validation infrastructure (`constraint-validation.ts`)
- ✅ ServerContext type updates
- ✅ Tool enforcement (find-projects, update-project)
- ✅ Unit tests for validation logic
- ✅ Dynamic route handling via constraint-aware handlers (`mcp-constraint-handler.ts`)
- ✅ Constraint extraction from connection URL using header communication
- ✅ Session-level constraint storage in Durable Object
- ✅ Support for both `/mcp` and `/sse` endpoints with constraints
- ✅ Full test coverage for constraint handling

### How It Works

The implementation leverages the fact that the OAuth provider uses `startsWith` for path matching. This means a handler registered for `/mcp` will also match `/mcp/org/project`. We use this behavior to:

1. Create constraint-aware handlers that wrap the base MCP handlers
2. Parse the URL path to extract organization and project constraints
3. Pass constraints to the Durable Object via custom headers
4. Store constraints in Durable Object storage for session persistence
5. Include constraints in the ServerContext for tool validation

## Future Improvements

1. **Additional Tools**: Extend constraint validation to more tools beyond find-projects and update-project
2. **Slug Validation**: Add format validation for organization and project slugs to reject invalid characters early
3. **Error Logging**: Add structured logging for constraint violations for better debugging

## Testing

```bash
# Run constraint validation tests
pnpm vitest run src/internal/constraint-validation.test.ts

# Run constraint handler tests
pnpm vitest run src/server/lib/mcp-constraint-handler.test.ts

# Run router tests
pnpm vitest run src/server/lib/mcp-router.test.ts
```

## Migration

This feature is backward compatible. Existing clients connecting to `/mcp` or `/sse` will continue to work without constraints.