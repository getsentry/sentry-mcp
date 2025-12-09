import { z } from "zod";
import { defineTool } from "../../internal/tool-helpers/define";
import type { ServerContext } from "../../types";
import { useSentryAgent } from "./agent";
import tools from "../index";
import type { ToolCall } from "../../internal/agents/callEmbeddedAgent";
import { wrapToolForAgent } from "./tool-wrapper";
import { hasRequiredSkills } from "../../skills";
import type { Tool } from "ai";
import type { ToolConfig } from "../types";

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

function buildAgentTools(context: ServerContext): Record<string, Tool> {
  const grantedSkills = context.grantedSkills
    ? new Set(context.grantedSkills)
    : undefined;

  const toolEntries = Object.entries(tools) as Array<
    [string, ToolConfig<Record<string, z.ZodTypeAny>>]
  >;

  const entries = toolEntries.filter(([toolKey, tool]) => {
    // Prevent recursion by excluding use_sentry itself
    if (toolKey === "use_sentry") {
      return false;
    }

    // Skip discovery tools when the session is already constrained
    if (
      toolKey === "find_organizations" &&
      context.constraints.organizationSlug
    ) {
      return false;
    }
    if (toolKey === "find_projects" && context.constraints.projectSlug) {
      return false;
    }

    // When no skills are provided, allow all tools (use_sentry agent mode
    // is only exposed to trusted contexts)
    if (!grantedSkills) {
      return true;
    }

    // Tools with empty requiredSkills are intentionally excluded from skill gating
    if (!tool.requiredSkills || tool.requiredSkills.length === 0) {
      return false;
    }

    return hasRequiredSkills(grantedSkills, tool.requiredSkills);
  });

  return Object.fromEntries(
    entries.map(([toolKey, tool]) => [
      toolKey,
      wrapToolForAgent(tool, { context }),
    ]),
  );
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
    "- inspect: Search errors/events, analyze traces, explore issues and projects",
    "- seer: Get AI-powered debugging insights and root cause analysis",
    "- docs: Search and retrieve Sentry documentation",
    "- triage: Resolve, assign, comment on, and update issues",
    "- project-management: Create/modify teams, projects, and configure DSNs",
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
      .nullable()
      .default(null)
      .describe(
        "Enable tracing to see all tool calls made by the agent. Useful for debugging.",
      ),
  },
  annotations: {
    readOnlyHint: true, // Will be adjusted based on actual implementation
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    const agentTools = buildAgentTools(context);

    // Call the embedded agent with wrapped tools and the user's request
    const agentResult = await useSentryAgent({
      request: params.request,
      tools: agentTools,
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
