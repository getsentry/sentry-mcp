import type { z } from "zod";
import type { AssignedToSchema } from "../../api-client/index";

type AssignedTo = z.infer<typeof AssignedToSchema>;

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
