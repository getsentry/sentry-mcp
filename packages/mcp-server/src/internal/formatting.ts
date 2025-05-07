import type { z } from "zod";
import type { Event, Issue } from "../api-client/types";
import type {
  ErrorEntrySchema,
  ErrorEventSchema,
  FrameInterface,
  SentryApiService,
} from "../api-client";

export function formatFrameHeader(
  frame: z.infer<typeof FrameInterface>,
  platform: string | undefined | null,
) {
  if (platform?.startsWith("javascript")) {
    return `${[frame.filename, frame.lineNo, frame.colNo]
      .filter((i) => !!i)
      .join(":")}${frame.function ? ` (${frame.function})` : ""}`;
  }
  return `${frame.function ? `"${frame.function}"` : "unknown function"} in "${frame.filename || frame.module}"${
    frame.lineNo
      ? ` at line ${frame.lineNo}${frame.colNo !== null ? `:${frame.colNo}` : ""}`
      : ""
  }`;
}

export function formatEventOutput(event: Event) {
  let output = "";
  for (const entry of event.entries) {
    if (entry.type === "exception") {
      const data = entry.data as z.infer<typeof ErrorEntrySchema>;
      const firstError = data.value ?? data.values[0];
      if (!firstError) {
        continue;
      }
      output += `**Error:**\n${"```"}\n${firstError.type}: ${
        firstError.value
      }\n${"```"}\n\n`;
      if (!firstError.stacktrace || !firstError.stacktrace.frames) {
        continue;
      }
      output += `**Stacktrace:**\n${"```"}\n${firstError.stacktrace.frames
        .map((frame) => {
          const context = frame.context?.length
            ? `${frame.context
                .filter(([lineno, _]) => lineno === frame.lineNo)
                .map(([_, code]) => `\n${code}`)
                .join("")}`
            : "";

          return `${formatFrameHeader(frame, event.platform)}${context}`;
        })
        .join("\n")}\n${"```"}\n\n`;
    }
  }
  return output;
}

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
  output += formatEventOutput(event);
  output += "# Using this information\n\n";
  output += `- You can reference the IssueID in commit messages (e.g. \`Fixes ${issue.shortId}\`) to automatically close the issue when the commit is merged.\n`;
  output +=
    "- The stacktrace includes both first-party application code as well as third-party code, its important to triage to first-party code.\n";
  return output;
}
