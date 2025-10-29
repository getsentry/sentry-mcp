import { z } from "zod";
import { defineTool } from "../../internal/tool-helpers/define";
import type { ServerContext } from "../../types";
import { useSentryAgent } from "./agent";
import tools from "../index";
import type { ToolCall } from "../../internal/agents/callEmbeddedAgent";
import { prepareToolsForAgent } from "./prepare-tools";

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
    // Filter out use_sentry from tools to prevent recursion and circular dependency
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { use_sentry, ...toolsForAgent } = tools;

    // Prepare tools with scope filtering and constraint injection
    // This replicates buildServer's logic but returns tools directly
    const preparedTools = prepareToolsForAgent(toolsForAgent, context);

    // Call the embedded agent with prepared tools and the user's request
    const agentResult = await useSentryAgent({
      request: params.request,
      tools: preparedTools,
    });

    let output = agentResult.result.result;

    // If tracing is enabled, append the tool call trace
    if (params.trace && agentResult.toolCalls.length > 0) {
      output += "\n\n---\n\n## Tool Call Trace\n\n";
      output += formatToolCallTrace(agentResult.toolCalls);
    }

    return output;
  },
});
