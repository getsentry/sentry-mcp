import { z } from "zod";
import { defineTool } from "../../internal/tool-helpers/define";
import { ALL_SKILLS } from "../../skills";
import type { ServerContext } from "../../types";
import { searchToolCatalog } from "../catalog-runtime/search";
import type { ToolRegistry } from "../catalog-runtime/availability";

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;

const toolAnnotationsOutputSchema = z.object({
  readOnlyHint: z.boolean().optional(),
  destructiveHint: z.boolean().optional(),
  idempotentHint: z.boolean().optional(),
  openWorldHint: z.boolean().optional(),
});

export const searchToolsOutputSchema = z.object({
  query: z.string(),
  results: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      inputSchema: z
        .record(z.unknown())
        .describe(
          "JSON Schema for the arguments to pass to execute_tool. Session-constrained parameters are omitted.",
        ),
      annotations: toolAnnotationsOutputSchema,
    }),
  ),
});

type SearchToolsOutput = z.infer<typeof searchToolsOutputSchema>;

function createSearchToolsResult(payload: SearchToolsOutput) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: payload,
  };
}

export function createSearchToolsTool(getTools: () => ToolRegistry) {
  return defineTool({
    name: "search_tools",
    skills: ALL_SKILLS,
    requiredScopes: [],
    experimental: true,
    description: [
      "Search available Sentry MCP tools by name and description.",
      "",
      "Use this tool when you need to:",
      "- Find the right Sentry operation before calling execute_tool",
      "- Discover available tools for a task without scanning the full top-level tool list",
      "- Inspect the executable JSON input schema for an available tool",
      "",
      "<examples>",
      "search_tools(query='list projects')",
      "search_tools(query='update issue status')",
      "search_tools(query='find dsn', limit=5)",
      "</examples>",
      "",
      "<hints>",
      "- Results only include tools available in the current session.",
      "- Returned schemas already account for active organization, project, and region constraints.",
      "- Call execute_tool with the returned name and arguments that match the returned schema.",
      "- This tool returns structured JSON. Do not parse markdown from its text content.",
      "</hints>",
    ].join("\n"),
    inputSchema: {
      query: z
        .string()
        .trim()
        .min(1)
        .describe("Keywords describing the Sentry operation to find."),
      limit: z
        .number()
        .int()
        .positive()
        .max(MAX_LIMIT)
        .nullable()
        .default(DEFAULT_LIMIT)
        .describe(
          `Maximum number of matching tools to return, up to ${MAX_LIMIT}.`,
        ),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
    outputSchema: searchToolsOutputSchema,
    async handler(params, context: ServerContext) {
      const results = searchToolCatalog({
        tools: getTools(),
        context,
        query: params.query,
        limit: params.limit ?? DEFAULT_LIMIT,
      });

      return createSearchToolsResult({
        query: params.query,
        results,
      });
    },
  });
}
