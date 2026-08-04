import type { z } from "zod";
import type { AssignedToSchema } from "../../api-client/index";

type AssignedTo = z.infer<typeof AssignedToSchema>;

/** Format arbitrary text as safe Markdown inline code. */
export function formatInlineCode(value: string): string {
  const backtickRuns = value.match(/`+/g) ?? [];
  const fenceLength =
    backtickRuns.reduce((max, run) => Math.max(max, run.length), 0) + 1;
  const fence = "`".repeat(fenceLength);
  const needsPadding = value.startsWith("`") || value.endsWith("`");
  return needsPadding
    ? `${fence} ${value} ${fence}`
    : `${fence}${value}${fence}`;
}

/**
 * Helper function to format assignedTo field for display
 */
export function formatAssignedTo(assignedTo: AssignedTo): string {
  if (!assignedTo) {
    return "Unassigned";
  }

  if (typeof assignedTo === "string") {
    return assignedTo;
  }

  if (typeof assignedTo === "object" && assignedTo.name) {
    return assignedTo.name;
  }

  return "Unknown";
}
