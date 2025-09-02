# Permissions and Scopes

This document describes the OAuth-style scope system used by the Sentry MCP Server for access control.

## Overview

The Sentry MCP Server uses a two-layer permission system:

1. **Upstream Sentry API Scopes** - The MCP server requests ALL necessary scopes from the Sentry API to cover all possible tool operations
2. **MCP Permission Filtering** - The MCP server then restricts which tools are available based on user-selected permission levels

This design allows us to:
- Request a single set of scopes from Sentry (simplifying the OAuth flow)
- Provide fine-grained access control within the MCP server
- Maintain compatibility with Sentry's API scope model for potential future OAuth 2.1 support

## How It Works

### 1. Initial OAuth Flow (Sentry Authentication)
When a user first connects, the MCP server requests the following scopes from Sentry's OAuth provider:
- All scopes necessary to support every tool in the MCP server
- This happens once during the initial authentication with Sentry

### 2. MCP Permission Selection (After Sentry Auth)
After successful Sentry authentication, users see the MCP approval dialog where they can:
- Choose a permission level (Read-Only, Issue Triage, or Project Management)
- These permission levels determine which subset of tools are available
- This filtering happens within the MCP server, not at the Sentry API level

### 3. Runtime Enforcement
The MCP server enforces permissions by:
- Filtering available tools based on granted scopes
- Double-checking permissions at runtime when tools are invoked
- Returning errors if a tool requires scopes not granted to the session

## Available Scopes

The MCP server recognizes the following Sentry API scopes:

### Organization Scopes
- `org:read` - View organization details
- `org:write` - Modify organization details (includes `org:read`)
- `org:admin` - Delete organizations (includes `org:write` and `org:read`)

### Project Scopes
- `project:read` - View project information
- `project:write` - Create and modify projects (includes `project:read`)
- `project:admin` - Delete projects (includes `project:write` and `project:read`)

### Team Scopes
- `team:read` - View team information
- `team:write` - Create and modify teams (includes `team:read`)
- `team:admin` - Delete teams (includes `team:write` and `team:read`)

### Member Scopes
- `member:read` - View member information
- `member:write` - Create and modify members (includes `member:read`)
- `member:admin` - Delete members (includes `member:write` and `member:read`)

### Event/Issue Scopes
- `event:read` - View events and issues
- `event:write` - Update and manage issues (includes `event:read`)
- `event:admin` - Delete issues (includes `event:write` and `event:read`)

### Special Scopes
- `project:releases` - Access release endpoints

## Scope Hierarchy

Higher-level scopes automatically grant access to lower-level scopes within the same resource type:

```
admin → write → read
```

For example:
- Granting `team:write` automatically includes `team:read`
- Granting `event:admin` automatically includes `event:write` and `event:read`

## Permission Levels (UI)

For the OAuth approval dialog, we provide three pre-configured permission levels that bundle related scopes:

### 1. Read-Only Access
**Description**: Basic information retrieval and search capabilities

**Granted Scopes**:
- `org:read`
- `project:read`
- `team:read`
- `event:read`
- `project:releases`

**Available Tools**: All read-only tools including search, viewing issues, traces, and documentation

### 2. Issue Triage
**Description**: Read access plus issue management capabilities

**Granted Scopes**:
- All Read-Only scopes
- `event:write` (includes `event:read` via hierarchy)

**Additional Tools**:
- `update_issue` - Resolve, assign, and manage issues
- `analyze_issue_with_seer` - AI-powered issue analysis (read operation but resource-intensive)

### 3. Project Management
**Description**: Full access including project and team management

**Granted Scopes**:
- `org:read`
- `project:write` (includes `project:read` via hierarchy)
- `team:write` (includes `team:read` via hierarchy)
- `event:write` (includes `event:read` via hierarchy)
- `project:releases`

**Additional Tools**:
- `create_project` - Create new projects
- `update_project` - Modify project settings
- `create_team` - Create new teams
- `create_dsn` - Create additional DSNs for projects

## Tool Scope Requirements

Each tool specifies its required scopes using the `requiredScopes` field:

| Tool | Required Scopes | Description |
|------|----------------|-------------|
| `whoami` | None | Always available - identifies authenticated user |
| `find_organizations` | `org:read` | List organizations |
| `find_projects` | `project:read` | List projects |
| `find_teams` | `team:read` | List teams |
| `find_releases` | `project:releases` | List releases |
| `find_dsns` | `project:read` | List project DSNs/client keys |
| `get_issue_details` | `event:read` | View issue details |
| `get_event_attachment` | `event:read` | Download event attachments |
| `get_trace_details` | `event:read` | View trace information |
| `search_events` | `event:read` | Search and aggregate events |
| `search_issues` | `event:read` | Search grouped issues |
| `analyze_issue_with_seer` | `event:read` | AI analysis of issues |
| `update_issue` | `event:write` | Modify issue status/assignment |
| `create_project` | `project:write`, `team:read` | Create new projects |
| `update_project` | `project:write` | Modify project settings |
| `create_team` | `team:write` | Create new teams |
| `create_dsn` | `project:write` | Create project DSNs |
| `search_docs` | None | Documentation always available |
| `get_doc` | None | Documentation always available |

## Usage

### Via OAuth Flow (Web UI)

Users select a permission level in the approval dialog:
1. Authenticate with Sentry (full scope request)
2. Choose MCP permission level (Read-Only, Issue Triage, or Project Management)
3. MCP server filters tools based on selected permission level

### Via CLI (Direct Scopes)

Advanced users can specify exact scopes via the command line:

```bash
# Read-only access
npx @sentry/mcp-server --access-token=TOKEN --scopes=org:read,event:read,project:read

# Issue triage access
npx @sentry/mcp-server --access-token=TOKEN --scopes=org:read,event:write,project:read

# Custom mix of scopes
npx @sentry/mcp-server --access-token=TOKEN --scopes=project:write,event:read

# Via environment variable
export MCP_SCOPES=org:read,project:write,team:write
npx @sentry/mcp-server --access-token=TOKEN
```

### Scope Validation

The server validates scopes at two points:

1. **Server initialization**: Tools are filtered based on granted scopes
2. **Runtime checks**: Additional validation when tools are invoked

Tools that require scopes not granted to the user will:
- Not appear in the tool list
- Return an error if somehow invoked

## Implementation Details

### Scope Expansion

The `expandScopes()` function automatically expands granted scopes to include implied scopes:

```typescript
// Input: Set(['team:write'])
// Output: Set(['team:write', 'team:read'])

// Input: Set(['event:admin'])  
// Output: Set(['event:admin', 'event:write', 'event:read'])
```

### Backward Compatibility

- If no scopes are specified, defaults to full access (PROJECT_MANAGEMENT level)
- Tools without `requiredScopes` are always available
- Documentation tools (`search_docs`, `get_doc`) are always available regardless of scopes

### Future Compatibility

The current design maintains compatibility with Sentry's API scope model, allowing for:
- Future migration to OAuth 2.1 if Sentry supports it
- Direct scope negotiation with Sentry (removing the need for the proxy)
- Gradual migration to more fine-grained scope requests

## Security Considerations

1. **Principle of Least Privilege**: Always grant the minimum scopes necessary
2. **Scope Escalation**: Higher scopes include lower ones - no need to specify both
3. **Token Security**: Access tokens with scopes should be treated as sensitive credentials
4. **Audit Trail**: All tool invocations are logged with the granted scopes for auditing
5. **Upstream vs MCP Scopes**: The Sentry API token has full scopes, but MCP restricts access

## Troubleshooting

### Common Issues

**Problem**: Tool not appearing in list
- **Solution**: Check if required scopes are granted
- **Debug**: Run with `--scopes` flag to explicitly set scopes

**Problem**: "Tool not allowed" error
- **Solution**: Tool requires scopes not granted to current session
- **Fix**: Re-authenticate with higher permission level or add required scopes

**Problem**: Scope not recognized
- **Solution**: Check spelling and format (lowercase, colon separator)
- **Valid**: `event:write`
- **Invalid**: `Event:Write`, `event-write`, `eventwrite`

## Future Enhancements

Potential improvements to the scope system:

1. **Granular Upstream Requests**: Request only necessary scopes from Sentry based on user selection
2. **Dynamic Scope Discovery**: Automatically determine minimum scopes needed
3. **Scope Groups**: Pre-defined scope bundles for common use cases
4. **Time-based Scopes**: Temporary elevated permissions
5. **Delegated Scopes**: Allow users to grant subset of their scopes

## Related Documentation

- [Adding Tools](./adding-tools.md) - How to add new tools with scope requirements
- [API Patterns](./api-patterns.md) - Sentry API integration patterns
- [Testing](./testing.md) - Testing tools with different scope configurations