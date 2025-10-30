# Authorization

Skills-based authorization system for controlling access to Sentry MCP tools.

## Overview

Sentry MCP uses a **skills-based authorization system** that maps user-friendly capabilities to technical API scopes. This provides a better user experience by presenting authorization choices in terms of what users want to do, rather than technical API permissions.

**Skills** are user-facing capabilities that bundle related tools together:
- ✅ "Inspect Issues & Events" is clearer than "org:read, project:read, event:read"
- ✅ "Triage Issues" is clearer than "event:write"
- ✅ "Manage Projects" is clearer than "project:write, team:write"

## Available Skills

| Skill | ID | Default | Description | Key Tools |
|-------|----|---------|-----------|-----------|
| **Inspect Issues & Events** | `inspect` | ✓ | Search and view errors, traces, logs, and related data | search_events, search_issues, get_issue_details, get_trace_details |
| **Seer** | `seer` | ✓ | Sentry's AI debugger that helps you analyze, root cause, and fix issues | analyze_issue_with_seer |
| **Documentation** | `docs` | | Search and read Sentry SDK documentation | search_docs, get_doc |
| **Triage Issues** | `triage` | | Resolve, assign, and update issues | update_issue |
| **Manage Projects & Teams** | `project-management` | | Create and modify projects, teams, and DSNs | create_project, create_team, create_dsn, update_project |

**Default skills** (marked with ✓) are pre-checked in OAuth but can be unchecked. They provide read-only access to core functionality.

### Foundational Tools (Always Available)

These tools are always available regardless of granted skills, as they provide essential navigation and context:

- **`find_organizations`** - List organizations you have access to
- **`find_projects`** - List projects within organizations
- **`whoami`** - Get authenticated user information

## Authentication Methods

### OAuth (Hosted MCP Server)

When connecting to the hosted MCP server (https://mcp.sentry.dev), you'll go through an OAuth flow:

1. **Connection**: Your app/IDE initiates MCP connection
2. **Redirect**: You're sent to Sentry's OAuth approval page
3. **Select Skills**: Choose which skills to grant (defaults pre-checked)
4. **Approve**: Grant access to selected skills
5. **Connected**: MCP server receives granted skills

**Important**: You must select at least one skill to proceed.

**Web Interface**: https://mcp.sentry.dev provides a chat interface with OAuth authentication.

### CLI/stdio (Self-Hosted or Local)

When running the MCP server locally via CLI, you provide an access token directly:

```bash
# Default: Grants ALL skills (non-interactive convenience)
npx @sentry/mcp-server --access-token=TOKEN

# Limit to specific skills only
npx @sentry/mcp-server --access-token=TOKEN --skills=inspect,triage

# Via environment variable
export SENTRY_ACCESS_TOKEN=your-token
npx @sentry/mcp-server
```

**Default Behavior**: CLI/stdio intentionally defaults to ALL skills when no `--skills` flag is provided. This is designed to prevent the MCP from breaking in non-interactive environments (IDEs, CI/CD) where users expect maximum access by default.

### Environment Variables

```bash
# Authentication
export SENTRY_ACCESS_TOKEN=your-token

# Skills configuration
export MCP_SKILLS=inspect,docs,triage  # Limit to specific skills
```

**Precedence**: Command-line flags override environment variables.

## Skill-to-Scope Mapping

Skills automatically map to the Sentry API scopes required by their tools:

| Skill | Required Sentry API Scopes |
|-------|----------------------------|
| `inspect` | org:read, project:read, team:read, event:read |
| `docs` | org:read, project:read, team:read, event:read |
| `seer` | org:read, project:read, team:read, event:read |
| `triage` | org:read, project:read, team:read, event:read, event:write |
| `project-management` | org:read, project:read, team:read, event:read, project:write, team:write |
| **Foundational tools** | org:read, project:read (always granted) |

**This mapping is automatic** - you don't need to think about scopes when using skills.

**Note**: Skills handle all authorization - there are no "virtual scopes". The `docs` and `seer` skills provide access to their respective features without requiring any special Sentry API scopes.

## Validation

To verify the skills-to-tools-to-scopes mapping in your development environment:

```bash
cd packages/mcp-server
pnpm run validate-skills
```

This script verifies:
- Each skill enables the expected tools
- Scope calculations are correct
- No tools are orphaned (inaccessible)

## IDE Integration

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sentry": {
      "command": "npx",
      "args": ["-y", "@sentry/mcp-server"],
      "env": {
        "SENTRY_ACCESS_TOKEN": "your-token-here"
      }
    }
  }
}
```

### Cursor IDE

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "sentry": {
      "command": "npx",
      "args": ["-y", "@sentry/mcp-server"],
      "env": {
        "SENTRY_ACCESS_TOKEN": "your-token-here"
      }
    }
  }
}
```

## Migration from Scopes

**If you're currently using `--scopes` or `--add-scopes` flags**, migrate to skills:

### Before (Deprecated)
```bash
# Read-only access
npx @sentry/mcp-server --access-token=TOKEN --scopes=org:read,event:read

# Add write permissions
npx @sentry/mcp-server --access-token=TOKEN --add-scopes=event:write,project:write
```

### After (Recommended)
```bash
# Read-only access
npx @sentry/mcp-server --access-token=TOKEN --skills=inspect

# Add triage and project management
npx @sentry/mcp-server --access-token=TOKEN --skills=inspect,triage,project-management
```

### Migration Table

| Old Scopes | New Skills | Reason |
|-----------|-----------|--------|
| `org:read`, `project:read`, `event:read` | `inspect` | Core read access |
| N/A - was managed via tool filtering | `docs` | Documentation access (now skill-based) |
| N/A - was managed via tool filtering | `seer` | AI analysis (now skill-based) |
| `+ event:write` | `+ triage` | Issue management |
| `+ project:write`, `team:write` | `+ project-management` | Project/team creation |

**Deprecation Timeline**:
- ✅ Skills system available now
- ⚠️ Scopes deprecated (warnings shown)
- 🔄 Both systems work in parallel
- 🗓️ Scopes will be removed in a future major version

## Troubleshooting

### "Authorization failed: You must select at least one permission to continue"

**OAuth**: You unchecked all skills in the approval dialog. Select at least one skill.

**Solution**: Re-authenticate and select at least one skill.

### Tool not appearing in list

**Cause**: The tool requires a skill you haven't granted.

**Solution**:
1. Check which skill enables the tool (see "Available Skills" table above)
2. Re-authenticate with that skill granted (OAuth)
3. Or add the skill to `--skills` flag (CLI)

### "Invalid skills provided" error

**Cause**: You specified a skill that doesn't exist.

**Solution**: Use one of the valid skill IDs: `inspect`, `docs`, `seer`, `triage`, `project-management`

```bash
# Check available skills
npx @sentry/mcp-server --help
```

## Legacy: Scopes System

> ⚠️ **Deprecated**: The scopes system is maintained for backward compatibility but is deprecated. Use skills instead.

The underlying implementation still uses OAuth scopes internally, but you should think in terms of skills. If you need direct scope control for advanced use cases:

```bash
# DEPRECATED: Direct scope control
npx @sentry/mcp-server --access-token=TOKEN --scopes=org:read,event:write

# WARNING: This will show deprecation warnings
```

**Available Scopes** (for reference only):
- `org:read`, `org:write`, `org:admin`
- `project:read`, `project:write`, `project:admin`
- `team:read`, `team:write`, `team:admin`
- `event:read`, `event:write`, `event:admin`
- `member:read`, `member:write`, `member:admin`
- `project:releases`

## References

- **Adding Tools**: @docs/adding-tools.mdc — How to add requiredSkills to new tools
- **Testing**: @docs/testing.mdc — Test with different skill configurations
- **Architecture**: @docs/architecture.mdc — How skills map to scopes internally
- **OAuth Architecture**: @docs/cloudflare/oauth-architecture.md — OAuth implementation details
