import type { Scope } from "../permissions";

export function buildUsage(
  packageName: string,
  defaults: ReadonlyArray<Scope>,
  all: ReadonlyArray<Scope>,
): string {
  return `Usage: ${packageName} --access-token=<token> [--host=<host>|--url=<url>] [--mcp-url=<url>] [--sentry-dsn=<dsn>] [--scopes=<scope1,scope2>] [--add-scopes=<scope1,scope2>] [--all-scopes] [--denied-tools=<regex>]

Default scopes (read-only):
  - ${defaults.join(", ")}

Scope options:
  --scopes      Override default scopes completely
  --add-scopes  Add scopes to the default read-only set
  --all-scopes  Grant all available scopes (admin-level and implied)

Tool filtering:
  --denied-tools <regex>      Hide tools matching regex pattern (can also use SENTRY_DENIED_TOOLS_REGEX env var)

Constraints (stdio only):
  --organization-slug <slug>  Constrain all tool calls to this org
  --project-slug <slug>       Constrain to a project (optional)

Available scopes (higher scopes include lower):
  - org:read, org:write, org:admin
  - project:read, project:write, project:admin
  - team:read, team:write, team:admin
  - member:read, member:write, member:admin
  - event:read, event:write, event:admin
  - project:releases

Examples:
  # Default read-only access
  ${packageName} --access-token=TOKEN

  # Override with specific scopes only
  ${packageName} --access-token=TOKEN --scopes=org:read,event:read

  # Add write permissions to defaults
  ${packageName} --access-token=TOKEN --add-scopes=event:write,project:write

  # Hide tools starting with "create_"
  ${packageName} --access-token=TOKEN --denied-tools="^create_"`;
}
