/**
 * McpSession Agent
 *
 * Extends Agent class and uses createMcpHandler with WorkerTransport.
 */

import { Agent } from "agents";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createMcpHandler,
  WorkerTransport,
  type TransportState,
} from "agents/mcp";
import { buildServer } from "@sentry/mcp-core/server";
import type { ServerContext } from "@sentry/mcp-core/types";
import type { Scope } from "@sentry/mcp-core/permissions";
import type { Skill } from "@sentry/mcp-core/skills";
import type { Env, SerializableServerContext } from "./types";
import * as Sentry from "@sentry/cloudflare";
import { logIssue } from "@sentry/mcp-core/telem/logging";

const STATE_KEY = "mcp_transport_state";

export class McpSession extends Agent<Env> {
  private server: McpServer | null = null;
  private sessionContext: ServerContext;
  private currentAgentMode = false;

  // Transport with storage persistence - follows https://developers.cloudflare.com/agents/model-context-protocol/mcp-handler-api/#workertransport
  transport = new WorkerTransport({
    sessionIdGenerator: () => this.name,
    storage: {
      get: () => {
        return this.ctx.storage.kv.get<TransportState>(STATE_KEY);
      },
      set: (state: TransportState) => {
        return this.ctx.storage.kv.put<TransportState>(STATE_KEY, state);
      },
    },
  });

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    // Initialize session context with placeholder values
    this.sessionContext = {
      accessToken: "",
      sentryHost: "sentry.io",
      clientId: "unknown",
      constraints: {},
    };
  }

  private ensureServer(agentMode: boolean): void {
    // Rebuild server if agent mode changes or server not initialized
    if (this.server === null || this.currentAgentMode !== agentMode) {
      this.currentAgentMode = agentMode;
      // Create and configure MCP server with tools filtered by session context
      // Context is captured in tool handler closures during buildServer()
      this.server = buildServer({
        context: this.sessionContext,
        agentMode,
        onToolComplete: () => {
          // Flush Sentry events after tool execution
          this.ctx.waitUntil(Sentry.flush(2000));
        },
      });
    }
  }

  // onMcpRequest method using createMcpHandler
  async onMcpRequest(
    request: Request,
    ctx: ExecutionContext,
  ): Promise<Response> {
    try {
      // Extract context data from ExecutionContext.props
      const contextData = ctx.props as SerializableServerContext | undefined;
      if (!contextData) {
        logIssue(new Error("Missing context data in McpSession"), {
          loggerScope: ["cloudflare", "mcp-session"],
        });
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32600,
              message: "Missing context data",
            },
            id: null,
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      // Update session context with fresh data from this request
      this.sessionContext.userId = contextData.userId;
      this.sessionContext.clientId = contextData.clientId;
      this.sessionContext.accessToken = contextData.accessToken;
      this.sessionContext.sentryHost = contextData.sentryHost;
      this.sessionContext.mcpUrl = contextData.mcpUrl;

      // Always set to current request's authorization state (clear if not present)
      this.sessionContext.grantedScopes = contextData.grantedScopes
        ? new Set<Scope>(contextData.grantedScopes as Scope[])
        : undefined;

      this.sessionContext.grantedSkills = contextData.grantedSkills
        ? new Set<Skill>(contextData.grantedSkills as Skill[])
        : undefined;

      this.sessionContext.constraints = {
        organizationSlug: contextData.organizationSlug,
        projectSlug: contextData.projectSlug,
      };

      this.ensureServer(contextData.isAgentMode ?? false);

      // Run MCP handler - context already captured in closures
      return createMcpHandler(this.server!, {
        transport: this.transport,
      })(request, this.env, ctx);
    } catch (error) {
      logIssue(error, {
        loggerScope: ["cloudflare", "mcp-session"],
      });
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message:
              error instanceof Error ? error.message : "Internal server error",
          },
          id: null,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }
}
