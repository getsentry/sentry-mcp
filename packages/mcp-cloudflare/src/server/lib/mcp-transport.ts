import * as Sentry from "@sentry/cloudflare";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { configureServer } from "@sentry/mcp-server/server";
import type { Env, WorkerProps } from "../types";
import { LIB_VERSION } from "@sentry/mcp-server/version";
import getSentryConfig from "../sentry.config";

// Context from the auth process, encrypted & stored in the auth token
// and provided to the DurableMCP as this.props
class SentryMCPBase extends McpAgent<Env, unknown, WorkerProps> {
  server = new McpServer({
    name: "Sentry MCP",
    version: LIB_VERSION,
  });
  // Note: This does not work locally with miniflare so we are not using it
  // server = wrapMcpServerWithSentry(
  //   new McpServer({
  //     name: "Sentry MCP",
  //     version: LIB_VERSION,
  //   }),
  // );

  // biome-ignore lint/complexity/noUselessConstructor: Need the constructor to match the durable object types.
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  async init() {
    await configureServer({
      server: this.server,
      context: {
        accessToken: this.props.accessToken,
        organizationSlug: this.props.organizationSlug,
        userId: this.props.id,
      },
      onToolComplete: () => {
        this.ctx.waitUntil(Sentry.flush(2000));
      },
    });
  }
}

export default Sentry.instrumentDurableObjectWithSentry(
  getSentryConfig.partial({
    initialScope: {
      tags: {
        durable_object: true,
        "mcp.server_version": LIB_VERSION,
      },
    },
  }),
  SentryMCPBase,
);
