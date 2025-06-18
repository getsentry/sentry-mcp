/**
 * LLM response formatting utilities for Sentry data.
 *
 * Converts Sentry API responses into structured markdown format optimized
 * for LLM consumption. Handles stacktraces, event details, issue summaries,
 * and contextual information with consistent formatting patterns.
 */
import type { z } from "zod";
import type { Event, Issue } from "../api-client/types";
import type {
  ErrorEntrySchema,
  ErrorEventSchema,
  EventSchema,
  FrameInterface,
  RequestEntrySchema,
  MessageEntrySchema,
  ThreadsEntrySchema,
  SentryApiService,
} from "../api-client";

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
  if (frame.filename?.endsWith(".java")) {
    return "java";
  }

  if (frame.filename?.endsWith(".py")) {
    return "python";
  }

  if (frame.filename?.match(/\.(js|ts|jsx|tsx)$/)) {
    return "javascript";
  }

  if (frame.filename?.endsWith(".rb")) {
    return "ruby";
  }

  if (frame.filename?.endsWith(".php")) {
    return "php";
  }

  // Fall back to platform if provided
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

  output += formatContexts(event.contexts);
  return output;
}

function formatExceptionInterfaceOutput(
  event: Event,
  data: z.infer<typeof ErrorEntrySchema>,
) {
  let output = "";
  // TODO: support chained exceptions
  const firstError = data.value ?? data.values[0];
  if (!firstError) {
    return "";
  }
  output += `### Error\n\n${"```"}\n${firstError.type}: ${
    firstError.value
  }\n${"```"}\n\n`;
  if (!firstError.stacktrace || !firstError.stacktrace.frames) {
    return output;
  }
  output += `**Stacktrace:**\n${"```"}\n${firstError.stacktrace.frames
    .map((frame) => {
      const context = frame.context?.length
        ? `${frame.context
            .filter(([lineno, _]) => lineno === frame.lineNo)
            .map(([_, code]) => `\n${code}`)
            .join("")}`
        : "";

      return `${formatFrameHeader(frame, undefined, event.platform)}${context}`;
    })
    .join("\n")}\n${"```"}\n\n`;
  return output;
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

  let output = "";

  // Include thread name if available
  if (crashedThread.name) {
    output += `**Thread** (${crashedThread.name})\n\n`;
  }

  output += `**Stacktrace:**\n${"```"}\n${crashedThread.stacktrace.frames
    .map((frame) => {
      const context = frame.context?.length
        ? `${frame.context
            .filter(([lineno, _]) => lineno === frame.lineNo)
            .map(([_, code]) => `\n${code}`)
            .join("")}`
        : "";

      return `${formatFrameHeader(frame, undefined, event.platform)}${context}`;
    })
    .join("\n")}\n${"```"}\n\n`;

  return output;
}

function formatContexts(contexts: z.infer<typeof EventSchema>["contexts"]) {
  if (!contexts) {
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
}: {
  organizationSlug: string;
  issue: Issue;
  event: Event;
  apiService: SentryApiService;
}) {
  let output = `# Issue ${issue.shortId} in **${organizationSlug}**\n\n`;
  output += `**Description**: ${issue.title}\n`;
  output += `**Culprit**: ${issue.culprit}\n`;
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
  output += "# Using this information\n\n";
  output += `- You can reference the IssueID in commit messages (e.g. \`Fixes ${issue.shortId}\`) to automatically close the issue when the commit is merged.\n`;
  output +=
    "- The stacktrace includes both first-party application code as well as third-party code, its important to triage to first-party code.\n";
  return output;
}
