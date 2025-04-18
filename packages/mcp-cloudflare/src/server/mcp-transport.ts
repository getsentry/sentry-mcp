import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { configureServer } from "@sentry/mcp-server/server";
import type { Env, WorkerProps } from "./types.js";

// Context from the auth process, encrypted & stored in the auth token
// and provided to the DurableMCP as this.props
export default class SentryMCP extends McpAgent<Env, unknown, WorkerProps> {
  server = new McpServer({
    name: "Sentry MCP",
    version: "0.1.0",
  });

  async init() {
    configureServer(this.server, {
      accessToken: this.props.accessToken,
      organizationSlug: this.props.organizationSlug,
      userId: this.props.id,
    });
  }
}
