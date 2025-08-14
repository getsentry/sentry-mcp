# Subpath-Based MCP Constraints

This document describes the implementation of subpath-based MCP constraints for the Sentry MCP server, allowing clients to restrict MCP sessions to specific organizations and projects.

## Overview

The MCP server now supports URL-based constraints that can be passed through the OAuth authorization flow. These constraints ensure that an MCP session can only access resources within specified organizations and/or projects.

## How It Works

### 1. OAuth Authorization with Constraints

When initiating OAuth authorization, clients can specify constraints via query parameters:

```
/oauth/authorize?
  client_id=YOUR_CLIENT_ID&
  mcp_org=acme-corp&           # Optional: Restrict to organization
  mcp_project=frontend&        # Optional: Restrict to project  
  ...other_oauth_params
```

### 2. Constraint Flow

1. **Authorization Request**: Client includes `mcp_org` and/or `mcp_project` query parameters
2. **OAuth Flow**: Constraints are passed through the OAuth state parameter
3. **Token Generation**: Constraints are validated and embedded in the OAuth token props
4. **MCP Session**: Constraints are enforced on every tool call

### 3. Constraint Validation

The server validates constraints at two levels:

#### During OAuth Callback
- Verifies the user has access to the specified organization
- Returns 403 Forbidden if access is denied

#### During Tool Execution
- Each tool that accepts organization/project parameters validates them against session constraints
- Throws `UserInputError` if constraints are violated

## Implementation Details

### Key Files

- **`packages/mcp-server/src/internal/constraint-validation.ts`**
  - Core validation logic
  - `validateConstraints()`: Enforces constraints on tool parameters
  - `applyConstraints()`: Applies default constraints when not provided
  
- **`packages/mcp-cloudflare/src/server/lib/mcp-constraints.ts`**
  - OAuth constraint utilities
  - `extractConstraintsFromRequest()`: Extracts constraints from OAuth request
  
- **`packages/mcp-cloudflare/src/server/routes/sentry-oauth.ts`**
  - OAuth flow integration
  - Passes constraints through state parameter
  - Validates organization access during callback

- **`packages/mcp-cloudflare/src/server/lib/mcp-transport.ts`**
  - Stores constraints in ServerContext
  - Makes constraints available to all tools

### ServerContext Type

The `ServerContext` type now includes an optional `constraints` field:

```typescript
export type ServerContext = {
  accessToken: string;
  organizationSlug: string | null;
  userId?: string;
  constraints?: {
    organizationSlug?: string;
    projectSlug?: string;
  };
  // ... other fields
};
```

### Tool Updates

Tools that accept organization or project parameters must call `validateConstraints()`:

```typescript
import { validateConstraints } from "../internal/constraint-validation";

export default defineTool({
  name: "find_projects",
  async handler(params, context: ServerContext) {
    // Validate constraints
    validateConstraints({ 
      organizationSlug: params.organizationSlug 
    }, context);
    
    // Tool logic continues...
  }
});
```

## Usage Examples

### Restricting to an Organization

```bash
# OAuth URL with organization constraint
https://mcp.sentry.dev/oauth/authorize?
  client_id=YOUR_CLIENT_ID&
  mcp_org=acme-corp&
  redirect_uri=YOUR_REDIRECT&
  response_type=code&
  scope=YOUR_SCOPES
```

After authorization, the MCP session can only access resources in the `acme-corp` organization.

### Restricting to a Project

```bash
# OAuth URL with organization and project constraints
https://mcp.sentry.dev/oauth/authorize?
  client_id=YOUR_CLIENT_ID&
  mcp_org=acme-corp&
  mcp_project=frontend&
  redirect_uri=YOUR_REDIRECT&
  response_type=code&
  scope=YOUR_SCOPES
```

After authorization, the MCP session can only access the `frontend` project in the `acme-corp` organization.

## Error Messages

When constraints are violated, users receive clear error messages:

```
Organization constraint violation: This session is restricted to organization 
'acme-corp' but you tried to access 'other-org'. This MCP session was 
initialized with organization-specific constraints for security.
```

```
Project constraint violation: This session is restricted to project 'frontend' 
but you tried to access 'backend'. This MCP session was initialized with 
project-specific constraints for security.
```

## Testing

Tests are located in:
- `packages/mcp-server/src/internal/constraint-validation.test.ts` - Unit tests for validation logic
- `packages/mcp-cloudflare/src/server/lib/mcp-router.test.ts` - Tests for URL parsing

Run tests with:
```bash
pnpm test constraint-validation
```

## Security Considerations

1. **Access Validation**: Constraints are validated during OAuth callback to ensure users have access
2. **Token Security**: Constraints are encrypted within OAuth tokens
3. **Runtime Enforcement**: Every tool call validates constraints
4. **Clear Errors**: Violations provide clear feedback without exposing sensitive data

## Future Enhancements

Potential future improvements:
- Support for multiple organization/project constraints
- Team-level constraints
- Time-based constraint expiration
- Constraint modification without re-authentication