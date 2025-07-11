import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "./utils/defineTool";
import { apiServiceFromContext, withApiErrorHandling } from "./utils/api-utils";
import type { ServerContext } from "../types";
import {
  ParamOrganizationSlug,
  ParamRegionUrl,
  ParamProjectSlug,
} from "../schema";
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";

// Common Sentry fields that are always available
const COMMON_SENTRY_FIELDS = {
  // Error fields
  "error.type": "The type of error (e.g., TypeError, ValueError)",
  "error.value": "The error message",
  "error.handled": "Whether the error was handled (true/false)",
  message: "The log message or error description",
  level: "Log level (error, warning, info, debug)",
  platform: "Platform (javascript, python, etc.)",
  environment: "Environment (production, staging, development)",
  release: "Release version",
  "user.id": "User ID",
  "user.email": "User email",
  "user.username": "Username",
  transaction: "Transaction/route name",
  timestamp: "When the event occurred",

  // Transaction/Performance fields
  "transaction.duration": "Duration of transaction in milliseconds",
  "transaction.op": "Transaction operation type",
  "transaction.status": "Transaction status",
  "http.method": "HTTP method (GET, POST, etc.)",
  "http.status_code": "HTTP status code",
  "http.url": "HTTP URL",

  // General fields
  project: "Project slug",
  issue: "Issue ID",
  "event.type": "Event type (error, transaction)",
  "sdk.name": "SDK name",
  "sdk.version": "SDK version",
  "os.name": "Operating system name",
  "browser.name": "Browser name",
  device: "Device type",
  "geo.country_code": "Country code",
  "geo.region": "Geographic region",
  "geo.city": "City",
};

export default defineTool({
  name: "search_events",
  description: [
    "Search for events in Sentry using natural language queries.",
    "",
    "This tool accepts plain English descriptions and translates them to Sentry's search syntax.",
    "It searches across both errors and transactions in your Sentry organization.",
    "",
    "Use this tool when you need to:",
    "- Find errors or performance issues using natural language",
    "- Search for problems without knowing Sentry's query syntax",
    "- Analyze patterns across both errors and transactions",
    "",
    "<examples>",
    "### Find database timeouts",
    "```",
    "search_events(organizationSlug='my-org', naturalLanguageQuery='database timeouts in checkout flow from last hour')",
    "```",
    "",
    "### Find slow API endpoints",
    "```",
    "search_events(organizationSlug='my-org', naturalLanguageQuery='API calls taking over 5 seconds', projectSlug='backend')",
    "```",
    "",
    "### Find authentication errors",
    "```",
    "search_events(organizationSlug='my-org', naturalLanguageQuery='login failures with 401 errors in production')",
    "```",
    "</examples>",
    "",
    "<hints>",
    "- Be specific in your natural language query for better results",
    "- You can mention time ranges, error types, performance thresholds, etc.",
    "- The tool will explain how it translated your query if includeExplanation is true",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    naturalLanguageQuery: z
      .string()
      .trim()
      .min(1)
      .describe("Natural language description of what you want to search for"),
    projectSlug: ParamProjectSlug.optional(),
    regionUrl: ParamRegionUrl.optional(),
    limit: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .default(10)
      .describe("Maximum number of results to return"),
    includeExplanation: z
      .boolean()
      .optional()
      .default(false)
      .describe("Include explanation of how the query was translated"),
  },
  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    const organizationSlug = params.organizationSlug;

    setTag("organization.slug", organizationSlug);
    if (params.projectSlug) setTag("project.slug", params.projectSlug);

    // Get org-specific tags
    // TODO: Replace with correct API endpoint that returns all searchable fields
    // Currently using listTags as a placeholder - this only returns custom tags
    const customTags: Record<string, string> = {};
    try {
      const tags = await apiService.listTags({ organizationSlug });
      for (const tag of tags) {
        customTags[tag.key] = tag.name || tag.key;
      }
    } catch (error) {
      // If we can't get tags, continue with just common fields
      console.error("Failed to fetch custom tags:", error);
    }

    // Combine common fields with custom tags
    const allFields = { ...COMMON_SENTRY_FIELDS, ...customTags };

    // Create the system prompt for the LLM
    const systemPrompt = `You are a Sentry query translator. Convert natural language queries to Sentry's search syntax.

Available fields to search:
${Object.entries(allFields)
  .map(([key, desc]) => `- ${key}: ${desc}`)
  .join("\n")}

Query syntax rules:
- Use field:value for exact matches (e.g., level:error)
- Use field:>value or field:<value for numeric comparisons
- Use AND, OR, NOT for boolean logic
- Use quotes for phrases with spaces (e.g., message:"database timeout")
- Time ranges: Use timestamp with ISO format or relative times
- For errors use: event.type:error
- For transactions use: event.type:transaction

Examples:
- "database timeouts" → message:"database timeout" OR error.value:"timeout"
- "slow API calls over 5 seconds" → event.type:transaction AND transaction.duration:>5000
- "login errors in production" → message:"login" AND level:error AND environment:production
- "404 errors yesterday" → http.status_code:404 AND timestamp:>-24h

Important:
- Be specific and avoid overly broad queries
- Include event.type when the query clearly indicates errors vs transactions
- Use the most specific fields available
- Do NOT include project: filters in your query (project filtering is handled separately)
- Return ONLY the Sentry query string, no explanation`;

    // Check if OpenAI API key is available
    if (!process.env.OPENAI_API_KEY) {
      throw new Error(
        "OPENAI_API_KEY environment variable is required for semantic search",
      );
    }

    // Use the AI SDK to translate the query
    const { text: sentryQuery } = await generateText({
      model: openai("gpt-4o"),
      system: systemPrompt,
      prompt: params.naturalLanguageQuery,
      temperature: 0.1, // Low temperature for more consistent translations
    });

    // Execute the search using Sentry's events endpoint
    const fields = [
      "title",
      "culprit",
      "event.type",
      "issue",
      "level",
      "project",
      "last_seen()",
      "count()",
    ];

    const events = await withApiErrorHandling(
      () =>
        apiService.searchEvents({
          organizationSlug,
          query: sentryQuery,
          fields,
          limit: params.limit,
          projectSlug: params.projectSlug,
        }),
      {
        organizationSlug,
        projectSlug: params.projectSlug,
      },
    );

    // Format the output
    let output = `# Search Results for "${params.naturalLanguageQuery}"\n\n`;

    if (params.includeExplanation) {
      output += `## Query Translation\n`;
      output += `Natural language: "${params.naturalLanguageQuery}"\n`;
      output += `Sentry query: \`${sentryQuery}\`\n\n`;
    }

    const eventData = (events as any).data || [];
    if (eventData.length === 0) {
      output += `No results found.\n\n`;
      output += `Try being more specific or using different terms in your search.\n`;
      return output;
    }

    output += `Found ${eventData.length} event${eventData.length === 1 ? "" : "s"}:\n\n`;

    for (const event of eventData) {
      const eventType = event["event.type"] || "unknown";
      const isError = eventType === "error" || !event["event.type"];

      output += `## ${event.title || "Untitled Event"}\n\n`;
      output += `**Type**: ${isError ? "Error" : "Transaction"}\n`;
      if (event.issue) {
        output += `**Issue ID**: ${event.issue}\n`;
        output += `**URL**: ${apiService.getIssueUrl(organizationSlug, event.issue)}\n`;
      }
      output += `**Project**: ${event.project}\n`;
      if (event.level) output += `**Level**: ${event.level}\n`;
      output += `**Last Seen**: ${event["last_seen()"]}\n`;
      output += `**Occurrences**: ${event["count()"]}\n`;
      if (event.culprit) output += `**Location**: ${event.culprit}\n`;
      output += "\n";
    }

    output += "## Next Steps\n\n";
    output +=
      "- Get more details about a specific issue: `get_issue_details(organizationSlug, issueId)`\n";
    output +=
      "- Analyze an issue with AI: `analyze_issue_with_seer(organizationSlug, issueId)`\n";
    output +=
      "- Update issue status: `update_issue(organizationSlug, issueId, status)`\n";

    return output;
  },
});
