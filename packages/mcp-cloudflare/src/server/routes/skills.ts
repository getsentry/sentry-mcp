/**
 * Skills API endpoint
 *
 * Provides public metadata about available MCP skills for OAuth approval UI.
 * Skills are user-facing capabilities that bundle related tools.
 */
import { Hono } from "hono";
import skillDefinitions from "@sentry/mcp-server/skillDefinitions";
import type { Env } from "../types";

export default new Hono<{ Bindings: Env }>().get("/", async (c) => {
  // Skills are public metadata - no authentication required
  // Return static skill definitions with pre-calculated tool counts
  return c.json({
    skills: skillDefinitions,
  });
});
