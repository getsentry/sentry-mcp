# Permissions and Scopes

OAuth-style scope system for controlling access to Sentry MCP tools.

## Default Permissions

**By default, all users receive read-only access.** This includes:
- `org:read`, `project:read`, `team:read`, `event:read`

Additional permissions must be explicitly granted through the OAuth flow or CLI arguments.

## Permission Levels

When authenticating via OAuth, users can select additional permissions:

| Level | Scopes | Tools Enabled |
|-------|--------|--------------|
| **Read-Only** (default) | `org:read`, `project:read`, `team:read`, `event:read` | Search, view issues/traces, documentation |
| **+ Issue Triage** | Adds `event:write` | All above + resolve/assign issues, AI analysis |
| **+ Project Management** | Adds `project:write`, `team:write` | All above + create/modify projects/teams/DSNs |

### CLI Usage

```bash
# Default: read-only access
npx @sentry/mcp-server --access-token=TOKEN

# Override defaults with specific scopes only
npx @sentry/mcp-server --access-token=TOKEN --scopes=org:read,event:read

# Add write permissions to default read-only scopes
npx @sentry/mcp-server --access-token=TOKEN --add-scopes=event:write,project:write

# Via environment variables
export MCP_SCOPES=org:read,project:write  # Overrides defaults
export MCP_ADD_SCOPES=event:write         # Adds to defaults
npx @sentry/mcp-server --access-token=TOKEN
```

**Note:** `--scopes` completely replaces the default scopes, while `--add-scopes` adds to them.

## Scope Hierarchy

Higher scopes include lower ones:

```
admin → write → read
```

Examples:
- `team:write` includes `team:read`
- `event:admin` includes `event:write` and `event:read`

## Available Scopes

| Resource | Read | Write | Admin |
|----------|------|-------|-------|
| **Organization** | `org:read` | `org:write` | `org:admin` |
| **Project** | `project:read` | `project:write` | `project:admin` |
| **Team** | `team:read` | `team:write` | `team:admin` |
| **Member** | `member:read` | `member:write` | `member:admin` |
| **Event/Issue** | `event:read` | `event:write` | `event:admin` |
| **Special** | `project:releases` | - | - |

## Tool Requirements

### Always Available (No Scopes)
- `whoami` - User identification
- `search_docs` - Documentation search
- `get_doc` - Documentation retrieval

### Read Operations
- `find_organizations` - `org:read`
- `find_projects` - `project:read`
- `find_teams` - `team:read`
- `find_releases` - `project:read`
- `find_dsns` - `project:read`
- `get_issue_details` - `event:read`
- `get_event_attachment` - `event:read`
- `get_trace_details` - `event:read`
- `search_events` - `event:read`
- `search_issues` - `event:read`
- `analyze_issue_with_seer` - `event:read`

### Write Operations
- `update_issue` - `event:write`
- `create_project` - `project:write`, `team:read`
- `update_project` - `project:write`
- `create_team` - `team:write`
- `create_dsn` - `project:write`

## How It Works

1. **Sentry Authentication**: MCP requests all necessary scopes from Sentry
2. **Permission Selection**: User chooses permission level in approval dialog
3. **Tool Filtering**: MCP filters available tools based on granted scopes
4. **Runtime Validation**: Scopes checked when tools are invoked

## Notes

- Default behavior grants full access if no scopes specified (backward compatibility)
- Embedded agent tools don't require scope binding
- Documentation tools always available regardless of scopes

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Tool not in list | Check required scopes are granted |
| "Tool not allowed" error | Re-authenticate with higher permission level |
| Invalid scope | Use lowercase with colon separator (e.g., `event:write`) |

## References

- [Adding Tools](./adding-tools.md) - Add tools with scope requirements
- [Testing](./testing.md) - Test with different scope configurations
