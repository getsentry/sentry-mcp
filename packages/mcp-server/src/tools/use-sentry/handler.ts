import { z } from "zod";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { experimental_createMCPClient } from "ai";
import { defineTool } from "../../internal/tool-helpers/define";
import type { ServerContext } from "../../types";
import { useSentryAgent } from "./agent";
import { buildServer } from "../../server";
import tools from "../index";
import type { ToolCall } from "../../internal/agents/callEmbeddedAgent";

/**
 * Format tool calls into a readable trace
 */
function formatToolCallTrace(toolCalls: ToolCall[]): string {
  let trace = "";

  for (let i = 0; i < toolCalls.length; i++) {
    const call = toolCalls[i];
    trace += `### ${i + 1}. ${call.toolName}\n\n`;

    // Type assertion is safe: AI SDK guarantees args is always a JSON-serializable object
    const args = call.args as Record<string, unknown>;

    // Format arguments
    if (Object.keys(args).length === 0) {
      trace += "_No arguments_\n\n";
    } else {
      trace += "**Arguments:**\n```json\n";
      trace += JSON.stringify(args, null, 2);
      trace += "\n```\n\n";
    }
  }

  return trace;
}

export default defineTool({
  name: "use_sentry",
  requiredSkills: [], // Not exposed via standard MCP - accessed via agent mode
  requiredScopes: [], // No specific scopes - uses authentication token
  description: [
    "Use Sentry's MCP Agent to answer questions related to Sentry (sentry.io).",
    "",
    "You should pass the entirety of the user's prompt to the agent. Do not interpret the prompt in any way. Just pass it directly to the agent.",
    "",
  ].join("\n"),
  inputSchema: {
    request: z
      .string()
      .trim()
      .min(1)
      .describe(
        "The user's raw input. Do not interpret the prompt in any way. Do not add any additional information to the prompt.",
      ),
    trace: z
      .boolean()
      .optional()
      .describe(
        "Enable tracing to see all tool calls made by the agent. Useful for debugging.",
      ),
  },
  annotations: {
    readOnlyHint: true, // Will be adjusted based on actual implementation
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    // Create linked pair of in-memory transports for client-server communication
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    // Filter out use_sentry from tools to prevent recursion and circular dependency
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { use_sentry, ...toolsForAgent } = tools;

    // Build internal MCP server with the provided context
    // Context is captured in tool handler closures during buildServer()
    const server = buildServer({
      context,
      tools: toolsForAgent,
    });

    // Connect server to its transport
    await server.server.connect(serverTransport);

    // Create MCP client with the other end of the transport
    const mcpClient = await experimental_createMCPClient({
      name: "mcp.sentry.dev (use-sentry)",
      transport: clientTransport,
    });

    try {
      // Get tools from MCP server (returns Vercel AI SDK compatible tools)
      const mcpTools = await mcpClient.tools();

      // Call the embedded agent with MCP tools and the user's request
      const agentResult = await useSentryAgent({
        request: params.request,
        tools: mcpTools,
      });

      let output = agentResult.result.result;

      // If tracing is enabled, append the tool call trace
      if (params.trace && agentResult.toolCalls.length > 0) {
        output += "\n\n---\n\n## Tool Call Trace\n\n";
        output += formatToolCallTrace(agentResult.toolCalls);
      }

      return output;
    } finally {
      // Clean up connections
      await mcpClient.close();
      await server.server.close();
    }
  },
});
