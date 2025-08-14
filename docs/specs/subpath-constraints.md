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

2. **Simple Context Defaults**: URL path constraints become default values in ServerContext, eliminating the need for complex validation infrastructure

3. **Session Persistence**: Constraints are stored in Durable Object storage and persist across requests

### Implementation Components

#### 1. Enhanced MCP Transport (`mcp-transport.ts`)
```typescript
class SentryMCPBase extends McpAgent {
  async fetch(request: Request): Promise<Response> {
    // Extract org/project from URL path using regex
    const pathMatch = url.pathname.match(/^\/(mcp|sse)(?:\/([a-zA-Z0-9._-]+))?(?:\/([a-zA-Z0-9._-]+))?$/);
    
    if (pathMatch?.[2]) {
      // Validate slugs for security
      if (this.isValidSlug(orgSlug) && (!projectSlug || this.isValidSlug(projectSlug))) {
        this.urlOrganizationSlug = orgSlug;
        this.urlProjectSlug = projectSlug;
        // Store in Durable Object storage for persistence
      }
    }
  }
  
  async init() {
    // URL path constraints override OAuth org (if present)
    const serverContext: ServerContext = {
      organizationSlug: this.urlOrganizationSlug || this.props.organizationSlug,
      projectSlug: this.urlProjectSlug,
      // ... other fields
    };
  }
  
  private isValidSlug(slug: string): boolean {
    // Security validation: reject malicious patterns, enforce length limits
  }
}
```

#### 2. Security Validation
```typescript
private isValidSlug(slug: string): boolean {
  // Reject empty strings, excessive length (100+ chars)
  // Reject path traversal (.. //) and URL patterns (:// %)
  // Require alphanumeric start/end characters
  // Allow only [a-zA-Z0-9._-] characters
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

### Context Integration
```typescript
interface ServerContext {
  organizationSlug: string | null;  // From URL path or OAuth
  projectSlug?: string | null;      // From URL path only
  // ... other fields
}
```

### Default Behavior
Constraints work as simple defaults in the server context:
- Tools that accept `organizationSlug` will use the URL constraint as default
- Tools that accept `projectSlug` will use the URL constraint as default
- No validation errors - tools just use the scoped defaults

## Implementation Status

### Completed
- ✅ URL parsing logic with security validation in `mcp-transport.ts`
- ✅ ServerContext integration with simple defaults
- ✅ Session-level constraint storage in Durable Object
- ✅ Support for both `/mcp` and `/sse` endpoints with constraints
- ✅ Security validation for slug patterns (alphanumeric, length limits, path traversal protection)
- ✅ Smoke tests for endpoint connectivity
- ✅ Client documentation updates

### How It Works

The implementation leverages the fact that the OAuth provider uses `startsWith` for path matching. This means a handler registered for `/mcp` will also match `/mcp/org/project`. We use this behavior to:

1. Parse the URL path directly in the MCP transport's `fetch()` method
2. Extract organization and project slugs using a secure regex pattern
3. Validate slugs for security (reject malicious patterns, length limits)
4. Store constraints in Durable Object storage for session persistence
5. Use constraints as simple defaults in ServerContext (no validation needed)

## Security Features

1. **Restrictive Regex**: Only allows `[a-zA-Z0-9._-]` characters in slugs
2. **Length Limits**: Maximum 100 characters per slug to prevent DoS
3. **Path Traversal Protection**: Rejects `..` and `//` patterns
4. **URL Injection Protection**: Rejects `://` and `%` encoding
5. **Format Validation**: Requires alphanumeric start/end characters

## Testing

```bash
# Run smoke tests against deployment
pnpm test  # in packages/smoke-tests

# Run smoke tests against local dev server
PREVIEW_URL=http://localhost:5173 pnpm test
```

## Migration

This feature is backward compatible. Existing clients connecting to `/mcp` or `/sse` will continue to work without constraints.