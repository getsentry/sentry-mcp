import { z } from "zod";
import { setTag } from "@sentry/core";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { experimental_createMCPClient } from "ai";
import { defineTool } from "../../internal/tool-helpers/define";
import type { ServerContext } from "../../types";
import {
  ParamOrganizationSlug,
  ParamRegionUrl,
  ParamProjectSlug,
} from "../../schema";
import { useSentryAgent } from "./agent";
import { buildServer } from "../../server";
import { serverContextStorage } from "../../internal/context-storage";
import tools from "../index";

/**
 * Format tool calls into a readable trace
 */
function formatToolCallTrace(
  toolCalls: Array<{ toolName: string; args: any }>,
): string {
  let trace = "";

  for (let i = 0; i < toolCalls.length; i++) {
    const call = toolCalls[i];
    trace += `### ${i + 1}. ${call.toolName}\n\n`;

    // Format arguments
    if (Object.keys(call.args).length === 0) {
      trace += "_No arguments_\n\n";
    } else {
      trace += "**Arguments:**\n```json\n";
      trace += JSON.stringify(call.args, null, 2);
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
    organizationSlug: ParamOrganizationSlug.optional(),
    projectSlug: ParamProjectSlug.optional(),
    regionUrl: ParamRegionUrl.optional(),
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
    // Set tags for monitoring
    if (params.organizationSlug) {
      setTag("organization.slug", params.organizationSlug);
    }
    if (params.projectSlug) {
      setTag("project.slug", params.projectSlug);
    }

    // Create context with updated constraints from user parameters
    // This ensures the embedded agent respects org/project constraints
    const contextWithConstraints: ServerContext = {
      ...context,
      constraints: {
        organizationSlug:
          params.organizationSlug || context.constraints.organizationSlug,
        projectSlug: params.projectSlug || context.constraints.projectSlug,
        regionUrl: params.regionUrl || context.constraints.regionUrl,
      },
    };

    // Create linked pair of in-memory transports for client-server communication
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    // Build internal MCP server with constrained context
    const server = buildServer({
      context: contextWithConstraints,
      tools,
    });

    // Run all MCP operations within the ServerContext
    // This ensures tools invoked through the MCP protocol have access to the context
    return await serverContextStorage.run(contextWithConstraints, async () => {
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
    });
  },
});
