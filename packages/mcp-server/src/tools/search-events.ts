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

// Common Sentry fields for different datasets
const COMMON_SPANS_FIELDS = {
  // Span fields
  "span.op": "Span operation type (e.g., http.client, db.query, cache.get)",
  "span.description": "Detailed description of the span operation",
  "span.duration": "Duration of the span in milliseconds",
  "span.status": "Span status (ok, cancelled, unknown, etc.)",
  "span.self_time": "Time spent in this span excluding child spans",

  // Transaction fields
  transaction: "Transaction name/route",
  "transaction.duration": "Total transaction duration in milliseconds",
  "transaction.op": "Transaction operation type",
  "transaction.status": "Transaction status",
  is_transaction: "Whether this span is a transaction (true/false)",

  // Trace fields
  trace: "Trace ID",
  "trace.span_id": "Span ID within the trace",
  "trace.parent_span_id": "Parent span ID",

  // HTTP fields
  "http.method": "HTTP method (GET, POST, etc.)",
  "http.status_code": "HTTP response status code",
  "http.url": "Full HTTP URL",

  // Database fields
  "db.system": "Database system (postgresql, mysql, etc.)",
  "db.operation": "Database operation (SELECT, INSERT, etc.)",

  // General fields
  project: "Project slug",
  timestamp: "When the span occurred",
  environment: "Environment (production, staging, development)",
  release: "Release version",
  platform: "Platform (javascript, python, etc.)",
  "user.id": "User ID",
  "user.email": "User email",
  "sdk.name": "SDK name",
  "sdk.version": "SDK version",
};

const COMMON_ERRORS_FIELDS = {
  // Error fields
  message: "Error message",
  level: "Error level (error, warning, info, debug)",
  "error.type": "Error type/exception class",
  "error.value": "Error value/description",
  "error.handled": "Whether the error was handled (true/false)",
  culprit: "Code location that caused the error",

  // Stack trace fields
  "stack.filename": "File where error occurred",
  "stack.function": "Function where error occurred",
  "stack.module": "Module where error occurred",
  "stack.abs_path": "Absolute path to file",

  // General fields
  title: "Error title/grouping",
  project: "Project slug",
  timestamp: "When the error occurred",
  environment: "Environment (production, staging, development)",
  release: "Release version",
  platform: "Platform (javascript, python, etc.)",
  "user.id": "User ID",
  "user.email": "User email",
  "sdk.name": "SDK name",
  "sdk.version": "SDK version",
  "os.name": "Operating system name",
  "browser.name": "Browser name",
  "device.family": "Device family",
};

const COMMON_LOGS_FIELDS = {
  // Log fields
  message: "Log message",
  severity: "Log severity level",
  severity_number: "Numeric severity level",
  "sentry.item_id": "Sentry item ID",
  "sentry.observed_timestamp_nanos": "Observed timestamp in nanoseconds",

  // Trace context
  trace: "Trace ID",

  // General fields
  project: "Project slug",
  timestamp: "When the log was created",
  environment: "Environment (production, staging, development)",
  release: "Release version",
};

// Dataset-specific rules and examples
const DATASET_CONFIGS = {
  errors: {
    rules: `- For errors, focus on: message, level, error.type, error.handled
- Use level field for severity (error, warning, info, debug)
- Use error.handled:false for unhandled exceptions/crashes
- For filename searches: Use stack.filename for suffix-based search (e.g., stack.filename:"**/index.js" or stack.filename:"**/components/Button.tsx")
- When searching for errors in specific files, prefer including the parent folder to avoid ambiguity (e.g., stack.filename:"**/components/index.js" instead of just stack.filename:"**/index.js")`,
    examples: `- "null pointer exceptions" → error.type:"NullPointerException" OR message:"*null pointer*"
- "unhandled errors in production" → error.handled:false AND environment:production
- "database connection errors" → message:"*database*" AND message:"*connection*" AND level:error
- "authentication failures" → message:"*auth*" AND (message:"*failed*" OR message:"*denied*")
- "timeout errors in the last hour" → message:"*timeout*" AND level:error AND timestamp:-1h
- "production errors from last 24 hours" → level:error AND environment:production AND timestamp:-24h
- "errors in Button.tsx file" → stack.filename:"**/Button.tsx"
- "errors in any index.js file in components folder" → stack.filename:"**/components/index.js"`,
  },
  logs: {
    rules: `- For logs, focus on: message, severity, severity_number
- Use severity field for log levels (fatal, error, warning, info, debug, trace)
- severity_number is numeric (21=fatal, 17=error, 13=warning, 9=info, 5=debug, 1=trace)
- IMPORTANT: For time-based filtering in logs, do NOT use timestamp filters in the query
- Instead, time filtering for logs is handled by the statsPeriod parameter (not part of the query string)
- Keep your query focused on message content, severity levels, and other attributes only`,
    examples: `- "warning logs about memory" → severity:warning AND message:"*memory*"
- "error logs from database" → severity:error AND message:"*database*"
- "debug logs" → severity:debug
- "critical system alerts" → severity_number:>=17
- "recent logs" → (no timestamp filter needed - time range handled separately)
- "logs from last hour" → (no timestamp filter needed - time range handled separately)
- "API error logs" → severity:error AND message:"*API*"`,
  },
  spans: {
    rules: `- For traces/spans, focus on: span.op, span.description, span.duration, transaction
- Use is_transaction:true for transaction spans only
- Use span.duration for performance queries (value is in milliseconds)`,
    examples: `- "database queries" → span.op:db OR span.op:db.query
- "slow API calls over 5 seconds" → span.duration:>5000 AND span.op:http*
- "checkout flow traces" → transaction:"*checkout*" OR span.description:"*checkout*"
- "redis timeout errors" → span.op:cache.get* AND span.description:"*timeout*"
- "http requests to external APIs" → span.op:http.client
- "slow database queries in the last hour" → span.op:db.query AND span.duration:>1000 AND timestamp:-1h
- "recent failed transactions" → is_transaction:true AND span.status:internal_error AND timestamp:-30m`,
  },
};

// Base system prompt template
const SYSTEM_PROMPT_TEMPLATE = `You are a Sentry query translator. Convert natural language queries to Sentry's search syntax for the {dataset} dataset.

Available fields to search:
{fields}

Query syntax rules:
- Use field:value for exact matches
- Use field:>value or field:<value for numeric comparisons
- Use AND, OR, NOT for boolean logic
- Use quotes for phrases with spaces
- Use wildcards (*) for partial matches
- For timestamp filters:
  - Spans/Errors datasets: Use timestamp:-1h format (e.g., timestamp:-1h for last hour, timestamp:-24h for last day)  
  - Logs dataset: Do NOT include timestamp filters in query - time filtering handled separately
  - Absolute times: Use comparison operators with ISO dates (e.g., timestamp:<=2025-07-11T04:52:50.511Z)
- IMPORTANT: For relative durations, use format WITHOUT operators (timestamp:-1h NOT timestamp:>-1h)
{datasetRules}

Examples:
{datasetExamples}

Important:
- Do NOT include project: filters in your query (project filtering is handled separately)
- For spans/errors: When user mentions time periods like "last hour" or "past day", include timestamp:-1h or timestamp:-24h in the query
- For logs: When user mentions time periods, do NOT include any timestamp filters in the query - time filtering is handled automatically
- Return ONLY the Sentry query string, no explanation`;

export default defineTool({
  name: "search_events",
  description: [
    "Search for events in Sentry using natural language queries.",
    "",
    "This tool accepts plain English descriptions and translates them to Sentry's search syntax.",
    "It searches across errors, traces/spans, and logs in your Sentry organization.",
    "",
    "Use this tool when you need to:",
    "- Find errors, traces, or logs using natural language",
    "- Search for problems without knowing Sentry's query syntax",
    "- Analyze patterns across different types of telemetry data",
    "",
    "<examples>",
    "### Find database timeouts in traces",
    "```",
    "search_events(organizationSlug='my-org', naturalLanguageQuery='database timeouts in checkout flow from last hour', dataset='spans')",
    "```",
    "",
    "### Find errors with specific messages",
    "```",
    "search_events(organizationSlug='my-org', naturalLanguageQuery='null pointer exceptions in production', dataset='errors')",
    "```",
    "",
    "### Find logs with warnings",
    "```",
    "search_events(organizationSlug='my-org', naturalLanguageQuery='warning logs about memory usage', dataset='logs')",
    "```",
    "</examples>",
    "",
    "<hints>",
    "- Be specific in your natural language query for better results",
    "- You can mention time ranges, error types, performance thresholds, etc.",
    "- The tool will explain how it translated your query if includeExplanation is true",
    "- Dataset defaults to 'errors' for exception/error data",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    naturalLanguageQuery: z
      .string()
      .trim()
      .min(1)
      .describe("Natural language description of what you want to search for"),
    dataset: z
      .enum(["spans", "errors", "logs"])
      .optional()
      .default("errors")
      .describe(
        "The dataset to search in (errors for exceptions, spans for traces/performance, logs for log data)",
      ),
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

    // Get searchable attributes based on dataset
    const customAttributes: Record<string, string> = {};
    let commonFields: Record<string, string>;

    // Use errors dataset by default if not specified
    const dataset = params.dataset || "errors";

    if (dataset === "errors") {
      // TODO: For errors dataset, we currently need to use the old listTags API
      // This will be updated in the future to use the new trace-items attributes API
      commonFields = COMMON_ERRORS_FIELDS;
      try {
        const tagsResponse = await apiService.listTags({
          organizationSlug,
        });

        // listTags returns an array of tag objects with 'key' field
        if (Array.isArray(tagsResponse)) {
          for (const tag of tagsResponse) {
            if (tag.key && !tag.key.startsWith("sentry:")) {
              customAttributes[tag.key] = tag.name || tag.key;
            }
          }
        }
      } catch (error) {
        // If we can't get tags, continue with just common fields
        console.error("Failed to fetch tags for errors dataset:", error);
      }
    } else if (dataset === "logs") {
      // For logs dataset, use the trace-items attributes endpoint
      commonFields = COMMON_LOGS_FIELDS;
      try {
        const attributesResponse = await apiService.listTraceItemAttributes({
          organizationSlug,
          itemType: "logs", // Specify logs item type (plural)
        });

        if (Array.isArray(attributesResponse)) {
          for (const attr of attributesResponse) {
            if (attr.key) {
              customAttributes[attr.key] = attr.name || attr.key;
            }
          }
        }
      } catch (error) {
        console.error("Failed to fetch trace item attributes for logs:", error);
      }
    } else {
      // Default to spans dataset
      commonFields = COMMON_SPANS_FIELDS;
      try {
        const attributesResponse = await apiService.listTraceItemAttributes({
          organizationSlug,
          itemType: "span", // Specify span item type
        });

        if (Array.isArray(attributesResponse)) {
          for (const attr of attributesResponse) {
            if (attr.key) {
              customAttributes[attr.key] = attr.name || attr.key;
            }
          }
        }
      } catch (error) {
        console.error(
          "Failed to fetch trace item attributes for spans:",
          error,
        );
      }
    }

    // Combine common fields with custom attributes
    const allFields = { ...commonFields, ...customAttributes };

    // Get dataset configuration
    const datasetConfig = DATASET_CONFIGS[dataset] || DATASET_CONFIGS.spans;

    // Build the system prompt
    const systemPrompt = SYSTEM_PROMPT_TEMPLATE.replace("{dataset}", dataset)
      .replace(
        "{fields}",
        Object.entries(allFields)
          .map(([key, desc]) => `- ${key}: ${desc}`)
          .join("\n"),
      )
      .replace("{datasetRules}", datasetConfig.rules)
      .replace("{datasetExamples}", datasetConfig.examples);

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

    // Convert project slug to ID if needed
    let projectId: string | undefined;
    if (params.projectSlug) {
      // The events endpoint requires numeric project IDs, not slugs
      // Fetch the project to get its ID
      const projects = await apiService.listProjects(organizationSlug);
      const project = projects.find((p) => p.slug === params.projectSlug);
      if (!project) {
        throw new Error(
          `Project '${params.projectSlug}' not found in organization '${organizationSlug}'`,
        );
      }
      // Convert to string to ensure consistent type
      projectId = String(project.id);
    }

    // Select fields based on dataset
    let fields: string[];
    if (dataset === "errors") {
      fields = [
        "id",
        "message",
        "level",
        "culprit",
        "type",
        "timestamp",
        "project",
        "title",
      ];
    } else if (dataset === "logs") {
      fields = [
        "sentry.item_id",
        "project.id",
        "trace",
        "severity_number",
        "severity",
        "timestamp",
        "tags[sentry.timestamp_precise,number]",
        "sentry.observed_timestamp_nanos",
        "message",
      ];
    } else {
      // Spans dataset
      fields = [
        "id",
        "span.op",
        "span.description",
        "span.duration",
        "transaction",
        "timestamp",
        "project",
        "trace",
        "transaction.span_id",
      ];
    }

    const events = await withApiErrorHandling(
      () =>
        apiService.searchEvents({
          organizationSlug,
          query: sentryQuery,
          fields,
          limit: params.limit,
          projectSlug: projectId, // API requires numeric project ID, not slug
          dataset: dataset === "logs" ? "ourlogs" : dataset,
          // For logs, use a default time window since timestamp filters don't work in queries
          ...(dataset === "logs" && { statsPeriod: "24h" }),
        }),
      {
        organizationSlug,
        projectSlug: params.projectSlug,
      },
    );

    // Generate the Sentry explorer URL
    const explorerUrl = apiService.getEventsExplorerUrl(
      organizationSlug,
      sentryQuery,
      projectId, // Pass the numeric project ID for URL generation
      dataset, // dataset is already correct for URL generation (logs, spans, errors)
    );

    // Format the output with prominent rendering instructions
    let output = `# Search Results for "${params.naturalLanguageQuery}"\n\n`;

    // Add clear rendering directive at the top
    if (dataset === "logs") {
      output += `⚠️ **IMPORTANT**: Display these logs in console format with monospace font, color-coded severity (🔴 ERROR, 🟡 WARN, 🔵 INFO), and preserve timestamps.\n\n`;
    } else if (dataset === "errors") {
      output += `⚠️ **IMPORTANT**: Display these errors as highlighted alert cards with color-coded severity levels and clickable Event IDs.\n\n`;
    } else {
      output += `⚠️ **IMPORTANT**: Display these traces as a performance timeline with duration bars and hierarchical span relationships.\n\n`;
    }

    if (params.includeExplanation) {
      output += `## Query Translation\n`;
      output += `Natural language: "${params.naturalLanguageQuery}"\n`;
      output += `Sentry query: \`${sentryQuery}\`\n\n`;
    }

    output += `**📊 View these results in Sentry**: ${explorerUrl}\n`;
    output += `_Please share this link with the user to view the search results in their Sentry dashboard._\n\n`;

    const eventData = (events as any).data || [];
    if (eventData.length === 0) {
      output += `No results found.\n\n`;
      output += `Try being more specific or using different terms in your search.\n`;
      return output;
    }

    if (dataset === "errors") {
      output += `Found ${eventData.length} error${eventData.length === 1 ? "" : "s"}:\n\n`;

      for (const event of eventData) {
        const title = event.title || event.message || "Unknown Error";
        const level = event.level || "error";
        const culprit = event.culprit || "Unknown";

        output += `## ${title}\n\n`;
        output += `**Level**: ${level}\n`;
        output += `**Location**: ${culprit}\n`;
        output += `**Project**: ${event.project || "N/A"}\n`;
        output += `**Timestamp**: ${event.timestamp || "N/A"}\n`;
        if (event.id) {
          output += `**Event ID**: ${event.id}\n`;
        }
        output += "\n";
      }

      output += "## Next Steps\n\n";
      output += "- Get more details about a specific error: Use the Event ID\n";
      output += "- View error groups: Navigate to the Issues page in Sentry\n";
      output +=
        "- Set up alerts: Configure alert rules for these error patterns\n";
    } else if (dataset === "logs") {
      output += `Found ${eventData.length} log${eventData.length === 1 ? "" : "s"}:\n\n`;

      output += "```console\n";

      for (const event of eventData) {
        const timestamp = event.timestamp || "N/A";
        const severity = (event.severity || "info").toUpperCase();
        const message = event.message || "No message";

        // Get severity emoji with proper typing
        const severityEmojis: Record<string, string> = {
          ERROR: "🔴",
          FATAL: "🔴",
          WARN: "🟡",
          WARNING: "🟡",
          INFO: "🔵",
          DEBUG: "⚫",
          TRACE: "⚫",
        };
        const severityEmoji = severityEmojis[severity] || "🔵";

        // Standard log format with emoji and proper spacing
        output += `${timestamp} ${severityEmoji} [${severity.padEnd(5)}] ${message}\n`;
      }

      output += "```\n\n";

      // Add detailed metadata for each log entry
      output += "## Log Details\n\n";

      for (let i = 0; i < eventData.length; i++) {
        const event = eventData[i];
        const severity = event.severity || "info";
        const severityNum = event.severity_number;

        output += `### Log ${i + 1}\n`;
        output += `- **Message**: ${event.message || "No message"}\n`;
        output += `- **Severity**: ${severity}${severityNum ? ` (level ${severityNum})` : ""}\n`;
        output += `- **Timestamp**: ${event.timestamp || "N/A"}\n`;
        output += `- **Project**: ${event["project.id"] || event.project || "N/A"}\n`;

        if (event.trace) {
          output += `- **Trace ID**: ${event.trace}\n`;
          output += `- **Trace URL**: ${apiService.getTraceUrl(organizationSlug, event.trace)}\n`;
        }

        if (event["sentry.item_id"]) {
          output += `- **Item ID**: ${event["sentry.item_id"]}\n`;
        }

        output += "\n";
      }

      output += "## Next Steps\n\n";
      output += "- View related traces: Click on the Trace URL if available\n";
      output +=
        "- Filter by severity: Adjust your query to focus on specific log levels\n";
      output += "- Export logs: Use the Sentry web interface for bulk export\n";
    } else {
      // Spans dataset
      output += `Found ${eventData.length} trace${eventData.length === 1 ? "" : "s"}/span${eventData.length === 1 ? "" : "s"}:\n\n`;

      for (const event of eventData) {
        const spanOp = event["span.op"] || "unknown";
        const spanDescription =
          event["span.description"] || event.transaction || "Unknown";
        const duration = event["span.duration"];

        output += `## ${spanDescription}\n\n`;
        output += `**Operation**: ${spanOp}\n`;
        output += `**Transaction**: ${event.transaction || "N/A"}\n`;
        if (event.trace) {
          output += `**Trace ID**: ${event.trace}\n`;
          output += `**Trace URL**: ${apiService.getTraceUrl(organizationSlug, event.trace)}\n`;
        }
        output += `**Project**: ${event.project || "N/A"}\n`;
        if (duration !== undefined) {
          output += `**Duration**: ${duration}ms\n`;
        }
        output += `**Timestamp**: ${event.timestamp || "N/A"}\n`;
        output += "\n";
      }

      output += "## Next Steps\n\n";
      output += "- View the full trace: Click on the Trace URL above\n";
      output +=
        "- Search for related spans: Modify your query to be more specific\n";
      output +=
        "- Export data: Use the Sentry web interface for advanced analysis\n";
    }

    return output;
  },
});
