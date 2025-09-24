/**
 * Public MCP metadata endpoints under `/.mcp/*` for external documentation sites.
 *
 * Responds with pre-generated JSON payloads from @sentry/mcp-server.
 * Adds permissive CORS for easy cross-origin consumption.
 */
import { Hono } from "hono";
import TOOL_DEFINITIONS from "@sentry/mcp-server/toolDefinitions";
import PROMPT_DEFINITIONS from "@sentry/mcp-server/promptDefinitions";
import RESOURCE_DEFINITIONS from "@sentry/mcp-server/resourceDefinitions";

function withCors(json: unknown, status = 200) {
  const body = JSON.stringify(json);
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "public, max-age=300", // 5 minutes
    },
  });
}

export default new Hono()
  // CORS preflight
  .options("/*", (c) => withCors(null, 204))
  // Index: advertise available endpoints
  .get("/", (c) =>
    withCors({
      endpoints: [
        "/.mcp/tools.json",
        "/.mcp/prompts.json",
        "/.mcp/resources.json",
      ],
    }),
  )
  // Tools
  .get("/tools.json", (c) => withCors(TOOL_DEFINITIONS))
  // Prompts
  .get("/prompts.json", (c) => withCors(PROMPT_DEFINITIONS))
  // Resources
  .get("/resources.json", (c) => withCors(RESOURCE_DEFINITIONS));
