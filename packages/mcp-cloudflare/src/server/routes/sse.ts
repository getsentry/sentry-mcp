import { Hono } from "hono";
import type { Env, WorkerProps } from "../types";
import type { UrlConstraints } from "@sentry/mcp-server/types";
import { isValidSlug } from "../lib/slug-validation";
import { requireAuth } from "../middleware/auth";
import type { createOAuthService } from "../services/oauth";
import SentryMCP from "../lib/mcp-transport"; // Durable Object for SSE

const sse = new Hono<{
  Bindings: Env;
  Variables: {
    user: WorkerProps;
    oauthService: ReturnType<typeof createOAuthService>;
    constraints?: UrlConstraints;
  };
}>()
  // Apply OAuth authentication middleware to all SSE routes
  .use("*", requireAuth)
  // Extract and validate URL constraints (similar to MCP routes)
  .use("/:org?/:project?/*?", async (c, next) => {
    const org = c.req.param("org");
    const project = c.req.param("project");
    
    // NOTE: SSE endpoints have limitations with subpath constraints
    // due to the protocol and Durable Object architecture
    // See docs/cloudflare/oauth-architecture.md for details
    
    if (org) {
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
      
      c.set("constraints", constraints);
    }
    
    await next();
  })
  // Handle SSE requests using Durable Objects
  .all("/*", async (c) => {
    const user = c.get("user");
    const constraints = c.get("constraints");
    
    // Create the SSE handler using the Durable Object
    const handler = SentryMCP.serveSSE("/sse");
    
    // Prepare the request with necessary headers
    const headers = new Headers(c.req.raw.headers);
    
    // Pass constraints via headers (required for DO architecture)
    // These will be extracted by the DO's fetch handler
    if (constraints?.organizationSlug) {
      headers.set("X-Sentry-Org-Slug", constraints.organizationSlug);
    }
    if (constraints?.projectSlug) {
      headers.set("X-Sentry-Project-Slug", constraints.projectSlug);
    }
    
    // Create a new request with updated headers
    const modifiedRequest = new Request(c.req.raw, { headers });
    
    // Create execution context with user props
    // The DO expects props to be passed via the execution context
    const executionContext = {
      ...c.executionCtx,
      props: user, // Pass user props for the DO
    } as ExecutionContext;
    
    // Call the Durable Object handler
    return handler.fetch(modifiedRequest, c.env, executionContext);
  });

export default sse;