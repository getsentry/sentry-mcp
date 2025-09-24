# Subpath-Based Constraints (End-User Guide)

## What constraints do

Constraints let you scope your Sentry MCP session to a specific organization and optionally a project. When scoped, all tools automatically use that org/project by default and only access data you are permitted to see.

## How to connect

- No scope: connect to `/mcp` (or `/sse` for SSE transport)
- Organization scope: `/mcp/{organizationSlug}`
- Organization + project scope: `/mcp/{organizationSlug}/{projectSlug}`

The same pattern applies to the SSE endpoint: `/sse`, `/sse/{org}`, `/sse/{org}/{project}`.

Examples:

```
/mcp/sentry
/mcp/sentry/my-project
/sse/sentry
/sse/sentry/my-project
```

## What you’ll experience

- Tools automatically use the constrained organization/project as defaults
- You can still pass explicit `organizationSlug`/`projectSlug` to override defaults per call
- If you don’t provide a scope, tools work across your accessible organizations when supported

## Access verification

When you connect with a scoped path, we validate that:
- The slugs are well-formed
- The organization exists and you have access
- If a project is included, the project exists and you have access

If there’s a problem, you’ll receive a clear HTTP error when connecting:
- 400: Invalid slug format
- 401: Missing authentication
- 403: You don’t have access to the specified org/project
- 404: Organization or project not found

## Region awareness

For Sentry Cloud, your organization may be hosted in a regional cluster. When you scope by organization, we automatically determine the region (if available) and use it for API calls. You don’t need to take any action—this happens behind the scenes. For self-hosted Sentry, the region concept doesn’t apply.

## Best practices

- Prefer scoping by organization (and project when known) to reduce ambiguity and improve safety
- Use scoped sessions when collaborating across multiple orgs to avoid cross-org access by mistake
- If a tool reports access errors, reconnect with a different scope or verify your permissions in Sentry

## Frequently asked questions

- Can I switch scope mid-session?
  - Yes. Open a new connection using a different subpath (e.g., `/mcp/{org}/{project}`) and use that session.

- Do I need to specify scope for documentation or metadata endpoints?
  - No. Public metadata endpoints don’t require scope and support CORS.

- How do tools know my scope?
  - The MCP session embeds the constraints, and tools read them as defaults for `organizationSlug` and `projectSlug`.

## Reference

Supported URL patterns:
```
/mcp/{organizationSlug}/{projectSlug}
/mcp/{organizationSlug}
/mcp

/sse/{organizationSlug}/{projectSlug}
/sse/{organizationSlug}
/sse
```

For implementation details and security notes, see:
- `docs/cloudflare/constraint-flow-verification.md`
- `docs/architecture.mdc`
