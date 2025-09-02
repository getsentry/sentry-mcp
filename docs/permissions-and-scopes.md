# Permissions and Scopes

OAuth-style scope system for controlling access to Sentry MCP tools.

## Quick Start

### Permission Levels

Users select one of three permission levels after Sentry authentication:

| Level | Scopes | Tools Enabled |
|-------|--------|--------------|
| **Read-Only** (default) | `org:read`, `project:read`, `team:read`, `event:read`, `project:releases` | Search, view issues/traces, documentation |
| **Issue Triage** | Read-Only + `event:write` | All above + resolve/assign issues, AI analysis |
| **Project Management** | `org:read`, `project:write`, `team:write`, `event:write`, `project:releases` | All above + create/modify projects/teams/DSNs |

### CLI Usage

```bash
# Specify scopes directly
npx @sentry/mcp-server --access-token=TOKEN --scopes=org:read,event:write

# Via environment variable
export MCP_SCOPES=org:read,project:write,team:write
npx @sentry/mcp-server --access-token=TOKEN
```

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
- `find_releases` - `project:releases`
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