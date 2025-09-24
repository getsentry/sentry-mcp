/**
 * LLM response formatting utilities for Sentry data.
 *
 * Converts Sentry API responses into structured markdown format optimized
 * for LLM consumption. Handles stacktraces, event details, issue summaries,
 * and contextual information with consistent formatting patterns.
 */
import type { z } from "zod";
import type { Event, Issue, AutofixRunState } from "../api-client/types";
import type {
  ErrorEntrySchema,
  ErrorEventSchema,
  EventSchema,
  FrameInterface,
  RequestEntrySchema,
  MessageEntrySchema,
  ThreadsEntrySchema,
  SentryApiService,
  AutofixRunStepRootCauseAnalysisSchema,
} from "../api-client";
import {
  getOutputForAutofixStep,
  isTerminalStatus,
  getStatusDisplayName,
} from "./tool-helpers/seer";

// Language detection mappings
const LANGUAGE_EXTENSIONS: Record<string, string> = {
  ".java": "java",
  ".py": "python",
  ".js": "javascript",
  ".jsx": "javascript",
  ".ts": "javascript",
  ".tsx": "javascript",
  ".rb": "ruby",
  ".php": "php",
};

const LANGUAGE_MODULE_PATTERNS: Array<[RegExp, string]> = [
  [/^(java\.|com\.|org\.)/, "java"],
];

/**
 * Detects the programming language of a stack frame based on the file extension.
 * Falls back to the platform parameter if no filename is available or extension is unrecognized.
 *
 * @param frame - The stack frame containing file and location information
 * @param platform - Optional platform hint to use as fallback
 * @returns The detected language or platform fallback or "unknown"
 */
function detectLanguage(
  frame: z.infer<typeof FrameInterface>,
  platform?: string | null,
): string {
  // Check filename extensions
  if (frame.filename) {
    const ext = frame.filename.toLowerCase().match(/\.[^.]+$/)?.[0];
    if (ext && LANGUAGE_EXTENSIONS[ext]) {
      return LANGUAGE_EXTENSIONS[ext];
    }
  }

  // Check module patterns
  if (frame.module) {
    for (const [pattern, language] of LANGUAGE_MODULE_PATTERNS) {
      if (pattern.test(frame.module)) {
        return language;
      }
    }
  }

  // Fallback to platform or unknown
  return platform || "unknown";
}

/**
 * Formats a stack frame into a language-specific string representation.
 * Different languages have different conventions for displaying stack traces.
 *
 * @param frame - The stack frame to format
 * @param frameIndex - Optional frame index for languages that display frame numbers
 * @param platform - Optional platform hint for language detection fallback
 * @returns Formatted stack frame string
 */
export function formatFrameHeader(
  frame: z.infer<typeof FrameInterface>,
  frameIndex?: number,
  platform?: string | null,
) {
  const language = detectLanguage(frame, platform);

  switch (language) {
    case "java": {
      // at com.example.ClassName.methodName(FileName.java:123)
      const className = frame.module || "UnknownClass";
      const method = frame.function || "<unknown>";
      const source = frame.filename || "Unknown Source";
      const location = frame.lineNo ? `:${frame.lineNo}` : "";
      return `at ${className}.${method}(${source}${location})`;
    }

    case "python": {
      // File "/path/to/file.py", line 42, in function_name
      const file =
        frame.filename || frame.absPath || frame.module || "<unknown>";
      const func = frame.function || "<module>";
      const line = frame.lineNo ? `, line ${frame.lineNo}` : "";
      return `  File "${file}"${line}, in ${func}`;
    }

    case "javascript": {
      // Original compact format: filename:line:col (function)
      // This preserves backward compatibility
      return `${[frame.filename, frame.lineNo, frame.colNo]
        .filter((i) => !!i)
        .join(":")}${frame.function ? ` (${frame.function})` : ""}`;
    }

    case "ruby": {
      // from /path/to/file.rb:42:in `method_name'
      const file = frame.filename || frame.module || "<unknown>";
      const func = frame.function ? ` \`${frame.function}\`` : "";
      const line = frame.lineNo ? `:${frame.lineNo}:in` : "";
      return `    from ${file}${line}${func}`;
    }

    case "php": {
      // #0 /path/to/file.php(42): functionName()
      const file = frame.filename || "<unknown>";
      const line = frame.lineNo ? `(${frame.lineNo})` : "";
      const func = frame.function || "<unknown>";
      const prefix = frameIndex !== undefined ? `#${frameIndex} ` : "";
      return `${prefix}${file}${line}: ${func}()`;
    }

    default: {
      // Generic format for unknown languages
      const func = frame.function || "<unknown>";
      const location = frame.filename || frame.module || "<unknown>";
      const line = frame.lineNo ? `:${frame.lineNo}` : "";
      const col = frame.colNo != null ? `:${frame.colNo}` : "";
      return `    at ${func} (${location}${line}${col})`;
    }
  }
}

/**
 * Formats a Sentry event into a structured markdown output.
 * Includes error messages, stack traces, request info, and contextual data.
 *
 * @param event - The Sentry event to format
 * @returns Formatted markdown string
 */
export function formatEventOutput(event: Event) {
  let output = "";

  // Look for the primary error information
  const messageEntry = event.entries.find((e) => e.type === "message");
  const exceptionEntry = event.entries.find((e) => e.type === "exception");
  const threadsEntry = event.entries.find((e) => e.type === "threads");
  const requestEntry = event.entries.find((e) => e.type === "request");
  const spansEntry = event.entries.find((e) => e.type === "spans");

  // Error message (if present)
  if (messageEntry) {
    output += formatMessageInterfaceOutput(
      event,
      messageEntry.data as z.infer<typeof MessageEntrySchema>,
    );
  }

  // Stack trace (from exception or threads)
  if (exceptionEntry) {
    output += formatExceptionInterfaceOutput(
      event,
      exceptionEntry.data as z.infer<typeof ErrorEntrySchema>,
    );
  } else if (threadsEntry) {
    output += formatThreadsInterfaceOutput(
      event,
      threadsEntry.data as z.infer<typeof ThreadsEntrySchema>,
    );
  }

  // Request info (if HTTP error)
  if (requestEntry) {
    output += formatRequestInterfaceOutput(
      event,
      requestEntry.data as z.infer<typeof RequestEntrySchema>,
    );
  }

  // Performance issue details (N+1 queries, etc.)
  // Pass spans data for additional context even if we have evidence
  if (event.type === "transaction") {
    output += formatPerformanceIssueOutput(event, spansEntry?.data);
  }

  output += formatTags(event.tags);
  output += formatContexts(event.contexts);
  return output;
}

/**
 * Extracts the context line matching the frame's line number for inline display.
 * This is used in the full stacktrace view to show the actual line of code
 * that caused the error inline with the stack frame.
 *
 * @param frame - The stack frame containing context lines
 * @returns The line of code at the frame's line number, or empty string if not available
 */
function renderInlineContext(frame: z.infer<typeof FrameInterface>): string {
  if (!frame.context?.length || !frame.lineNo) {
    return "";
  }

  const contextLine = frame.context.find(([lineNo]) => lineNo === frame.lineNo);
  return contextLine ? `\n${contextLine[1]}` : "";
}

/**
 * Renders an enhanced view of a stack frame with context lines and variables.
 * Used for the "Most Relevant Frame" section to provide detailed information
 * about the most relevant application frame where the error occurred.
 *
 * @param frame - The stack frame to render with enhanced information
 * @param event - The Sentry event containing platform information for language detection
 * @returns Formatted string with frame header, context lines, and variables table
 */
function renderEnhancedFrame(
  frame: z.infer<typeof FrameInterface>,
  event: Event,
): string {
  const parts: string[] = [];

  parts.push("**Most Relevant Frame:**");
  parts.push("─────────────────────");
  parts.push(formatFrameHeader(frame, undefined, event.platform));

  // Add context lines if available
  if (frame.context?.length) {
    const contextLines = renderContextLines(frame);
    if (contextLines) {
      parts.push("");
      parts.push(contextLines);
    }
  }

  // Add variables table if available
  if (frame.vars && Object.keys(frame.vars).length > 0) {
    parts.push("");
    parts.push(renderVariablesTable(frame.vars));
  }

  return parts.join("\n");
}

function formatExceptionInterfaceOutput(
  event: Event,
  data: z.infer<typeof ErrorEntrySchema>,
) {
  const parts: string[] = [];

  // Handle both single exception (value) and chained exceptions (values)
  const exceptions = data.values || (data.value ? [data.value] : []);

  if (exceptions.length === 0) {
    return "";
  }

  // For chained exceptions, they are typically ordered from innermost to outermost
  // We'll render them in reverse order (outermost first) to match how they occurred
  const isChained = exceptions.length > 1;

  // Create a copy before reversing to avoid mutating the original array
  [...exceptions].reverse().forEach((exception, index) => {
    if (!exception) return;

    // Add language-specific chain indicator for multiple exceptions
    if (isChained && index > 0) {
      parts.push("");
      parts.push(
        getExceptionChainMessage(
          event.platform || null,
          index,
          exceptions.length,
        ),
      );
      parts.push("");
    }

    // Use the actual exception type and value as the heading
    const exceptionTitle = `${exception.type}${exception.value ? `: ${exception.value}` : ""}`;

    parts.push(index === 0 ? "### Error" : `### ${exceptionTitle}`);
    parts.push("");

    // Add the error details in a code block for the first exception
    // to maintain backward compatibility
    if (index === 0) {
      parts.push("```");
      parts.push(exceptionTitle);
      parts.push("```");
      parts.push("");
    }

    if (!exception.stacktrace || !exception.stacktrace.frames) {
      parts.push("**Stacktrace:**");
      parts.push("```");
      parts.push("No stacktrace available");
      parts.push("```");
      return;
    }

    const frames = exception.stacktrace.frames;

    // Only show enhanced frame for the first (outermost) exception to avoid overwhelming output
    if (index === 0) {
      const firstInAppFrame = findFirstInAppFrame(frames);
      if (
        firstInAppFrame &&
        (firstInAppFrame.context?.length || firstInAppFrame.vars)
      ) {
        parts.push(renderEnhancedFrame(firstInAppFrame, event));
        parts.push("");
        parts.push("**Full Stacktrace:**");
        parts.push("────────────────");
      } else {
        parts.push("**Stacktrace:**");
      }
    } else {
      parts.push("**Stacktrace:**");
    }

    parts.push("```");
    parts.push(
      frames
        .map((frame) => {
          const header = formatFrameHeader(frame, undefined, event.platform);
          const context = renderInlineContext(frame);
          return `${header}${context}`;
        })
        .join("\n"),
    );
    parts.push("```");
  });

  parts.push("");
  parts.push("");

  return parts.join("\n");
}

/**
 * Get the appropriate exception chain message based on the platform
 */
function getExceptionChainMessage(
  platform: string | null,
  index: number,
  totalExceptions: number,
): string {
  // Default message for unknown platforms
  const defaultMessage =
    "**During handling of the above exception, another exception occurred:**";

  if (!platform) {
    return defaultMessage;
  }

  switch (platform.toLowerCase()) {
    case "python":
      // Python has two distinct messages, but without additional metadata
      // we default to the implicit chaining message
      return "**During handling of the above exception, another exception occurred:**";

    case "java":
      return "**Caused by:**";

    case "csharp":
    case "dotnet":
      return "**---> Inner Exception:**";

    case "ruby":
      return "**Caused by:**";

    case "go":
      return "**Wrapped error:**";

    case "rust":
      return `**Caused by (${index}):**`;

    default:
      return defaultMessage;
  }
}

function formatRequestInterfaceOutput(
  event: Event,
  data: z.infer<typeof RequestEntrySchema>,
) {
  if (!data.method || !data.url) {
    return "";
  }
  return `### HTTP Request\n\n**Method:** ${data.method}\n**URL:** ${data.url}\n\n`;
}

function formatMessageInterfaceOutput(
  event: Event,
  data: z.infer<typeof MessageEntrySchema>,
) {
  if (!data.formatted && !data.message) {
    return "";
  }
  const message = data.formatted || data.message || "";
  return `### Error\n\n${"```"}\n${message}\n${"```"}\n\n`;
}

function formatThreadsInterfaceOutput(
  event: Event,
  data: z.infer<typeof ThreadsEntrySchema>,
) {
  if (!data.values || data.values.length === 0) {
    return "";
  }

  // Find the crashed thread only
  const crashedThread = data.values.find((t) => t.crashed);

  if (!crashedThread?.stacktrace?.frames) {
    return "";
  }

  const parts: string[] = [];

  // Include thread name if available
  if (crashedThread.name) {
    parts.push(`**Thread** (${crashedThread.name})`);
    parts.push("");
  }

  const frames = crashedThread.stacktrace.frames;

  // Find and format the first in-app frame with enhanced view
  const firstInAppFrame = findFirstInAppFrame(frames);
  if (
    firstInAppFrame &&
    (firstInAppFrame.context?.length || firstInAppFrame.vars)
  ) {
    parts.push(renderEnhancedFrame(firstInAppFrame, event));
    parts.push("");
    parts.push("**Full Stacktrace:**");
    parts.push("────────────────");
  } else {
    parts.push("**Stacktrace:**");
  }

  parts.push("```");
  parts.push(
    frames
      .map((frame) => {
        const header = formatFrameHeader(frame, undefined, event.platform);
        const context = renderInlineContext(frame);
        return `${header}${context}`;
      })
      .join("\n"),
  );
  parts.push("```");
  parts.push("");

  return parts.join("\n");
}

/**
 * Renders surrounding source code context for a stack frame.
 * Shows a window of code lines around the error line with visual indicators.
 *
 * @param frame - The stack frame containing context lines
 * @param contextSize - Number of lines to show before and after the error line (default: 3)
 * @returns Formatted context lines with line numbers and arrow indicator for the error line
 */
function renderContextLines(
  frame: z.infer<typeof FrameInterface>,
  contextSize = 3,
): string {
  if (!frame.context || frame.context.length === 0 || !frame.lineNo) {
    return "";
  }

  const lines: string[] = [];
  const errorLine = frame.lineNo;
  const maxLineNoWidth = Math.max(
    ...frame.context.map(([lineNo]) => lineNo.toString().length),
  );

  for (const [lineNo, code] of frame.context) {
    const isErrorLine = lineNo === errorLine;
    const lineNoStr = lineNo.toString().padStart(maxLineNoWidth, " ");

    if (Math.abs(lineNo - errorLine) <= contextSize) {
      if (isErrorLine) {
        lines.push(`  → ${lineNoStr} │ ${code}`);
      } else {
        lines.push(`    ${lineNoStr} │ ${code}`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Formats a variable value for display in the variables table.
 * Handles different types appropriately and safely, converting complex objects
 * to readable representations and handling edge cases like circular references.
 *
 * @param value - The variable value to format (can be any type)
 * @param maxLength - Maximum length for stringified objects/arrays (default: 80)
 * @returns Human-readable string representation of the value
 */
function formatVariableValue(value: unknown, maxLength = 80): string {
  try {
    if (typeof value === "string") {
      return `"${value}"`;
    }
    if (value === null) {
      return "null";
    }
    if (value === undefined) {
      return "undefined";
    }
    if (typeof value === "object") {
      const stringified = JSON.stringify(value);
      if (stringified.length > maxLength) {
        // Leave room for ", ...]" or ", ...}"
        const truncateAt = maxLength - 6;
        let truncated = stringified.substring(0, truncateAt);

        // Find the last complete element by looking for the last comma
        const lastComma = truncated.lastIndexOf(",");
        if (lastComma > 0) {
          truncated = truncated.substring(0, lastComma);
        }

        // Add the appropriate ending
        if (Array.isArray(value)) {
          return `${truncated}, ...]`;
        }
        return `${truncated}, ...}`;
      }
      return stringified;
    }
    return String(value);
  } catch {
    // Handle circular references or other stringify errors
    return `<${typeof value}>`;
  }
}

/**
 * Renders a table of local variables in a tree-like format.
 * Uses box-drawing characters to create a visual hierarchy of variables
 * and their values at the point where the error occurred.
 *
 * @param vars - Object containing variable names as keys and their values
 * @returns Formatted variables table with tree-style prefix characters
 */
function renderVariablesTable(vars: Record<string, unknown>): string {
  const entries = Object.entries(vars);
  if (entries.length === 0) {
    return "";
  }

  const lines: string[] = ["Local Variables:"];
  const lastIndex = entries.length - 1;

  entries.forEach(([key, value], index) => {
    const prefix = index === lastIndex ? "└─" : "├─";
    const valueStr = formatVariableValue(value);
    lines.push(`${prefix} ${key}: ${valueStr}`);
  });

  return lines.join("\n");
}

/**
 * Finds the first application frame (in_app) in a stack trace.
 * Searches from the bottom of the stack (oldest frame) to find the first
 * frame that belongs to the user's application code rather than libraries.
 *
 * @param frames - Array of stack frames, typically in reverse chronological order
 * @returns The first in-app frame found, or undefined if none exist
 */
function findFirstInAppFrame(
  frames: z.infer<typeof FrameInterface>[],
): z.infer<typeof FrameInterface> | undefined {
  // Frames are usually in reverse order (most recent first)
  // We want the first in-app frame from the bottom
  for (let i = frames.length - 1; i >= 0; i--) {
    if (frames[i].inApp === true) {
      return frames[i];
    }
  }
  return undefined;
}

/**
 * Constants for performance issue formatting
 */
const MAX_SPANS_IN_TREE = 10;
const MAX_QUERY_GROUPS = 10;

/**
 * Type guard to check if data is a valid span array
 */
function isValidSpanArray(data: unknown): data is Array<any> {
  return Array.isArray(data) && data.length > 0;
}

/**
 * Safely parse a number from a string, returning a default if invalid
 */
function safeParseInt(value: unknown, defaultValue: number): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? defaultValue : parsed;
  }
  return defaultValue;
}

/**
 * Simplified span structure for rendering span trees in performance issues.
 * This is a subset of the full span data focused on visualization needs.
 */
interface PerformanceSpan {
  span_id: string;
  op: string; // Operation type (e.g., "db.query", "http.client")
  description: string; // Human-readable description of what the span did
  duration: number; // Duration in milliseconds
  is_n1_query: boolean; // Whether this span is part of the N+1 pattern
  children: PerformanceSpan[];
  level: number; // Nesting level for tree rendering
}

/**
 * Selects and organizes spans for N+1 query visualization.
 *
 * Creates a simplified span tree showing the relationship between parent
 * operations and the repeated queries. Limits output to prevent overwhelming
 * the CLI display.
 *
 * @param spans - Raw span data from the event
 * @param evidence - Evidence data containing offenderSpanIds and parentSpanIds
 * @param maxSpans - Maximum number of spans to include (default: 10)
 * @returns Array of selected spans organized hierarchically
 */
function selectN1QuerySpans(
  spansData: unknown,
  evidence: any,
  maxSpans = MAX_SPANS_IN_TREE,
): PerformanceSpan[] {
  const selected: PerformanceSpan[] = [];
  let spanCount = 0;

  // Validate spansData is an array
  if (!isValidSpanArray(spansData)) {
    return selected;
  }
  const spans = spansData as any[];

  // Use offenderSpanIds to identify N+1 queries
  const n1SpanIds = new Set(evidence?.offenderSpanIds || []);
  const parentSpanIds = evidence?.parentSpanIds || [];

  // Find the parent span(s) if we have IDs
  let parentSpan: PerformanceSpan | null = null;
  if (parentSpanIds.length > 0) {
    const parent = spans.find((s: any) =>
      parentSpanIds.includes(s.span_id || s.id),
    );
    if (parent) {
      parentSpan = {
        span_id: parent.span_id || parent.id || "unknown",
        op: parent.op || "unknown",
        description:
          parent.description || evidence.parentSpan || "Parent Operation",
        duration: parent.timestamp - parent.start_timestamp || parent.duration,
        is_n1_query: false,
        children: [],
        level: 0,
      };
      selected.push(parentSpan);
      spanCount++;
    }
  }

  // Add N+1 query spans
  if (n1SpanIds.size > 0) {
    // Find all spans that are part of the N+1 pattern
    const n1Spans = spans
      .filter((s: any) => n1SpanIds.has(s.span_id || s.id))
      .slice(0, maxSpans - spanCount);

    for (const span of n1Spans) {
      const perfSpan: PerformanceSpan = {
        span_id: span.span_id || span.id || "unknown",
        op: span.op || "db.query",
        description: span.description || "Database Query",
        duration: span.timestamp - span.start_timestamp || span.duration,
        is_n1_query: true,
        children: [],
        level: parentSpan ? 1 : 0,
      };

      if (parentSpan) {
        parentSpan.children.push(perfSpan);
      } else {
        selected.push(perfSpan);
      }
      spanCount++;

      if (spanCount >= maxSpans) break;
    }
  }

  return selected;
}

/**
 * Renders a hierarchical tree of performance spans using box-drawing characters.
 * Highlights N+1 queries with a special indicator.
 *
 * @param spans - Array of selected performance spans
 * @returns Array of formatted strings representing the tree
 */
function renderPerformanceSpanTree(spans: PerformanceSpan[]): string[] {
  const lines: string[] = [];

  function renderSpan(span: PerformanceSpan, prefix = "", isLast = true): void {
    const connector = prefix === "" ? "" : isLast ? "└─ " : "├─ ";
    const duration =
      span.duration > 0 ? ` (${Math.round(span.duration)}ms)` : "";
    const n1Indicator = span.is_n1_query ? " [N+1]" : "";

    // Format the span line
    const spanLine = `${prefix}${connector}${span.op}: ${span.description}${duration}${n1Indicator}`;
    lines.push(spanLine);

    // Render children
    for (let i = 0; i < span.children.length; i++) {
      const child = span.children[i];
      const isLastChild = i === span.children.length - 1;
      const childPrefix = prefix + (isLast ? "   " : "│  ");
      renderSpan(child, childPrefix, isLastChild);
    }
  }

  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    const isLastRoot = i === spans.length - 1;
    renderSpan(span, "", isLastRoot);
  }

  return lines;
}

/**
 * Known Sentry performance issue types that we handle.
 *
 * NOTE: We intentionally only implement formatters for high-value performance issues
 * that provide complex insights. Not all issue types need custom formatting - many
 * can rely on the generic evidenceDisplay fields that Sentry provides.
 *
 * Currently fully implemented:
 * - N+1 query detection (DB and API)
 *
 * Partially implemented:
 * - Slow DB queries (shows parent span only)
 *
 * Not implemented (lower priority):
 * - Asset-related issues (render blocking, uncompressed, large payloads)
 * - File I/O issues
 * - Consecutive queries
 */
const KNOWN_PERFORMANCE_ISSUE_TYPES = {
  N_PLUS_ONE_DB_QUERIES: "performance_n_plus_one_db_queries",
  N_PLUS_ONE_API_CALLS: "performance_n_plus_one_api_calls",
  SLOW_DB_QUERY: "performance_slow_db_query",
  RENDER_BLOCKING_ASSET: "performance_render_blocking_asset",
  CONSECUTIVE_DB_QUERIES: "performance_consecutive_db_queries",
  FILE_IO_MAIN_THREAD: "performance_file_io_main_thread",
  M_N_PLUS_ONE_DB_QUERIES: "performance_m_n_plus_one_db_queries",
  UNCOMPRESSED_ASSET: "performance_uncompressed_asset",
  LARGE_HTTP_PAYLOAD: "performance_large_http_payload",
} as const;

/**
 * Map numeric occurrence types to issue types (from Sentry's codebase).
 *
 * Sentry uses numeric type IDs internally in the occurrence data structure,
 * but string issue types in the UI and other APIs. This mapping converts
 * between them.
 *
 * Source: sentry/static/app/types/group.tsx in Sentry's codebase
 * Range: 1xxx = transaction-based performance issues
 *        2xxx = profile-based performance issues
 */
const OCCURRENCE_TYPE_TO_ISSUE_TYPE: Record<number, string> = {
  1001: KNOWN_PERFORMANCE_ISSUE_TYPES.SLOW_DB_QUERY,
  1004: KNOWN_PERFORMANCE_ISSUE_TYPES.RENDER_BLOCKING_ASSET,
  1006: KNOWN_PERFORMANCE_ISSUE_TYPES.N_PLUS_ONE_DB_QUERIES,
  1906: KNOWN_PERFORMANCE_ISSUE_TYPES.N_PLUS_ONE_DB_QUERIES, // Alternative ID for N+1 DB
  1007: KNOWN_PERFORMANCE_ISSUE_TYPES.CONSECUTIVE_DB_QUERIES,
  1008: KNOWN_PERFORMANCE_ISSUE_TYPES.FILE_IO_MAIN_THREAD,
  1009: "performance_consecutive_http",
  1010: KNOWN_PERFORMANCE_ISSUE_TYPES.N_PLUS_ONE_API_CALLS,
  1910: KNOWN_PERFORMANCE_ISSUE_TYPES.N_PLUS_ONE_API_CALLS, // Alternative ID for N+1 API
  1012: KNOWN_PERFORMANCE_ISSUE_TYPES.UNCOMPRESSED_ASSET,
  1013: "performance_db_main_thread",
  1015: KNOWN_PERFORMANCE_ISSUE_TYPES.LARGE_HTTP_PAYLOAD,
  1016: "performance_http_overhead",
};

// Type alias currently unused but kept for potential future type safety
// type PerformanceIssueType = typeof KNOWN_PERFORMANCE_ISSUE_TYPES[keyof typeof KNOWN_PERFORMANCE_ISSUE_TYPES];

/**
 * Formats N+1 query issue evidence data.
 *
 * N+1 queries are a common performance anti-pattern where code executes
 * 1 query to get a list of items, then N additional queries (one per item)
 * instead of using a single JOIN or batch query.
 *
 * Evidence fields we use:
 * - parentSpan: The operation that triggered the N+1 queries
 * - repeatingSpansCompact/repeatingSpans: The query pattern being repeated
 * - numberRepeatingSpans: How many times the query was executed
 * - offenderSpanIds: IDs of the actual span instances
 * - parentSpanIds: IDs of parent spans for tree visualization
 */
function formatN1QueryEvidence(
  evidenceData: Record<string, any>,
  spansData: unknown,
): string {
  const parts: string[] = [];

  // Format parent span info if available
  if (evidenceData.parentSpan) {
    parts.push("**Parent Operation:**");
    parts.push(`${evidenceData.parentSpan}`);
    parts.push("");
  }

  // Format repeating spans (the N+1 queries)
  if (evidenceData.repeatingSpansCompact || evidenceData.repeatingSpans) {
    parts.push("### Repeated Database Queries");
    parts.push("");

    const queryCount = evidenceData.numberRepeatingSpans
      ? safeParseInt(evidenceData.numberRepeatingSpans, 0)
      : evidenceData.offenderSpanIds?.length || 0;

    if (queryCount > 0) {
      parts.push(`**Query executed ${queryCount} times:**`);

      // Show the query pattern (prefer compact version)
      const queryPattern =
        evidenceData.repeatingSpansCompact || evidenceData.repeatingSpans;
      if (queryPattern) {
        parts.push("```sql");
        parts.push(queryPattern);
        parts.push("```");
        parts.push("");
      }
    }
  }

  // Add span tree visualization if we have spans data and span IDs
  if (
    isValidSpanArray(spansData) &&
    (evidenceData.offenderSpanIds?.length > 0 ||
      evidenceData.parentSpanIds?.length > 0)
  ) {
    const selectedSpans = selectN1QuerySpans(
      spansData,
      evidenceData,
      MAX_SPANS_IN_TREE,
    );
    if (selectedSpans.length > 0) {
      parts.push(`### Span Tree (Limited to ${MAX_SPANS_IN_TREE} spans)`);
      parts.push("");
      parts.push("```");
      const treeLines = renderPerformanceSpanTree(selectedSpans);
      parts.push(...treeLines);
      parts.push("```");
      parts.push("");
    }
  }

  return parts.join("\n");
}

/**
 * Formats slow DB query issue evidence data.
 *
 * Currently only partially implemented - shows parent span information.
 * Full implementation would show query duration, explain plan, etc.
 *
 * This is lower priority as the generic evidenceDisplay fields usually
 * provide sufficient information for slow query issues.
 */
function formatSlowDbQueryEvidence(
  evidenceData: Record<string, any>,
  spansData: unknown,
): string {
  const parts: string[] = [];

  // Show parent span if available (generic field that applies to slow queries)
  if (evidenceData.parentSpan) {
    parts.push("**Parent Operation:**");
    parts.push(`${evidenceData.parentSpan}`);
    parts.push("");
  }

  // TODO: Implement slow query specific fields when we know the structure
  // Potential fields: query duration, database name, query plan
  console.warn(
    "[formatSlowDbQueryEvidence] Evidence data rendering not yet fully implemented",
  );

  return parts.join("\n");
}

/**
 * Formats performance issue details from transaction events based on the issue type.
 *
 * This is the main dispatcher for performance issue formatting. It:
 * 1. Detects the issue type from occurrence data (numeric or string)
 * 2. Calls the appropriate type-specific formatter if implemented
 * 3. Falls back to generic evidenceDisplay fields for unimplemented types
 * 4. Provides span analysis fallback for events without occurrence data
 *
 * The occurrence data structure comes from Sentry's performance issue detection
 * and contains evidence about what triggered the issue.
 *
 * @param event - The transaction event containing performance issue data
 * @param spansData - The spans data from the event entries
 * @returns Formatted markdown string with performance issue details
 */
function formatPerformanceIssueOutput(
  event: Event,
  spansData: unknown,
): string {
  const parts: string[] = [];

  // Check if we have occurrence data
  const occurrence = (event as any).occurrence;
  if (!occurrence) {
    return "";
  }

  // Get issue type - occurrence.type is numeric, issueType may be a string
  let issueType: string | undefined;
  if (typeof occurrence.type === "number") {
    issueType = OCCURRENCE_TYPE_TO_ISSUE_TYPE[occurrence.type];
  } else {
    issueType = occurrence.issueType || occurrence.type;
  }

  const evidenceData = occurrence.evidenceData;

  // Process evidence data based on known performance issue types
  if (evidenceData) {
    switch (issueType) {
      case KNOWN_PERFORMANCE_ISSUE_TYPES.N_PLUS_ONE_DB_QUERIES:
      case KNOWN_PERFORMANCE_ISSUE_TYPES.N_PLUS_ONE_API_CALLS:
      case KNOWN_PERFORMANCE_ISSUE_TYPES.M_N_PLUS_ONE_DB_QUERIES: {
        const result = formatN1QueryEvidence(evidenceData, spansData);
        if (result) parts.push(result);
        break;
      }

      case KNOWN_PERFORMANCE_ISSUE_TYPES.SLOW_DB_QUERY: {
        const result = formatSlowDbQueryEvidence(evidenceData, spansData);
        if (result) parts.push(result);
        break;
      }

      default:
        // We don't implement formatters for all performance issue types.
        // Many lower-priority issues (consecutive queries, asset issues, file I/O)
        // work fine with just the generic evidenceDisplay fields below.
        // Only high-value, complex issues like N+1 queries need custom formatting.
        if (issueType) {
          console.warn(
            `[formatPerformanceIssueOutput] No custom formatter for issue type: ${issueType}`,
          );
        }
      // Fall through to show generic evidence display below
    }
  }

  // Show transaction name if available for any performance issue (generic field)
  if (evidenceData?.transactionName) {
    parts.push("**Transaction:**");
    parts.push(`${evidenceData.transactionName}`);
    parts.push("");
  }

  // Always show evidence display if available (this is generic and doesn't require type knowledge)
  if (occurrence.evidenceDisplay?.length > 0) {
    for (const display of occurrence.evidenceDisplay) {
      if (display.important) {
        parts.push(`**${display.name}:**`);
        parts.push(`${display.value}`);
        parts.push("");
      }
    }
  }

  return parts.length > 0 ? `${parts.join("\n")}\n` : "";
}

function formatTags(tags: z.infer<typeof EventSchema>["tags"]) {
  if (!tags || tags.length === 0) {
    return "";
  }
  return `### Tags\n\n${tags
    .map((tag) => `**${tag.key}**: ${tag.value}`)
    .join("\n")}\n\n`;
}

function formatContexts(contexts: z.infer<typeof EventSchema>["contexts"]) {
  if (!contexts || Object.keys(contexts).length === 0) {
    return "";
  }
  return `### Additional Context\n\nThese are additional context provided by the user when they're instrumenting their application.\n\n${Object.entries(
    contexts,
  )
    .map(
      ([name, data]) =>
        `**${name}**\n${Object.entries(data)
          .filter(([key, _]) => key !== "type")
          .map(([key, value]) => {
            return `${key}: ${JSON.stringify(value, undefined, 2)}`;
          })
          .join("\n")}`,
    )
    .join("\n\n")}\n\n`;
}

/**
 * Formats a brief Seer AI analysis summary for inclusion in issue details.
 * Shows current status and high-level insights, prompting to use analyze_issue_with_seer for full details.
 *
 * @param autofixState - The autofix state containing Seer analysis data
 * @param organizationSlug - The organization slug for the issue
 * @param issueId - The issue ID (shortId)
 * @returns Formatted markdown string with Seer summary, or empty string if no analysis exists
 */
function formatSeerSummary(
  autofixState: AutofixRunState | undefined,
  organizationSlug: string,
  issueId: string,
): string {
  if (!autofixState || !autofixState.autofix) {
    return "";
  }

  const { autofix } = autofixState;
  const parts: string[] = [];

  parts.push("## Seer AI Analysis");
  parts.push("");

  // Show status first
  const statusDisplay = getStatusDisplayName(autofix.status);
  if (!isTerminalStatus(autofix.status)) {
    parts.push(`**Status:** ${statusDisplay}`);
    parts.push("");
  }

  // Show summary of what we have so far
  if (autofix.steps.length > 0) {
    const completedSteps = autofix.steps.filter(
      (step) => step.status === "COMPLETED",
    );

    // Find the solution step if available
    const solutionStep = completedSteps.find(
      (step) => step.type === "solution",
    );

    if (solutionStep) {
      // For solution steps, use the description directly
      const solutionDescription = solutionStep.description;
      if (
        solutionDescription &&
        typeof solutionDescription === "string" &&
        solutionDescription.trim()
      ) {
        parts.push("**Summary:**");
        parts.push(solutionDescription.trim());
      } else {
        // Fallback to extracting from output if no description
        const solutionOutput = getOutputForAutofixStep(solutionStep);
        const lines = solutionOutput.split("\n");
        const firstParagraph = lines.find(
          (line) =>
            line.trim().length > 50 &&
            !line.startsWith("#") &&
            !line.startsWith("*"),
        );
        if (firstParagraph) {
          parts.push("**Summary:**");
          parts.push(firstParagraph.trim());
        }
      }
    } else if (completedSteps.length > 0) {
      // Show what steps have been completed so far
      const rootCauseStep = completedSteps.find(
        (step) => step.type === "root_cause_analysis",
      );

      if (rootCauseStep) {
        const typedStep = rootCauseStep as z.infer<
          typeof AutofixRunStepRootCauseAnalysisSchema
        >;
        if (
          typedStep.causes &&
          typedStep.causes.length > 0 &&
          typedStep.causes[0].description
        ) {
          parts.push("**Root Cause Identified:**");
          parts.push(typedStep.causes[0].description.trim());
        }
      } else {
        // Show generic progress
        parts.push(
          `**Progress:** ${completedSteps.length} of ${autofix.steps.length} steps completed`,
        );
      }
    }
  } else {
    // No steps yet - check for terminal states first
    if (isTerminalStatus(autofix.status)) {
      if (autofix.status === "FAILED" || autofix.status === "ERROR") {
        parts.push("**Status:** Analysis failed.");
      } else if (autofix.status === "CANCELLED") {
        parts.push("**Status:** Analysis was cancelled.");
      } else if (
        autofix.status === "NEED_MORE_INFORMATION" ||
        autofix.status === "WAITING_FOR_USER_RESPONSE"
      ) {
        parts.push(
          "**Status:** Analysis paused - additional information needed.",
        );
      }
    } else {
      parts.push("Analysis has started but no results yet.");
    }
  }

  // Add specific messages for terminal states when steps exist
  if (autofix.steps.length > 0 && isTerminalStatus(autofix.status)) {
    if (autofix.status === "FAILED" || autofix.status === "ERROR") {
      parts.push("");
      parts.push("**Status:** Analysis failed.");
    } else if (autofix.status === "CANCELLED") {
      parts.push("");
      parts.push("**Status:** Analysis was cancelled.");
    } else if (
      autofix.status === "NEED_MORE_INFORMATION" ||
      autofix.status === "WAITING_FOR_USER_RESPONSE"
    ) {
      parts.push("");
      parts.push(
        "**Status:** Analysis paused - additional information needed.",
      );
    }
  }

  // Always suggest using analyze_issue_with_seer for more details
  parts.push("");
  parts.push(
    `**Note:** For detailed root cause analysis and solutions, call \`analyze_issue_with_seer(organizationSlug='${organizationSlug}', issueId='${issueId}')\``,
  );

  return `${parts.join("\n")}\n\n`;
}

/**
 * Formats a Sentry issue with its latest event into comprehensive markdown output.
 * Includes issue metadata, event details, and usage instructions.
 *
 * @param params - Object containing organization slug, issue, event, and API service
 * @returns Formatted markdown string with complete issue information
 */
export function formatIssueOutput({
  organizationSlug,
  issue,
  event,
  apiService,
  autofixState,
}: {
  organizationSlug: string;
  issue: Issue;
  event: Event;
  apiService: SentryApiService;
  autofixState?: AutofixRunState;
}) {
  let output = `# Issue ${issue.shortId} in **${organizationSlug}**\n\n`;

  // Check if this is a performance issue based on issueCategory or issueType
  // Performance issues can have various categories like 'db_query' but issueType starts with 'performance_'
  const isPerformanceIssue =
    issue.issueType?.startsWith("performance_") ||
    issue.issueCategory === "performance";

  if (isPerformanceIssue && issue.metadata) {
    // For performance issues, use metadata for better context
    const issueTitle = issue.metadata.title || issue.title;
    output += `**Description**: ${issueTitle}\n`;

    if (issue.metadata.location) {
      output += `**Location**: ${issue.metadata.location}\n`;
    }
    if (issue.metadata.value) {
      output += `**Query Pattern**: \`${issue.metadata.value}\`\n`;
    }
  } else {
    // For regular errors and other issues
    output += `**Description**: ${issue.title}\n`;
    output += `**Culprit**: ${issue.culprit}\n`;
  }

  output += `**First Seen**: ${new Date(issue.firstSeen).toISOString()}\n`;
  output += `**Last Seen**: ${new Date(issue.lastSeen).toISOString()}\n`;
  output += `**Occurrences**: ${issue.count}\n`;
  output += `**Users Impacted**: ${issue.userCount}\n`;
  output += `**Status**: ${issue.status}\n`;
  output += `**Platform**: ${issue.platform}\n`;
  output += `**Project**: ${issue.project.name}\n`;
  output += `**URL**: ${apiService.getIssueUrl(organizationSlug, issue.shortId)}\n`;
  output += "\n";
  output += "## Event Details\n\n";
  output += `**Event ID**: ${event.id}\n`;
  if (event.type === "error") {
    output += `**Occurred At**: ${new Date((event as z.infer<typeof ErrorEventSchema>).dateCreated).toISOString()}\n`;
  }
  if (event.message) {
    output += `**Message**:\n${event.message}\n`;
  }
  output += "\n";
  output += formatEventOutput(event);

  // Add Seer context if available
  if (autofixState) {
    output += formatSeerSummary(autofixState, organizationSlug, issue.shortId);
  }

  output += "# Using this information\n\n";
  output += `- You can reference the IssueID in commit messages (e.g. \`Fixes ${issue.shortId}\`) to automatically close the issue when the commit is merged.\n`;
  output +=
    "- The stacktrace includes both first-party application code as well as third-party code, its important to triage to first-party code.\n";
  return output;
}
