import { Hono, type Context } from "hono";
import { csrf } from "hono/csrf";
import { secureHeaders } from "hono/secure-headers";
import * as Sentry from "@sentry/cloudflare";
import type { Env } from "./types";
import sentryOauth from "./oauth";
import chatOauth from "./routes/chat-oauth";
import chat from "./routes/chat";
import search from "./routes/search";
import metadata from "./routes/metadata";
import { logIssue } from "@sentry/mcp-core/telem/logging";
import { createRequestLogger } from "./logging";
import mcpRoutes from "./routes/mcp";
import { getClientIp } from "./utils/client-ip";

/** Derive the base URL (origin) from the current request. */
function getBaseUrl(c: Context): string {
  return new URL(c.req.url).origin;
}

function generateLlmsTxt(baseUrl: string): string {
  return `# Sentry MCP Server

Connects AI assistants to Sentry for searching errors, analyzing performance, triaging issues, reading documentation, and managing projects — all via the Model Context Protocol.

All connections use OAuth. The first connection will trigger an authentication flow to connect to your Sentry account.

## Connecting

The base MCP server address is: \`${baseUrl}/mcp\`

You can optionally scope the connection to an organization or project:

- \`${baseUrl}/mcp/{organizationSlug}\` — scoped to one organization
- \`${baseUrl}/mcp/{organizationSlug}/{projectSlug}\` — scoped to one project

When scoped, tools automatically default to the constrained org/project and unnecessary discovery tools are hidden. Scoping to a project is recommended when possible.

### Query Parameters

- \`?experimental=1\` — Enable experimental, forward-looking features and tools
- \`?agent=1\` — Agent mode: exposes a single \`use_sentry\` tool that handles natural language requests via an embedded AI agent (roughly doubles response time)

Parameters can be combined: \`${baseUrl}/mcp/my-org/my-project?experimental=1\`

## Setup Instructions

### Claude Code

\`\`\`bash
claude mcp add --transport http sentry ${baseUrl}/mcp/{organizationSlug}/{projectSlug}
\`\`\`

### Cursor

Use the "Install MCP Server" button, or manually add to MCP settings:

\`\`\`json
{
  "mcpServers": {
    "sentry": {
      "url": "${baseUrl}/mcp/{organizationSlug}/{projectSlug}"
    }
  }
}
\`\`\`

### VSCode

Command Palette → "MCP: Add Server" → HTTP → enter the endpoint:

\`\`\`
${baseUrl}/mcp/{organizationSlug}/{projectSlug}
\`\`\`

### Other Clients

Any MCP-compatible client can connect using the HTTP transport at the endpoint URL above.
`;
}

// RFC 9728: OAuth 2.0 Protected Resource Metadata handler
function handleOAuthProtectedResourceMetadata(c: Context): Response {
  const requestUrl = new URL(c.req.url);
  const baseUrl = requestUrl.origin;
  const resourcePath = requestUrl.pathname.replace(
    "/.well-known/oauth-protected-resource",
    "",
  );
  return c.json({
    resource: `${baseUrl}${resourcePath}`,
    authorization_servers: [baseUrl],
  });
}

const app = new Hono<{
  Bindings: Env;
}>()
  .use("*", createRequestLogger())
  // Set user IP address for Sentry (optional in local dev)
  .use("*", async (c, next) => {
    const clientIP = getClientIp(c.req.raw);

    if (clientIP) {
      Sentry.setUser({ ip_address: clientIP });
    }
    // In local development, IP extraction may fail - this is expected and safe to ignore
    // as it's only used for Sentry telemetry context

    await next();
  })
  // Apply security middleware globally
  .use(
    "*",
    secureHeaders({
      xFrameOptions: "DENY",
      xContentTypeOptions: "nosniff",
      referrerPolicy: "strict-origin-when-cross-origin",
      strictTransportSecurity: "max-age=31536000; includeSubDomains",
    }),
  )
  .use(
    "*",
    csrf({
      origin: (origin, c) => {
        // In hono 4.11.x+, this handler is only called when origin is defined
        const requestUrl = new URL(c.req.url);
        return origin === requestUrl.origin;
      },
      secFetchSite: (secFetchSite) => {
        // Allow same-origin and same-site requests (handles requests without Origin header)
        return secFetchSite === "same-origin" || secFetchSite === "same-site";
      },
    }),
  )
  .get("/", async (c, next) => {
    const accept = c.req.header("Accept") || "";
    if (accept.includes("text/markdown")) {
      return c.text(generateLlmsTxt(getBaseUrl(c)), 200, {
        "Content-Type": "text/markdown; charset=utf-8",
      });
    }
    await next();
  })
  .get("/robots.txt", (c) => {
    return c.text(
      [
        "User-agent: *",
        "Allow: /$",
        "Allow: /.well-known/",
        "Allow: /mcp.json",
        "Allow: /llms.txt",
        "Disallow: /",
      ].join("\n"),
    );
  })
  .get("/llms.txt", (c) => {
    return c.text(generateLlmsTxt(getBaseUrl(c)), 200, {
      "Content-Type": "text/plain; charset=utf-8",
    });
  })
  .get("/mcp.json", (c) => {
    const baseUrl = getBaseUrl(c);
    return c.json({
      name: "Sentry",
      description:
        "Connect your Sentry account to search, analyze, and manage errors and performance issues across your applications.",
      icon: `${baseUrl}/favicon.ico`,
      endpoint: `${baseUrl}/mcp`,
    });
  })
  // RFC 9728: OAuth 2.0 Protected Resource Metadata
  // ChatGPT and other clients query this to discover the authorization server
  // Root endpoint for clients that try /.well-known/oauth-protected-resource first
  .get(
    "/.well-known/oauth-protected-resource",
    handleOAuthProtectedResourceMetadata,
  )
  // Handles both /mcp and /mcp/* paths (e.g., /mcp/sentry/mcp-server)
  .get(
    "/.well-known/oauth-protected-resource/mcp",
    handleOAuthProtectedResourceMetadata,
  )
  .get(
    "/.well-known/oauth-protected-resource/mcp/*",
    handleOAuthProtectedResourceMetadata,
  )
  .route("/oauth", sentryOauth)
  .route("/api/auth", chatOauth)
  .route("/api/chat", chat)
  .route("/api/search", search)
  .route("/api/metadata", metadata)
  .route("/.mcp", mcpRoutes)
  .get("/sse", (c) => {
    return c.json(
      {
        error: "SSE transport has been removed",
        message:
          "The SSE transport endpoint is no longer supported. Please use the HTTP transport at /mcp instead.",
        migrationGuide: "https://mcp.sentry.dev",
      },
      410,
    );
  });

// TODO: propagate the error as sentry isnt injecting into hono
app.onError((err, c) => {
  logIssue(err);
  return c.text("Internal Server Error", 500);
});

export default app;
