import { Hono } from "hono";
import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { configureServer } from "@sentry/mcp-server/server";
import type { Env, WorkerProps } from "../types";
import type { ServerContext, UrlConstraints } from "@sentry/mcp-server/types";
import { LIB_VERSION } from "@sentry/mcp-server/version";
import { isValidSlug } from "../lib/slug-validation";
import { requireAuth } from "../middleware/auth";
import type { createOAuthService } from "../services/oauth";

const mcp = new Hono<{
  Bindings: Env;
  Variables: {
    user: WorkerProps;
    oauthService: ReturnType<typeof createOAuthService>;
    constraints?: UrlConstraints;
  };
}>()
  // Apply OAuth authentication middleware to all MCP routes
  .use("*", requireAuth)
  // Extract and validate URL constraints from path parameters
  .use("/:org?/:project?", async (c, next) => {
    const org = c.req.param("org");
    const project = c.req.param("project");
    
    // Skip validation for root path (no constraints)
    if (!org) {
      await next();
      return;
    }
    
    // Validate organization slug
    if (!isValidSlug(org)) {
      return c.json(
        {
          error: "invalid_request",
          error_description: "Invalid organization slug format",
        },
        400
      );
    }
    
    const constraints: UrlConstraints = {
      organizationSlug: org,
    };
    
    // Validate project slug if provided
    if (project) {
      if (!isValidSlug(project)) {
        return c.json(
          {
            error: "invalid_request",
            error_description: "Invalid project slug format",
          },
          400
        );
      }
      constraints.projectSlug = project;
    }
    
    // Store constraints in Hono context
    c.set("constraints", constraints);
    await next();
  })
  // Handle MCP requests with @hono/mcp
  .all("/:org?/:project?", async (c) => {
    // Get everything from Hono context
    const user = c.get("user");
    const constraints = c.get("constraints");
    
    // Build server context using Hono context values
    const serverContext: ServerContext = {
      apiToken: user.accessToken,
      baseUrl: c.env.SENTRY_BASE_URL || "https://sentry.io",
      constraints: constraints || undefined,
      // Pass Cloudflare-specific context for any tools that need it
      cloudflare: {
        env: c.env,
        executionContext: c.executionCtx,
        request: c.req.raw,
      },
    };
    
    // Create MCP server instance
    const mcpServer = new McpServer({
      name: "sentry-mcp",
      version: LIB_VERSION,
    });
    
    // Configure with our tools, prompts, and resources
    configureServer(mcpServer, serverContext);
    
    // Create transport and connect
    const transport = new StreamableHTTPTransport();
    await mcpServer.connect(transport);
    
    // Handle the MCP request through the transport
    // The transport will handle the HTTP streaming protocol
    return transport.handleRequest(c);
  });

export default mcp;