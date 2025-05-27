import type { z } from "zod";
import type { Event, Issue } from "../api-client/types";
import type {
  ErrorEntrySchema,
  ErrorEventSchema,
  FrameInterface,
  RequestEntrySchema,
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
      output += formatExceptionInterfaceOutput(
        event,
        entry.data as z.infer<typeof ErrorEntrySchema>,
      );
    }
    if (entry.type === "request") {
      output += formatRequestInterfaceOutput(
        event,
        entry.data as z.infer<typeof RequestEntrySchema>,
      );
    }
  }
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
  output += `**Error:**\n${"```"}\n${firstError.type}: ${
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

      return `${formatFrameHeader(frame, event.platform)}${context}`;
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
  return `**HTTP Method:** ${data.method}\n**URL:** ${data.url}\n`;
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
  output += formatEventOutput(event);
  output += "# Using this information\n\n";
  output += `- You can reference the IssueID in commit messages (e.g. \`Fixes ${issue.shortId}\`) to automatically close the issue when the commit is merged.\n`;
  output +=
    "- The stacktrace includes both first-party application code as well as third-party code, its important to triage to first-party code.\n";
  return output;
}
