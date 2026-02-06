import type { SentryApiService } from "../../api-client";
import { logInfo } from "../../telem/logging";
import {
  type FlexibleEventData,
  formatEventValue,
  getStringValue,
  isAggregateQuery,
} from "./utils";

/**
 * Format an explanation for how a natural language query was translated
 */
export function formatExplanation(explanation: string): string {
  return `## How I interpreted your query\n\n${explanation}`;
}

/**
 * Common parameters for event formatters
 */
export interface FormatEventResultsParams {
  eventData: FlexibleEventData[];
  naturalLanguageQuery: string;
  includeExplanation?: boolean;
  apiService: SentryApiService;
  organizationSlug: string;
  explorerUrl: string;
  sentryQuery: string;
  fields: string[];
  explanation?: string;
}

/**
 * Format error event results for display
 */
export function formatErrorResults(params: FormatEventResultsParams): string {
  const {
    eventData,
    naturalLanguageQuery,
    includeExplanation,
    apiService,
    organizationSlug,
    explorerUrl,
    sentryQuery,
    fields,
    explanation,
  } = params;

  let output = `# Search Results for "${naturalLanguageQuery}"\n\n`;

  // Check if this is an aggregate query and adjust display instructions
  if (isAggregateQuery(fields)) {
    output += `⚠️ **IMPORTANT**: Display these aggregate results as a data table with proper column alignment and formatting.\n\n`;
  } else {
    output += `⚠️ **IMPORTANT**: Display these errors as highlighted alert cards with color-coded severity levels and clickable Event IDs.\n\n`;
  }

  if (includeExplanation && explanation) {
    output += formatExplanation(explanation);
    output += `\n\n`;
  }

  output += `**View these results in Sentry**:\n${explorerUrl}\n`;
  output += `_Please share this link with the user to view the search results in their Sentry dashboard._\n\n`;

  if (eventData.length === 0) {
    logInfo(`No error events found for query: ${naturalLanguageQuery}`, {
      extra: {
        query: sentryQuery,
        fields: fields,
        organizationSlug: organizationSlug,
        dataset: "errors",
      },
    });
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
          } else if (field === "issue") {
            output += `**Issue ID**: ${formatEventValue(value)}\n`;
          } else {
            output += `**${field}**: ${formatEventValue(value)}\n`;
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
          output += `**${key}**: ${formatEventValue(value)}\n`;
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
export function formatLogResults(params: FormatEventResultsParams): string {
  const {
    eventData,
    naturalLanguageQuery,
    includeExplanation,
    apiService,
    organizationSlug,
    explorerUrl,
    sentryQuery,
    fields,
    explanation,
  } = params;

  let output = `# Search Results for "${naturalLanguageQuery}"\n\n`;

  // Check if this is an aggregate query and adjust display instructions
  if (isAggregateQuery(fields)) {
    output += `⚠️ **IMPORTANT**: Display these aggregate results as a data table with proper column alignment and formatting.\n\n`;
  } else {
    output += `⚠️ **IMPORTANT**: Display these logs in console format with monospace font, color-coded severity (🔴 ERROR, 🟡 WARN, 🔵 INFO), and preserve timestamps.\n\n`;
  }

  if (includeExplanation && explanation) {
    output += formatExplanation(explanation);
    output += `\n\n`;
  }

  output += `**View these results in Sentry**:\n${explorerUrl}\n`;
  output += `_Please share this link with the user to view the search results in their Sentry dashboard._\n\n`;

  if (eventData.length === 0) {
    logInfo(`No log events found for query: ${naturalLanguageQuery}`, {
      extra: {
        query: sentryQuery,
        fields: fields,
        organizationSlug: organizationSlug,
        dataset: "logs",
      },
    });
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
            output += `- **${field}**: ${formatEventValue(value)}\n`;
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
          output += `- **${key}**: ${formatEventValue(value)}\n`;
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
export function formatSpanResults(params: FormatEventResultsParams): string {
  const {
    eventData,
    naturalLanguageQuery,
    includeExplanation,
    apiService,
    organizationSlug,
    explorerUrl,
    sentryQuery,
    fields,
    explanation,
  } = params;

  let output = `# Search Results for "${naturalLanguageQuery}"\n\n`;

  // Check if this is an aggregate query and adjust display instructions
  if (isAggregateQuery(fields)) {
    output += `⚠️ **IMPORTANT**: Display these aggregate results as a data table with proper column alignment and formatting.\n\n`;
  } else {
    output += `⚠️ **IMPORTANT**: Display these traces as a performance timeline with duration bars and hierarchical span relationships.\n\n`;
  }

  if (includeExplanation && explanation) {
    output += formatExplanation(explanation);
    output += `\n\n`;
  }

  output += `**View these results in Sentry**:\n${explorerUrl}\n`;
  output += `_Please share this link with the user to view the search results in their Sentry dashboard._\n\n`;

  if (eventData.length === 0) {
    logInfo(`No span events found for query: ${naturalLanguageQuery}`, {
      extra: {
        query: sentryQuery,
        fields: fields,
        organizationSlug: organizationSlug,
        dataset: "spans",
      },
    });
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
      "id",
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
            output += `**${field}**: ${formatEventValue(value)}\n`;
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
          output += `**${key}**: ${formatEventValue(value)}\n`;
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
