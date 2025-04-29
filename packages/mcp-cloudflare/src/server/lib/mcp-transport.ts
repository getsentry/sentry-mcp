import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { configureServer } from "@sentry/mcp-server/server";
import type { Env, WorkerProps } from "../types";
import { flush } from "@sentry/cloudflare";
import { wrapMcpServerWithSentry } from "@sentry/core";
import { LIB_VERSION } from "@sentry/mcp-server/version";

// Context from the auth process, encrypted & stored in the auth token
// and provided to the DurableMCP as this.props
export default class SentryMCP extends McpAgent<Env, unknown, WorkerProps> {
  server = wrapMcpServerWithSentry(
    new McpServer({
      name: "Sentry MCP",
      version: LIB_VERSION,
    }),
  );

  async init() {
    await configureServer({
      server: this.server,
      context: {
        accessToken: this.props.accessToken,
        organizationSlug: this.props.organizationSlug,
        userId: this.props.id,
      },
      onToolComplete: () => {
        this.ctx.waitUntil(flush(2000));
      },
    });
  }
}
