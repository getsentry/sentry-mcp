/**
 * Public MCP metadata endpoints under `/.mcp/*` for external documentation sites.
 *
 * Responds with pre-generated JSON payloads from @sentry/mcp-core.
 * CORS is handled by the wrapper in index.ts (these paths are in PUBLIC_METADATA_PATHS),
 * so routes here only need to set content-specific headers like Cache-Control.
 */
import { Hono } from "hono";
import SKILL_DEFINITIONS from "@sentry/mcp-core/skillDefinitions";
import TOOL_DEFINITIONS from "@sentry/mcp-core/toolDefinitions";

function jsonResponse(json: unknown, status = 200) {
  const body = JSON.stringify(json);
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300", // 5 minutes
    },
  });
}

export default new Hono()
  // Index: advertise available endpoints
  .get("/", (c) =>
    jsonResponse({
      endpoints: ["/.mcp/tools.json", "/.mcp/skills.json"],
    }),
  )
  // Tools
  .get("/tools.json", (c) => jsonResponse(TOOL_DEFINITIONS))
  // Skills
  .get("/skills.json", (c) => jsonResponse(SKILL_DEFINITIONS));
