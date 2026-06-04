import { z } from "zod";
import { defineTool } from "../../internal/tool-helpers/define";
import { UserInputError } from "../../errors";
import { ALL_SKILLS } from "../../skills";
import type { ServerContext } from "../../types";
import {
  executeToolHandler,
  getSearchableTools,
  type ToolRegistry,
} from "../catalog-runtime/availability";

export function createExecuteTool(getTools: () => ToolRegistry) {
  return defineTool({
    name: "execute_tool",
    skills: ALL_SKILLS,
    requiredScopes: [],
    experimental: true,
    description: [
      "Execute an available Sentry MCP tool discovered through search_tools.",
      "",
      "Use this tool when you need to:",
      "- Call a Sentry operation returned by search_tools",
      "- Execute a tool by name using arguments that match its returned schema",
      "",
      "<examples>",
      "execute_tool(name='find_projects', arguments={ organizationSlug: 'my-org' })",
      "execute_tool(name='update_issue', arguments={ organizationSlug: 'my-org', issueId: 'PROJ-1', status: 'resolved' })",
      "</examples>",
      "",
      "<hints>",
      "- Use search_tools first if you are not sure which name or arguments to pass.",
      "- Arguments are validated against the target tool's schema before execution.",
      "- Active organization, project, and region constraints are injected automatically.",
      "</hints>",
    ].join("\n"),
    inputSchema: {
      name: z
        .string()
        .trim()
        .min(1)
        .describe("The name of the available tool to execute."),
      arguments: z
        .record(z.unknown())
        .default({})
        .describe(
          "Arguments for the target tool, matching the schema returned by search_tools.",
        ),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    async handler(params, context: ServerContext) {
      const availableTools = getSearchableTools({
        tools: getTools(),
        context,
        experimentalMode: context.experimentalMode ?? false,
        useDefaultSurfacePolicy: true,
      });
      const match = availableTools.find(
        ({ key, tool }) => key === params.name || tool.name === params.name,
      );

      if (!match) {
        throw new UserInputError(
          `Tool "${params.name}" is not available in this session. Use search_tools to find an executable tool.`,
        );
      }

      return executeToolHandler({
        tool: match.tool,
        params: params.arguments,
        context,
      });
    },
  });
}
