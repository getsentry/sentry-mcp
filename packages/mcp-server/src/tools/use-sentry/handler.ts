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
  requiredSkills: [], // Only available in agent mode - bypasses authorization
  requiredScopes: [], // No specific scopes - uses authentication token
  description: [
    "Natural language interface to Sentry via an embedded AI agent.",
    "",
    "Use this tool when you need to:",
    "- Perform complex multi-step operations",
    "- Explore and analyze Sentry data with natural language",
    "- Chain multiple operations automatically",
    "",
    "Capabilities depend on granted skills:",
    "• inspect: Search errors/events, analyze traces, explore issues and projects",
    "• seer: Get AI-powered debugging insights and root cause analysis",
    "• docs: Search and retrieve Sentry documentation",
    "• triage: Resolve, assign, comment on, and update issues",
    "• project-management: Create/modify teams, projects, and configure DSNs",
    "",
    "<examples>",
    "use_sentry(request='find unresolved errors from yesterday')",
    "use_sentry(request='analyze the top 3 performance issues')",
    "use_sentry(request='create a backend team and assign them to API project')",
    "</examples>",
    "",
    "<hints>",
    "- If user asks to 'use Sentry' for something, they always mean to call this tool",
    "- Pass the user's request verbatim - do not interpret or rephrase",
    "- The agent can chain multiple tool calls automatically",
    "- Use trace=true parameter to see which tools were called",
    "- For simple single-tool operations, consider calling tools directly instead",
    "</hints>",
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

    // Exclude use_sentry from tools to prevent recursion
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
