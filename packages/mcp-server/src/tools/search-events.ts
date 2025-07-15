import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "./utils/defineTool";
import { apiServiceFromContext, withApiErrorHandling } from "./utils/api-utils";
import type { ServerContext } from "../types";
import type { SentryApiService } from "../api-client";
import {
  ParamOrganizationSlug,
  ParamRegionUrl,
  ParamProjectSlug,
} from "../schema";
import { ProjectSchema } from "../api-client/schema";
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { logError } from "../logging";
import { ConfigurationError } from "../errors";

// Type for flexible event data that can contain any fields
type FlexibleEventData = Record<string, unknown>;

// Helper to safely get a string value from event data
function getStringValue(
  event: FlexibleEventData,
  key: string,
  defaultValue = "",
): string {
  const value = event[key];
  return typeof value === "string" ? value : defaultValue;
}

// Helper to safely get a number value from event data
function getNumberValue(
  event: FlexibleEventData,
  key: string,
): number | undefined {
  const value = event[key];
  return typeof value === "number" ? value : undefined;
}

// Helper to check if fields contain aggregate functions
function isAggregateQuery(fields: string[]): boolean {
  return fields.some((field) => field.includes("(") && field.includes(")"));
}

// Helper function to fetch custom attributes for a dataset
async function fetchCustomAttributes(
  apiService: SentryApiService,
  organizationSlug: string,
  dataset: "errors" | "logs" | "spans",
): Promise<Record<string, string>> {
  const customAttributes: Record<string, string> = {};

  try {
    if (dataset === "errors") {
      // TODO: For errors dataset, we currently need to use the old listTags API
      // This will be updated in the future to use the new trace-items attributes API
      const tagsResponse = await apiService.listTags({
        organizationSlug,
      });

      for (const tag of tagsResponse) {
        if (tag.key && !tag.key.startsWith("sentry:")) {
          customAttributes[tag.key] = tag.name || tag.key;
        }
      }
    } else {
      // For logs and spans datasets, use the trace-items attributes endpoint
      const itemType = dataset === "logs" ? "logs" : "spans";
      const attributesResponse = await apiService.listTraceItemAttributes({
        organizationSlug,
        itemType,
      });

      for (const attr of attributesResponse) {
        if (attr.key) {
          customAttributes[attr.key] = attr.name || attr.key;
        }
      }
    }
  } catch (error) {
    // If we can't get custom attributes, continue with just common fields
    logError(error, {
      search_events: {
        dataset,
        organizationSlug,
        operation:
          dataset === "errors" ? "listTags" : "listTraceItemAttributes",
        ...(dataset !== "errors" && {
          itemType: dataset === "logs" ? "logs" : "spans",
        }),
      },
    });
  }

  return customAttributes;
}

// Base fields common to all datasets
const BASE_COMMON_FIELDS = {
  project: "Project slug",
  timestamp: "When the event occurred",
  environment: "Environment (production, staging, development)",
  release: "Release version",
  platform: "Platform (javascript, python, etc.)",
  "user.id": "User ID",
  "user.email": "User email",
  "sdk.name": "SDK name",
  "sdk.version": "SDK version",
};

// Dataset-specific field definitions
const DATASET_FIELDS = {
  spans: {
    // Span-specific fields
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

    // Aggregate functions (SPANS dataset only - require numeric fields except count/count_unique)
    "count()": "Count of spans",
    "count_unique(field)": "Count of unique values, e.g. count_unique(user.id)",
    "avg(field)": "Average of numeric field, e.g. avg(span.duration)",
    "sum(field)": "Sum of numeric field, e.g. sum(span.self_time)",
    "min(field)": "Minimum of numeric field, e.g. min(span.duration)",
    "max(field)": "Maximum of numeric field, e.g. max(span.duration)",
    "p50(field)": "50th percentile (median), e.g. p50(span.duration)",
    "p75(field)": "75th percentile, e.g. p75(span.duration)",
    "p90(field)": "90th percentile, e.g. p90(span.duration)",
    "p95(field)": "95th percentile, e.g. p95(span.duration)",
    "p99(field)": "99th percentile, e.g. p99(span.duration)",
    "p100(field)": "100th percentile (max), e.g. p100(span.duration)",
    "epm()": "Events per minute rate",
    "failure_rate()": "Percentage of failed spans",
  },
  errors: {
    // Error-specific fields
    message: "Error message",
    level: "Error level (error, warning, info, debug)",
    "error.type": "Error type/exception class",
    "error.value": "Error value/description",
    "error.handled": "Whether the error was handled (true/false)",
    culprit: "Code location that caused the error",
    title: "Error title/grouping",

    // Stack trace fields
    "stack.filename": "File where error occurred",
    "stack.function": "Function where error occurred",
    "stack.module": "Module where error occurred",
    "stack.abs_path": "Absolute path to file",

    // Additional context fields
    "os.name": "Operating system name",
    "browser.name": "Browser name",
    "device.family": "Device family",

    // Aggregate functions (ERRORS dataset only)
    "count()": "Count of error events",
    "count_unique(field)": "Count of unique values, e.g. count_unique(user.id)",
    "count_if(field,equals,value)":
      "Conditional count, e.g. count_if(error.handled,equals,false)",
    "last_seen()": "Most recent timestamp of the group",
    "eps()": "Events per second rate",
    "epm()": "Events per minute rate",
  },
  logs: {
    // Log-specific fields
    message: "Log message",
    severity: "Log severity level",
    severity_number: "Numeric severity level",
    "sentry.item_id": "Sentry item ID",
    "sentry.observed_timestamp_nanos": "Observed timestamp in nanoseconds",

    // Trace context
    trace: "Trace ID",

    // Aggregate functions (LOGS dataset only - require numeric fields except count/count_unique)
    "count()": "Count of log entries",
    "count_unique(field)": "Count of unique values, e.g. count_unique(user.id)",
    "avg(field)": "Average of numeric field, e.g. avg(severity_number)",
    "sum(field)": "Sum of numeric field",
    "min(field)": "Minimum of numeric field",
    "max(field)": "Maximum of numeric field",
    "p50(field)": "50th percentile (median)",
    "p75(field)": "75th percentile",
    "p90(field)": "90th percentile",
    "p95(field)": "95th percentile",
    "p99(field)": "99th percentile",
    "p100(field)": "100th percentile (max)",
    "epm()": "Events per minute rate",
  },
};

// Dataset-specific rules and examples
const DATASET_CONFIGS = {
  errors: {
    rules: `- For errors, focus on: message, level, error.type, error.handled
- Use level field for severity (error, warning, info, debug)
- Use error.handled:false for unhandled exceptions/crashes
- For filename searches: Use stack.filename for suffix-based search (e.g., stack.filename:"**/index.js" or stack.filename:"**/components/Button.tsx")
- When searching for errors in specific files, prefer including the parent folder to avoid ambiguity (e.g., stack.filename:"**/components/index.js" instead of just stack.filename:"**/index.js")`,
    examples: `- "null pointer exceptions" → 
  {
    "query": "error.type:\\"NullPointerException\\" OR message:\\"*null pointer*\\"",
    "fields": ["issue", "title", "project", "timestamp", "level", "message", "error.type", "culprit"],
    "sort": "-timestamp"
  }
- "unhandled errors in production" → 
  {
    "query": "error.handled:false AND environment:production",
    "fields": ["issue", "title", "project", "timestamp", "level", "message", "error.type", "culprit", "error.handled", "environment"],
    "sort": "-timestamp"
  }
- "database connection errors" → 
  {
    "query": "message:\\"*database*\\" AND message:\\"*connection*\\" AND level:error",
    "fields": ["issue", "title", "project", "timestamp", "level", "message", "error.type", "culprit"],
    "sort": "-timestamp"
  }
- "show me user emails for authentication failures" → 
  {
    "query": "message:\\"*auth*\\" AND (message:\\"*failed*\\" OR message:\\"*denied*\\")",
    "fields": ["issue", "title", "project", "timestamp", "level", "message", "error.type", "culprit", "user.email"],
    "sort": "-timestamp"
  }
- "errors in Button.tsx file" → 
  {
    "query": "stack.filename:\\"**/Button.tsx\\"",
    "fields": ["issue", "title", "project", "timestamp", "level", "message", "error.type", "culprit", "stack.filename"],
    "sort": "-timestamp"
  }
- "count errors by type in production" → 
  {
    "query": "environment:production",
    "fields": ["error.type", "count()", "last_seen()"],
    "sort": "-count()"
  }
- "most common errors last 24h" → 
  {
    "query": "level:error",
    "fields": ["title", "error.type", "count()"],
    "sort": "-count()"
  }
- "unhandled errors rate by project" → 
  {
    "query": "",
    "fields": ["project", "count()", "count_if(error.handled,equals,false)", "epm()"],
    "sort": "-count()"
  }
- "unique users affected by errors" → 
  {
    "query": "level:error",
    "fields": ["error.type", "count()", "count_unique(user.id)"],
    "sort": "-count_unique(user.id)"
  }
- "what is the most common error" → 
  {
    "query": "",
    "fields": ["title", "count()"],
    "sort": "-count()"
  }`,
  },
  logs: {
    rules: `- For logs, focus on: message, severity, severity_number
- Use severity field for log levels (fatal, error, warning, info, debug, trace)
- severity_number is numeric (21=fatal, 17=error, 13=warning, 9=info, 5=debug, 1=trace)
- IMPORTANT: For time-based filtering in logs, do NOT use timestamp filters in the query
- Instead, time filtering for logs is handled by the statsPeriod parameter (not part of the query string)
- Keep your query focused on message content, severity levels, and other attributes only
- When user asks for "error logs", interpret this as logs with severity:error`,
    examples: `- "warning logs about memory" → 
  {
    "query": "severity:warning AND message:\\"*memory*\\"",
    "fields": ["timestamp", "project", "message", "severity", "trace"],
    "sort": "-timestamp"
  }
- "error logs from database" → 
  {
    "query": "severity:error AND message:\\"*database*\\"",
    "fields": ["timestamp", "project", "message", "severity", "trace"],
    "sort": "-timestamp"
  }
- "show me error logs with user context" → 
  {
    "query": "severity:error",
    "fields": ["timestamp", "project", "message", "severity", "trace", "user.id", "user.email"],
    "sort": "-timestamp"
  }
- "what is the most common log" → 
  {
    "query": "",
    "fields": ["message", "count()"],
    "sort": "-count()"
  }
- "most common error logs" → 
  {
    "query": "severity:error",
    "fields": ["message", "count()"],
    "sort": "-count()"
  }
- "count logs by severity" → 
  {
    "query": "",
    "fields": ["severity", "count()"],
    "sort": "-count()"
  }
- "log volume by project" → 
  {
    "query": "",
    "fields": ["project", "count()", "epm()"],
    "sort": "-count()"
  }`,
  },
  spans: {
    rules: `- For traces/spans, focus on: span.op, span.description, span.duration, transaction
- Use is_transaction:true for transaction spans only
- Use span.duration for performance queries (value is in milliseconds)`,
    examples: `- "database queries" → 
  {
    "query": "span.op:db OR span.op:db.query",
    "fields": ["span.op", "span.description", "span.duration", "transaction", "timestamp", "project", "trace"],
    "sort": "-span.duration"
  }
- "slow API calls over 5 seconds" → 
  {
    "query": "span.duration:>5000 AND span.op:http*",
    "fields": ["span.op", "span.description", "span.duration", "transaction", "timestamp", "project", "trace", "http.method", "http.status_code"],
    "sort": "-span.duration"
  }
- "show me database queries with their SQL" → 
  {
    "query": "span.op:db.query",
    "fields": ["span.op", "span.description", "span.duration", "transaction", "timestamp", "project", "trace", "db.system", "db.operation"],
    "sort": "-span.duration"
  }
- "average response time by endpoint" → 
  {
    "query": "is_transaction:true",
    "fields": ["transaction", "count()", "avg(span.duration)", "p95(span.duration)"],
    "sort": "-avg(span.duration)"
  }
- "slowest database queries by p95" → 
  {
    "query": "span.op:db*",
    "fields": ["span.description", "count()", "p50(span.duration)", "p95(span.duration)", "max(span.duration)"],
    "sort": "-p95(span.duration)"
  }
- "most common transaction" → 
  {
    "query": "is_transaction:true",
    "fields": ["transaction", "count()"],
    "sort": "-count()"
  }`,
  },
};

/**
 * Format error event results for display
 */
function formatErrorResults(
  eventData: FlexibleEventData[],
  params: { naturalLanguageQuery: string; includeExplanation?: boolean },
  apiService: SentryApiService,
  organizationSlug: string,
  explorerUrl: string,
  sentryQuery: string,
  fields: string[],
): string {
  let output = `# Search Results for "${params.naturalLanguageQuery}"\n\n`;

  // Check if this is an aggregate query and adjust display instructions
  if (isAggregateQuery(fields)) {
    output += `⚠️ **IMPORTANT**: Display these aggregate results as a data table with proper column alignment and formatting.\n\n`;
  } else {
    output += `⚠️ **IMPORTANT**: Display these errors as highlighted alert cards with color-coded severity levels and clickable Event IDs.\n\n`;
  }

  if (params.includeExplanation) {
    output += `## Query Translation\n`;
    output += `Natural language: "${params.naturalLanguageQuery}"\n`;
    output += `Sentry query: \`${sentryQuery}\`\n\n`;
  }

  output += `**📊 View these results in Sentry**: ${explorerUrl}\n`;
  output += `_Please share this link with the user to view the search results in their Sentry dashboard._\n\n`;

  if (eventData.length === 0) {
    output += `No results found.\n\n`;
    output += `Try being more specific or using different terms in your search.\n`;
    return output;
  }

  output += `Found ${eventData.length} ${isAggregateQuery(fields) ? "aggregate result" : "error"}${eventData.length === 1 ? "" : "s"}:\n\n`;

  // For aggregate queries, just output the raw data - the agent will format it as a table
  if (isAggregateQuery(fields)) {
    output += "```json\n";
    output += JSON.stringify(eventData, null, 2);
    output += "\n```\n\n";
  } else {
    // For individual errors, format with details
    // Define priority fields that should appear first if present
    const priorityFields = [
      "title",
      "issue",
      "project",
      "level",
      "error.type",
      "message",
      "culprit",
      "timestamp",
      "last_seen()", // Aggregate field - when the issue was last seen
      "count()", // Aggregate field - total occurrences of this issue
    ];

    for (const event of eventData) {
      // Try to get a title from various possible fields
      const title =
        getStringValue(event, "title") ||
        getStringValue(event, "message") ||
        getStringValue(event, "error.value") ||
        "Error Event";

      output += `## ${title}\n\n`;

      // Display priority fields first if they exist
      for (const field of priorityFields) {
        if (
          field in event &&
          event[field] !== null &&
          event[field] !== undefined
        ) {
          const value = event[field];

          if (field === "issue" && typeof value === "string") {
            output += `**Issue ID**: ${value}\n`;
            output += `**Issue URL**: ${apiService.getIssueUrl(organizationSlug, value)}\n`;
          } else {
            output += `**${field}**: ${value}\n`;
          }
        }
      }

      // Display any additional fields that weren't in the priority list
      const displayedFields = new Set([...priorityFields, "id"]);
      for (const [key, value] of Object.entries(event)) {
        if (
          !displayedFields.has(key) &&
          value !== null &&
          value !== undefined
        ) {
          output += `**${key}**: ${value}\n`;
        }
      }

      output += "\n";
    }
  }

  output += "## Next Steps\n\n";
  output += "- Get more details about a specific error: Use the Issue ID\n";
  output += "- View error groups: Navigate to the Issues page in Sentry\n";
  output += "- Set up alerts: Configure alert rules for these error patterns\n";

  return output;
}

/**
 * Format log event results for display
 */
function formatLogResults(
  eventData: FlexibleEventData[],
  params: { naturalLanguageQuery: string; includeExplanation?: boolean },
  apiService: SentryApiService,
  organizationSlug: string,
  explorerUrl: string,
  sentryQuery: string,
  fields: string[],
): string {
  let output = `# Search Results for "${params.naturalLanguageQuery}"\n\n`;

  // Check if this is an aggregate query and adjust display instructions
  if (isAggregateQuery(fields)) {
    output += `⚠️ **IMPORTANT**: Display these aggregate results as a data table with proper column alignment and formatting.\n\n`;
  } else {
    output += `⚠️ **IMPORTANT**: Display these logs in console format with monospace font, color-coded severity (🔴 ERROR, 🟡 WARN, 🔵 INFO), and preserve timestamps.\n\n`;
  }

  if (params.includeExplanation) {
    output += `## Query Translation\n`;
    output += `Natural language: "${params.naturalLanguageQuery}"\n`;
    output += `Sentry query: \`${sentryQuery}\`\n\n`;
  }

  output += `**📊 View these results in Sentry**: ${explorerUrl}\n`;
  output += `_Please share this link with the user to view the search results in their Sentry dashboard._\n\n`;

  if (eventData.length === 0) {
    output += `No results found.\n\n`;
    output += `Try being more specific or using different terms in your search.\n`;
    return output;
  }

  output += `Found ${eventData.length} ${isAggregateQuery(fields) ? "aggregate result" : "log"}${eventData.length === 1 ? "" : "s"}:\n\n`;

  // For aggregate queries, just output the raw data - the agent will format it as a table
  if (isAggregateQuery(fields)) {
    output += "```json\n";
    output += JSON.stringify(eventData, null, 2);
    output += "\n```\n\n";
  } else {
    // For individual logs, format as console output
    output += "```console\n";

    for (const event of eventData) {
      const timestamp = getStringValue(event, "timestamp", "N/A");
      const severity = getStringValue(event, "severity", "info");
      const message = getStringValue(event, "message", "No message");

      // Safely uppercase the severity
      const severityUpper = severity.toUpperCase();

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
      const severityEmoji = severityEmojis[severityUpper] || "🔵";

      // Standard log format with emoji and proper spacing
      output += `${timestamp} ${severityEmoji} [${severityUpper.padEnd(5)}] ${message}\n`;
    }

    output += "```\n\n";

    // Add detailed metadata for each log entry
    output += "## Log Details\n\n";

    // Define priority fields that should appear first if present
    const priorityFields = [
      "message",
      "severity",
      "severity_number",
      "timestamp",
      "project",
      "trace",
      "sentry.item_id",
    ];

    for (let i = 0; i < eventData.length; i++) {
      const event = eventData[i];

      output += `### Log ${i + 1}\n`;

      // Display priority fields first
      for (const field of priorityFields) {
        if (
          field in event &&
          event[field] !== null &&
          event[field] !== undefined
        ) {
          const value = event[field];

          if (field === "trace" && typeof value === "string") {
            output += `- **Trace ID**: ${value}\n`;
            output += `- **Trace URL**: ${apiService.getTraceUrl(organizationSlug, value)}\n`;
          } else {
            output += `- **${field}**: ${value}\n`;
          }
        }
      }

      // Display any additional fields
      const displayedFields = new Set([...priorityFields, "id"]);
      for (const [key, value] of Object.entries(event)) {
        if (
          !displayedFields.has(key) &&
          value !== null &&
          value !== undefined
        ) {
          output += `- **${key}**: ${value}\n`;
        }
      }

      output += "\n";
    }
  }

  output += "## Next Steps\n\n";
  output += "- View related traces: Click on the Trace URL if available\n";
  output +=
    "- Filter by severity: Adjust your query to focus on specific log levels\n";
  output += "- Export logs: Use the Sentry web interface for bulk export\n";

  return output;
}

/**
 * Format span/trace event results for display
 */
function formatSpanResults(
  eventData: FlexibleEventData[],
  params: { naturalLanguageQuery: string; includeExplanation?: boolean },
  apiService: SentryApiService,
  organizationSlug: string,
  explorerUrl: string,
  sentryQuery: string,
  fields: string[],
): string {
  let output = `# Search Results for "${params.naturalLanguageQuery}"\n\n`;

  // Check if this is an aggregate query and adjust display instructions
  if (isAggregateQuery(fields)) {
    output += `⚠️ **IMPORTANT**: Display these aggregate results as a data table with proper column alignment and formatting.\n\n`;
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

  if (eventData.length === 0) {
    output += `No results found.\n\n`;
    output += `Try being more specific or using different terms in your search.\n`;
    return output;
  }

  output += `Found ${eventData.length} ${isAggregateQuery(fields) ? `aggregate result${eventData.length === 1 ? "" : "s"}` : `trace${eventData.length === 1 ? "" : "s"}/span${eventData.length === 1 ? "" : "s"}`}:\n\n`;

  // For aggregate queries, just output the raw data - the agent will format it as a table
  if (isAggregateQuery(fields)) {
    output += "```json\n";
    output += JSON.stringify(eventData, null, 2);
    output += "\n```\n\n";
  } else {
    // For individual spans, format with details
    // Define priority fields that should appear first if present
    const priorityFields = [
      "span.op",
      "span.description",
      "transaction",
      "span.duration",
      "span.status",
      "trace",
      "project",
      "timestamp",
    ];

    for (const event of eventData) {
      // Try to get a title from various possible fields
      const title =
        getStringValue(event, "span.description") ||
        getStringValue(event, "transaction") ||
        getStringValue(event, "span.op") ||
        "Span";

      output += `## ${title}\n\n`;

      // Display priority fields first
      for (const field of priorityFields) {
        if (
          field in event &&
          event[field] !== null &&
          event[field] !== undefined
        ) {
          const value = event[field];

          if (field === "trace" && typeof value === "string") {
            output += `**Trace ID**: ${value}\n`;
            output += `**Trace URL**: ${apiService.getTraceUrl(organizationSlug, value)}\n`;
          } else if (field === "span.duration" && typeof value === "number") {
            output += `**${field}**: ${value}ms\n`;
          } else {
            output += `**${field}**: ${value}\n`;
          }
        }
      }

      // Display any additional fields
      const displayedFields = new Set([...priorityFields, "id"]);
      for (const [key, value] of Object.entries(event)) {
        if (
          !displayedFields.has(key) &&
          value !== null &&
          value !== undefined
        ) {
          output += `**${key}**: ${value}\n`;
        }
      }

      output += "\n";
    }
  }

  output += "## Next Steps\n\n";
  output += "- View the full trace: Click on the Trace URL above\n";
  output +=
    "- Search for related spans: Modify your query to be more specific\n";
  output +=
    "- Export data: Use the Sentry web interface for advanced analysis\n";

  return output;
}

// Define recommended fields for each dataset
const RECOMMENDED_FIELDS = {
  errors: {
    basic: [
      "issue",
      "title",
      "project",
      "timestamp",
      "level",
      "message",
      "error.type",
      "culprit",
    ],
    description:
      "Basic error information including issue ID, title, timestamp, severity, and location",
  },
  logs: {
    basic: ["timestamp", "project", "message", "severity", "trace"],
    description: "Essential log entry information",
  },
  spans: {
    basic: [
      "span.op",
      "span.description",
      "span.duration",
      "transaction",
      "timestamp",
      "project",
      "trace",
    ],
    description:
      "Core span/trace information including operation, duration, and trace context",
  },
};

/**
 * Build the system prompt for AI query translation
 */
function buildSystemPrompt(
  dataset: "spans" | "errors" | "logs",
  allFields: Record<string, string>,
  datasetConfig: { rules: string; examples: string },
): string {
  const recommendedFields = RECOMMENDED_FIELDS[dataset];

  // Define aggregate functions for each dataset
  const aggregateFunctions = {
    errors: `ERRORS dataset aggregate functions:
- count(): Count of error events
- count_unique(field): Count unique values (e.g., count_unique(user.id))
- count_if(field,equals,value): Conditional count (e.g., count_if(error.handled,equals,false))
- last_seen(): Most recent timestamp in the group
- eps(): Events per second rate
- epm(): Events per minute rate`,
    spans: `SPANS dataset aggregate functions:
- count(): Count of spans
- count_unique(field): Count unique values (e.g., count_unique(user.id))
- avg(field): Average of numeric field (e.g., avg(span.duration))
- sum(field): Sum of numeric field (e.g., sum(span.self_time))
- min(field): Minimum value (e.g., min(span.duration))
- max(field): Maximum value (e.g., max(span.duration))
- p50(field), p75(field), p90(field), p95(field), p99(field), p100(field): Percentiles
- epm(): Events per minute rate
- failure_rate(): Percentage of failed spans`,
    logs: `LOGS dataset aggregate functions:
- count(): Count of log entries
- count_unique(field): Count unique values (e.g., count_unique(user.id))
- avg(field): Average of numeric field (e.g., avg(severity_number))
- sum(field): Sum of numeric field
- min(field): Minimum value
- max(field): Maximum value
- p50(field), p75(field), p90(field), p95(field), p99(field), p100(field): Percentiles
- epm(): Events per minute rate`,
  };

  return SYSTEM_PROMPT_TEMPLATE.replace("{dataset}", dataset)
    .replace(
      "{recommendedFields}",
      `${recommendedFields.basic.map((f) => `- ${f}`).join("\n")}\n\n${recommendedFields.description}`,
    )
    .replace(
      "{fields}",
      Object.entries(allFields)
        .map(([key, desc]) => `- ${key}: ${desc}`)
        .join("\n"),
    )
    .replace("{aggregateFunctions}", aggregateFunctions[dataset])
    .replace("{datasetRules}", datasetConfig.rules)
    .replace("{datasetExamples}", datasetConfig.examples);
}

// Base system prompt template
const SYSTEM_PROMPT_TEMPLATE = `You are a Sentry query translator. You need to:
1. Convert the natural language query to Sentry's search syntax (the WHERE conditions)
2. Decide which fields to return in the results (the SELECT fields)
3. Understand when to use aggregate functions vs individual events

For the {dataset} dataset:

RECOMMENDED FIELDS TO RETURN:
{recommendedFields}

ALL AVAILABLE FIELDS:
{fields}

AGGREGATE FUNCTIONS BY DATASET:
{aggregateFunctions}

QUERY MODES:
1. INDIVIDUAL EVENTS (default): Returns raw event data
   - Used when fields contain no function() calls
   - Returns actual event occurrences with full details

2. AGGREGATE QUERIES: SQL-like grouping and aggregation
   - Activated when ANY field contains a function() call
   - Automatically groups by ALL non-function fields in the field list
   - Example: fields=['project', 'error.type', 'count()'] groups by project and error.type

QUERY SYNTAX RULES:
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

EXAMPLES:
{datasetExamples}

SORTING RULES (CRITICAL - YOU MUST ALWAYS SPECIFY A SORT):
1. DEFAULT SORTING:
   - errors dataset: Use "-timestamp" (newest first)
   - spans dataset: Use "-span.duration" (slowest first)  
   - logs dataset: Use "-timestamp" (newest first)

2. SORTING SYNTAX:
   - Use "-" prefix for descending order (e.g., "-timestamp" for newest first)
   - Use field name without prefix for ascending order (e.g., "timestamp" for oldest first)
   - For individual event queries: sort by any field in the dataset
   - For aggregate queries: sort by aggregate function results (e.g., "-count()" for highest count first)

3. AGGREGATE QUERY SORTING:
   - When using aggregate functions, sort by the function result
   - Examples: "-count()" for highest count, "-avg(span.duration)" for slowest average
   - Common patterns: "-count()", "-sum(field)", "-avg(field)", "-max(field)"

4. IMPORTANT SORTING REQUIREMENTS:
   - YOU MUST ALWAYS INCLUDE A SORT PARAMETER
   - CRITICAL: The field you sort by MUST be included in your fields array
   - If sorting by "-timestamp", include "timestamp" in fields
   - If sorting by "-count()", include "count()" in fields
   - If sorting by "-span.duration", include "span.duration" in fields
   - If user asks for "most common", use "-count()"
   - If user asks for "slowest", use "-span.duration" or "-avg(span.duration)"
   - If user asks for "latest" or "recent", use "-timestamp"
   - If unsure, use the default sort for the dataset

YOUR RESPONSE FORMAT:
Return a JSON object with these fields:
- "query": The Sentry query string for filtering results (use empty string "" for no filters)
- "fields": Array of field names to return in results (OPTIONAL - will use defaults if not provided)
- "sort": Sort parameter for results (REQUIRED - YOU MUST ALWAYS SPECIFY THIS)
- "isAggregate": Boolean indicating if this is an aggregate query (REQUIRED)
- "aggregateFunctions": Array of aggregate function fields like ["count()", "avg(span.duration)"] (REQUIRED if isAggregate=true, empty array otherwise)
- "groupByField": The field to group by, or null if no grouping (REQUIRED if isAggregate=true and there's a non-function field)
- "error": Error message if you cannot translate the query (OPTIONAL)

ERROR HANDLING:
- If the user's query is impossible to translate to Sentry syntax, set "error" field with explanation
- If the query asks for fields that don't exist in the dataset, set "error" field
- If the query is ambiguous or unclear, set "error" field with clarification needed

IMPORTANT NOTES:
- Always include the recommended fields unless the user specifically asks for different fields
- Add any fields mentioned in the user's query to the fields array
- If the user asks about a specific field (e.g., "show me user emails"), include that field
- CRITICAL: The field you're sorting by MUST be included in your fields array (e.g., if sort is "-timestamp", fields must include "timestamp")
- Do NOT include project: filters in your query (project filtering is handled separately)
- For spans/errors: When user mentions time periods, include timestamp filters in query
- For logs: When user mentions time periods, do NOT include timestamp filters - handled automatically
- AGGREGATE FUNCTION RULES:
  - Numeric functions (avg, sum, min, max, percentiles) ONLY work with numeric fields
  - count() and count_unique() work with any field type
  - When using aggregate functions, results are grouped by non-function fields
  - Dataset-specific functions must only be used with their respective datasets

AGGREGATE QUERY RESPONSE STRUCTURE:
When creating an aggregate query:
1. Set isAggregate to true
2. List all aggregate functions in aggregateFunctions array (e.g., ["count()", "avg(span.duration)"])
3. Set groupByField to the single field you're grouping by (or null if just aggregating without grouping)
4. Include all fields (both aggregate functions and groupBy field) in the fields array

Examples:
- "count of errors by type": isAggregate=true, aggregateFunctions=["count()"], groupByField="error.type", fields=["error.type", "count()"]
- "average span duration": isAggregate=true, aggregateFunctions=["avg(span.duration)"], groupByField=null, fields=["avg(span.duration)"]
- "most common transaction": isAggregate=true, aggregateFunctions=["count()"], groupByField="span.description", fields=["span.description", "count()"], sort="-count()"`;

export default defineTool({
  name: "search_events",
  description: [
    "Search for error events, log entries, or trace spans. Supports both individual event queries and SQL-like aggregations.",
    "",
    "Automatically uses natural language to search across Sentry data, returning either:",
    "- Individual events with full details (default)",
    "- Aggregated results when using functions like count(), avg(), sum(), etc.",
    "",
    "Datasets:",
    "- errors: Exception/crash events",
    "- logs: Log entries (use for 'error logs')",
    "- spans: Performance/trace data",
    "",
    "❌ DO NOT USE for 'issues' or 'problems' (use find_issues instead)",
    "",
    "<examples>",
    "search_events(organizationSlug='my-org', naturalLanguageQuery='database errors in the last hour', dataset='errors')",
    "search_events(organizationSlug='my-org', naturalLanguageQuery='count of errors by type', dataset='errors')",
    "search_events(organizationSlug='my-org', naturalLanguageQuery='slowest API calls', dataset='spans')",
    "</examples>",
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

    // Use errors dataset by default if not specified
    const dataset = params.dataset || "errors";

    // Get the dataset-specific fields
    const datasetSpecificFields = DATASET_FIELDS[dataset];

    // Fetch custom attributes based on dataset
    const customAttributes = await fetchCustomAttributes(
      apiService,
      organizationSlug,
      dataset,
    );

    // Combine base fields, dataset-specific fields, and custom attributes
    const allFields = {
      ...BASE_COMMON_FIELDS,
      ...datasetSpecificFields,
      ...customAttributes,
    };

    // Get dataset configuration
    const datasetConfig = DATASET_CONFIGS[dataset] || DATASET_CONFIGS.spans;

    // Build the system prompt
    const systemPrompt = buildSystemPrompt(dataset, allFields, datasetConfig);

    // Check if OpenAI API key is available
    if (!process.env.OPENAI_API_KEY) {
      throw new ConfigurationError(
        "OPENAI_API_KEY environment variable is required for semantic search",
      );
    }

    // Use the AI SDK to translate the query
    const { object: parsed } = await generateObject({
      model: openai("gpt-4o"),
      system: systemPrompt,
      prompt: params.naturalLanguageQuery,
      temperature: 0.1, // Low temperature for more consistent translations
      schema: z.object({
        query: z
          .string()
          .optional()
          .describe(
            "The Sentry query string for filtering results (empty string returns all recent events)",
          ),
        fields: z
          .array(z.string())
          .optional()
          .describe("Array of field names to return in results"),
        sort: z
          .string()
          .describe(
            "REQUIRED: Sort parameter for results (e.g., '-timestamp' for newest first, '-count()' for highest count first)",
          ),
        isAggregate: z
          .boolean()
          .describe(
            "Whether this is an aggregate query (true if using any aggregate functions)",
          ),
        aggregateFunctions: z
          .array(z.string())
          .optional()
          .default([])
          .describe(
            "Array of aggregate function fields (e.g., ['count()', 'avg(span.duration)'])",
          ),
        groupByField: z
          .string()
          .nullable()
          .optional()
          .describe(
            "The field to group by in aggregate queries (null if no grouping)",
          ),
        error: z
          .string()
          .optional()
          .describe("Error message if the query cannot be translated"),
      }),
      experimental_telemetry: {
        isEnabled: true,
        functionId: `search_events_${dataset}`,
      },
    });

    // Handle AI errors first
    if (parsed.error) {
      throw new Error(
        `AI could not translate query "${params.naturalLanguageQuery}" for ${dataset} dataset. Error: ${parsed.error}. AI response: ${JSON.stringify(parsed, null, 2)}`,
      );
    }

    // Validate that sort parameter was provided
    if (!parsed.sort) {
      throw new Error(
        `AI response missing required 'sort' parameter. Received: ${JSON.stringify(parsed, null, 2)}. The AI must specify how to sort results (e.g., '-timestamp' for newest first, '-count()' for highest count).`,
      );
    }

    // Use empty string as default if no query is provided
    // This allows fetching all recent events when no specific filter is needed
    const sentryQuery = parsed.query || "";
    const requestedFields = parsed.fields || [];

    // Use the AI-requested fields, or fall back to recommended fields
    const fields =
      requestedFields.length > 0
        ? requestedFields
        : RECOMMENDED_FIELDS[dataset].basic;

    // Use the AI-provided sort parameter
    const sortParam = parsed.sort;

    // Convert project slug to ID if needed - the search API requires numeric IDs
    let projectId: string | undefined;
    if (params.projectSlug) {
      // The project details endpoint accepts both slug and ID
      // We fetch the single project to get its numeric ID for the search API
      try {
        const project = await apiService.getProject({
          organizationSlug,
          projectSlugOrId: params.projectSlug,
        });
        projectId = String(project.id);
      } catch (error) {
        throw new Error(
          `Project '${params.projectSlug}' not found in organization '${organizationSlug}'`,
        );
      }
    }

    const eventsResponse = await withApiErrorHandling(
      () =>
        apiService.searchEvents({
          organizationSlug,
          query: sentryQuery,
          fields,
          limit: params.limit,
          projectSlug: projectId, // API requires numeric project ID, not slug
          dataset: dataset === "logs" ? "ourlogs" : dataset,
          sort: sortParam,
          // For logs and errors, use a default time window
          ...(dataset !== "spans" && { statsPeriod: "24h" }),
        }),
      {
        organizationSlug,
        projectSlug: params.projectSlug,
      },
    );

    // Generate the Sentry explorer URL with structured aggregate information
    const explorerUrl = apiService.getEventsExplorerUrl(
      organizationSlug,
      sentryQuery,
      projectId, // Pass the numeric project ID for URL generation
      dataset, // dataset is already correct for URL generation (logs, spans, errors)
      fields, // Pass fields to detect if it's an aggregate query
      sortParam, // Pass sort parameter for URL generation
      {
        isAggregate: parsed.isAggregate,
        aggregateFunctions: parsed.aggregateFunctions || [],
        groupByField: parsed.groupByField || null,
      },
    );

    // Type-safe access to event data
    // Since searchEvents returns unknown, we need to safely access the data property
    const responseData = eventsResponse as { data?: unknown[] };
    const eventData = (responseData.data || []) as FlexibleEventData[];

    // Format results based on dataset
    switch (dataset) {
      case "errors":
        return formatErrorResults(
          eventData,
          params,
          apiService,
          organizationSlug,
          explorerUrl,
          sentryQuery,
          fields,
        );
      case "logs":
        return formatLogResults(
          eventData,
          params,
          apiService,
          organizationSlug,
          explorerUrl,
          sentryQuery,
          fields,
        );
      case "spans":
        return formatSpanResults(
          eventData,
          params,
          apiService,
          organizationSlug,
          explorerUrl,
          sentryQuery,
          fields,
        );
    }
  },
});
