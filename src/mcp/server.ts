import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Props } from "../types";
import { logError } from "../lib/logging";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  TOOL_DEFINITIONS,
  TOOL_HANDLERS,
  type ToolHandler,
  type ToolHandlers,
  type ToolName,
} from "./tools";

export type WrappedToolCallback<T extends ToolName> = (
  ...args: [args: Parameters<ToolHandler<T>>["0"], extra: Parameters<ToolHandler<T>>["1"]]
) => Promise<CallToolResult>;

function wrapTool<T extends ToolName>(props: Props, cb: ToolHandlers[T]): WrappedToolCallback<T> {
  return async (...args) => {
    try {
      const output = await cb(props, ...args);

      return {
        content: [
          {
            type: "text",
            text: output,
          },
        ],
      };
    } catch (error) {
      logError(error);
      return {
        content: [
          {
            type: "text",
            text: `**Error**\n\nIt looks like there was a problem communicating with the Sentry API:\n\n${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
        isError: true,
      };
    }
  };
}

// Context from the auth process, encrypted & stored in the auth token
// and provided to the DurableMCP as this.props
export default class SentryMCP extends McpAgent<Env, unknown, Props> {
  server = new McpServer({
    name: "Sentry MCP",
    version: "0.1.0",
  });

  async init() {
    for (const tool of TOOL_DEFINITIONS) {
      this.server.tool(
        tool.name,
        tool.description,
        tool.paramsSchema,
        wrapTool(this.props, TOOL_HANDLERS[tool.name]),
      );
    }
  }
}
