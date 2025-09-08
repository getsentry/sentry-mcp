# Cloudflare Web Chat Application

This directory contains documentation for the Cloudflare-hosted web chat application that **uses** the Sentry MCP server.

## Important: This is NOT part of MCP

The Cloudflare chat application (`packages/mcp-cloudflare`) is a **separate web application** that demonstrates how to build a chat interface using MCP. It is not part of the MCP protocol or server itself.

Think of it as:
- **MCP Server**: The backend service that provides Sentry functionality via the Model Context Protocol
- **Cloudflare Chat**: A frontend web app (like ChatGPT) that connects to and uses the MCP server

## What This Application Provides

- Web-based chat UI with OAuth authentication
- AI-powered assistant using OpenAI's GPT-4  
- Integration with Sentry MCP tools via HTTP transport
- Cloudflare Workers deployment for global edge hosting

## Architecture Separation

```
┌─────────────────────────┐     ┌──────────────────────┐
│   Cloudflare Web App    │     │    MCP Server        │
│  (This Documentation)   │     │  (Core MCP Docs)     │
├─────────────────────────┤     ├──────────────────────┤
│ • React Frontend        │     │ • MCP Protocol       │
│ • Chat UI              │ --> │ • Sentry Tools       │
│ • OAuth Flow           │     │ • Prompt Handlers    │
│ • GPT-4 Integration    │     │ • Resource Providers │
└─────────────────────────┘     └──────────────────────┘
        Uses MCP via                 The actual MCP
        HTTP Transport               implementation
```

## Documentation Structure

- Architecture: @docs/cloudflare/architecture.md — Technical architecture of the web application
- OAuth Architecture: @docs/cloudflare/oauth-architecture.md — OAuth flow and token management
- Chat Interface: @docs/cloudflare/architecture.md — See "Chat Interface" section
- Prompts Integration: @docs/cloudflare/prompts-integration.md — How the chat app uses MCP prompts
- Deployment: @docs/cloudflare/deployment.md — Deploying to Cloudflare Workers

## Quick Links

- Live deployment: https://mcp.sentry.dev
- Package location: `packages/mcp-cloudflare`
- **For MCP Server docs**: See "Architecture" in @docs/architecture.mdc

## Local Dev Topology

Two Vite servers run in development to mirror production:

- mcp-cloudflare (primary)
  - Worker: http://localhost:8788
  - Vite HMR: http://localhost:5173
- docs worker (service: `sentry-mcp-docs`)
  - Worker: http://localhost:8790
  - Vite HMR: http://localhost:5174

Service bindings are defined in `packages/mcp-cloudflare/wrangler.jsonc`:

- `services: [{ binding: "DOCS", service: "sentry-mcp-docs" }]`
- `dev.services: [{ binding: "DOCS", local_port: 8790 }]`

The default export in `packages/mcp-cloudflare/src/server/index.ts` forwards `/docs` to the `DOCS` binding before falling through to the app/OAuth handler.

## Dev Commands (Root)

- `pnpm run dev`
  - Uses Turbo to start `@sentry/mcp-cloudflare#dev` and co-run `@sentry/mcp-server#dev` and `@sentry/mcp-docs#dev` via a package-level Turbo config.
  - Do not start auxiliary workers manually; the two Vite servers are intentional.

## Build Commands (Root)

- `pnpm run build`
  - Turbo builds upstream packages first (`^build`), then `mcp-cloudflare`. Unchanged packages are skipped via caching.

## Troubleshooting

- If Vite briefly fails to resolve `@sentry/mcp-server/*` during dev, it’s usually because the server package is mid-build. Restart dev after the initial build completes.
- Ensure `@sentry/mcp-server` is a runtime dependency of `@sentry/mcp-cloudflare` (declared under `dependencies`).
- For per-package workflows, prefer root `dev`/`build`; Turbo handles ordering and caching.

## Smoke Test

Run smoke tests against a local or preview URL to verify `/docs` routing:

- `PREVIEW_URL=http://localhost:8788 pnpm --filter @sentry/mcp-smoke-tests test`
- Expects status `200` and `<title>Documentation` in the `/docs` response.
