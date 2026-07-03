## Why

Project management is already partially exposed through catalog tools, but the current surface mixes unrelated side effects into broad operations. Creating a project must reliably return a usable DSN, while project metadata updates and team access changes need separate contracts so agents do not accidentally change access when renaming or re-platforming a project.

## What Changes

- Tighten `create_project` to focus on project creation and immediate SDK setup:
  - Accept organization, team, project name, optional project slug, and optional platform.
  - Return the created project identity and a usable `SENTRY_DSN`.
  - Prefer the default DSN created by Sentry; create a `Default` DSN only as a fallback when no key exists.
  - Remove repository linking from this tool.
- Tighten `update_project` to metadata-only updates:
  - Allow project name, slug, and platform changes.
  - Reject slug changes from project-scoped sessions so the active project constraint does not become stale.
  - Remove team assignment from this tool.
- Add explicit team access tools:
  - `add_team_to_project` grants an additional team access to a project.
  - `remove_team_from_project` revokes a team from a project, with preflight guardrails.
- Keep all project-management operations catalog-only behind the `project-management` skill.
- Add durable project-management documentation under `docs/specs/project-management.md` and link it from the specs index.

## Capabilities

### New Capabilities

- `project-management`: Defines safe project, DSN, and project team access management through MCP catalog tools.

### Modified Capabilities

None.

## Impact

- `packages/mcp-core/src/tools/catalog/create-project.ts`
- `packages/mcp-core/src/tools/catalog/update-project.ts`
- New catalog tools for adding and removing project teams
- `packages/mcp-core/src/tools/catalog/index.ts`
- `packages/mcp-core/src/api-client/client.ts`
- `packages/mcp-core/src/api-client/schema.ts`
- Catalog tool tests and mocks for project creation, metadata updates, team access changes, and constraints
- Generated definitions from `pnpm run --filter @sentry/mcp-core generate-definitions`
- `docs/specs/project-management.md`
- `docs/specs/README.md`
