import { z } from "zod";
import { defineTool } from "./utils/defineTool";
import { fetchWithTimeout } from "./utils/fetch-utils";
import { ApiError } from "../api-client/index";
import type { ServerContext } from "../types";
import type { SearchResponse } from "./types";
import { ParamSentryGuide } from "../schema";

export default defineTool({
  name: "search_docs",
  description: [
    "Search Sentry documentation for SDK setup, instrumentation, and configuration guidance.",
    "",
    "Use this tool when you need to:",
    "- Set up Sentry SDK in any language (Python, JavaScript, Go, Ruby, etc.)",
    "- Configure specific features like performance monitoring, error sampling, or release tracking",
    "- Implement custom instrumentation (spans, transactions, breadcrumbs)",
    "- Set up integrations with frameworks (Django, Flask, Express, Next.js, etc.)",
    "- Configure data scrubbing, filtering, or sampling rules",
    "- Troubleshoot SDK issues or find best practices",
    "",
    "This tool searches technical documentation, NOT general information about Sentry as a company.",
    "",
    "<examples>",
    "### Setting up Sentry in a Python Django app",
    "",
    "```",
    "search_docs(query='Django setup configuration SENTRY_DSN', guide='python/django')",
    "```",
    "",
    "### Setting up source maps for Next.js",
    "",
    "```",
    "search_docs(query='source maps webpack upload', guide='javascript/nextjs')",
    "```",
    "",
    "### Configuring release tracking",
    "",
    "```",
    "search_docs(query='release tracking deployment integration CI/CD')",
    "```",
    "</examples>",
    "",
    "<hints>",
    "- Use guide parameter to filter results to specific technologies (e.g., 'javascript' or 'javascript/nextjs')",
    "- Include the programming language/framework in your query for SDK-specific results",
    "- Use technical terms like 'instrumentation', 'spans', 'transactions' for performance docs",
    "- Include specific feature names like 'beforeSend', 'tracesSampleRate', 'SENTRY_DSN'",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    query: z
      .string()
      .trim()
      .min(
        2,
        "Search query is too short. Please provide at least 2 characters.",
      )
      .max(
        200,
        "Search query is too long. Please keep your query under 200 characters.",
      )
      .describe(
        "The search query in natural language. Be specific about what you're looking for.",
      ),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(3)
      .describe("Maximum number of results to return (1-10)")
      .optional(),
    guide: ParamSentryGuide.optional(),
  },
  async handler(params, context: ServerContext) {
    let output = `# Documentation Search Results\n\n`;
    output += `**Query**: "${params.query}"\n`;
    if (params.guide) {
      output += `**Guide**: ${params.guide}\n`;
    }
    output += `\n`;

    // Determine the URL - use context.mcpUrl if available, otherwise default to production
    const host = context.mcpUrl || "https://mcp.sentry.dev";
    const searchUrl = new URL("/api/search", host);

    const response = await fetchWithTimeout(
      searchUrl.toString(),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: params.query,
          maxResults: params.maxResults,
          guide: params.guide,
        }),
      },
      15000, // 15 second timeout
    );

    if (!response.ok) {
      // TODO: improve error responses with types
      const errorData = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      const errorMessage =
        errorData?.error || `Search failed with status ${response.status}`;
      throw new ApiError(errorMessage, response.status);
    }

    const data = (await response.json()) as SearchResponse;

    // Handle error in response
    if ("error" in data && data.error) {
      output += `**Error**: ${data.error}\n\n`;
      return output;
    }

    // Display results
    if (data.results.length === 0) {
      output += "No documentation found matching your query.\n\n";
      return output;
    }

    output += `Found ${data.results.length} match${data.results.length === 1 ? "" : "es"}\n\n`;

    output += `These are just snippets. Use \`get_doc(path='...')\` to fetch the full content.\n\n`;

    for (const [index, result] of data.results.entries()) {
      output += `## ${index + 1}. ${result.url}\n\n`;
      output += `**Path**: ${result.id}\n`;
      output += `**Relevance**: ${(result.relevance * 100).toFixed(1)}%\n\n`;
      if (index < 3) {
        output += "**Matching Context**\n";
        output += `> ${result.snippet.replace(/\n/g, "\n> ")}\n\n`;
      }
    }

    return output;
  },
});
