# Agent Instructions

## Package Manager
- Use **pnpm**; Node.js must be `>=20`.
- `CLAUDE.md` is a symlink to this file; do not maintain a divergent copy.

## Package Roles
| Package | Role |
|---|---|
| `packages/mcp-core` | Shared MCP server, tools, schemas, Sentry API client, and tool definitions. |
| `packages/mcp-server` | Published stdio transport package (`@sentry/mcp-server`). |
| `packages/mcp-cloudflare` | Hosted web app, HTTP `/mcp` transport, OAuth authorization server routes, and demo chat web client. |
| `packages/mcp-test-client` | Local CLI for stdio/HTTP transport QA, OAuth, DCR, CIMD, and agent-mode testing. |
| `packages/mcp-server-mocks` | MSW fixtures and mocks for tests. |

## OAuth And Transport Boundaries
- `packages/mcp-server` uses stdio auth flows; do not mix it with hosted OAuth behavior.
- In `packages/mcp-cloudflare`, `/oauth/*` is the hosted OAuth authorization server.
- In `packages/mcp-cloudflare`, `/mcp` is the protected HTTP MCP resource; `?agent=1` switches to embedded-agent mode.
- In `packages/mcp-cloudflare`, `/api/chat` is the demo chat backend acting as an MCP client of `/mcp`.
- The demo chat OAuth client identity must stay separate from the MCP resource identity.
- Preserve Dynamic Client Registration unless a change explicitly removes it.

## Commands
| Task | Command |
|---|---|
| Full typecheck | `pnpm run tsc` |
| Full lint | `pnpm run lint` |
| Full tests | `pnpm run test` |
| Cloudflare tests | `pnpm --filter @sentry/mcp-cloudflare test` |
| Cloudflare typecheck | `pnpm --filter @sentry/mcp-cloudflare tsc` |
| CLI QA | `pnpm -w run cli --transport http --mcp-host=http://localhost:5173/mcp --list-tools` |
| Generate definitions | `pnpm run --filter @sentry/mcp-core generate-definitions` |

## References
| Need | File |
|---|---|
| Docs index | `docs/README.md` |
| Tool changes | `docs/contributing/adding-tools.md` |
| Tool responses | `docs/contributing/tool-responses.md` |
| Error handling | `docs/contributing/error-handling.md` |
| Testing | `docs/testing/overview.md` |
| Remote/OAuth QA | `docs/testing/remote.md` |
| OAuth architecture | `docs/cloudflare/oauth-architecture.md` |
| Security | `docs/operations/security.md` |
| PR guidance | `docs/contributing/pr-management.md` |

## Conventions
- Prefer strict TypeScript; use `unknown` instead of `any` for unknown values.
- Never log secrets or tokens.
- When changing Sentry API endpoint usage, validate behavior against `~/src/sentry`.
- Update docs for behavior changes.
- Run the relevant focused tests before the full quality gate.
- Run `pnpm run --filter @sentry/mcp-core generate-definitions` after changing tools, skills, or agent prompts.

## Commit Attribution
AI commits MUST include:
```
Co-Authored-By: (the agent model's name and attribution byline)
```
