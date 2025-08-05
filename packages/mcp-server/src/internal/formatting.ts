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
} from "../api-client";
import { getOutputForAutofixStep, isTerminalStatus } from "./tool-helpers/seer";

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
 * Formats Seer AI analysis context for inclusion in issue details.
 * Provides a minimal summary showing just the key solution when available.
 *
 * @param autofixState - The autofix state containing Seer analysis data
 * @returns Formatted markdown string with Seer context, or empty string if no analysis exists
 */
function formatSeerContext(autofixState: AutofixRunState): string {
  if (!autofixState.autofix) {
    return "";
  }

  const { autofix } = autofixState;
  const parts: string[] = [];

  parts.push("## Seer AI Analysis");
  parts.push("");

  // For completed analyses, show just the key solution
  if (isTerminalStatus(autofix.status) && autofix.steps.length > 0) {
    const completedSteps = autofix.steps.filter(
      (step) => step.status === "COMPLETED",
    );

    // Find the solution step and show its description directly
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
          parts.push(firstParagraph.trim());
        }
      }
    }
  }
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

  // Add Seer context if available
  if (autofixState) {
    output += formatSeerContext(autofixState);
  }

  output += "# Using this information\n\n";
  output += `- You can reference the IssueID in commit messages (e.g. \`Fixes ${issue.shortId}\`) to automatically close the issue when the commit is merged.\n`;
  output +=
    "- The stacktrace includes both first-party application code as well as third-party code, its important to triage to first-party code.\n";
  return output;
}
