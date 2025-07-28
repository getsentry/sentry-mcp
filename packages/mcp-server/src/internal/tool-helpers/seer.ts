import type { z } from "zod";
import type {
  AutofixRunStepSchema,
  AutofixRunStepRootCauseAnalysisSchema,
  AutofixRunStepSolutionSchema,
  AutofixRunStepDefaultSchema,
} from "../../api-client/index";

export const SEER_POLLING_INTERVAL = 5000; // 5 seconds
export const SEER_TIMEOUT = 5 * 60 * 1000; // 5 minutes
export const SEER_MAX_RETRIES = 3; // Maximum retries for transient failures
export const SEER_INITIAL_RETRY_DELAY = 1000; // 1 second initial retry delay

export function getStatusDisplayName(status: string): string {
  switch (status) {
    case "COMPLETED":
      return "Complete";
    case "FAILED":
    case "ERROR":
      return "Failed";
    case "CANCELLED":
      return "Cancelled";
    case "NEED_MORE_INFORMATION":
      return "Needs More Information";
    case "WAITING_FOR_USER_RESPONSE":
      return "Waiting for Response";
    case "PROCESSING":
      return "Processing";
    case "IN_PROGRESS":
      return "In Progress";
    default:
      return status;
  }
}

/**
 * Check if an autofix status is terminal (no more updates expected)
 */
export function isTerminalStatus(status: string): boolean {
  return [
    "COMPLETED",
    "FAILED",
    "ERROR",
    "CANCELLED",
    "NEED_MORE_INFORMATION",
    "WAITING_FOR_USER_RESPONSE",
  ].includes(status);
}

/**
 * Check if an autofix status requires human intervention
 */
export function isHumanInterventionStatus(status: string): boolean {
  return (
    status === "NEED_MORE_INFORMATION" || status === "WAITING_FOR_USER_RESPONSE"
  );
}

/**
 * Get guidance message for human intervention states
 */
export function getHumanInterventionGuidance(status: string): string {
  if (status === "NEED_MORE_INFORMATION") {
    return "\nSeer needs additional information to continue the analysis. Please review the insights above and consider providing more context.\n";
  }
  if (status === "WAITING_FOR_USER_RESPONSE") {
    return "\nSeer is waiting for your response to proceed. Please review the analysis and provide feedback.\n";
  }
  return "";
}

export function getOutputForAutofixStep(
  step: z.infer<typeof AutofixRunStepSchema>,
) {
  let output = `## ${step.title}\n\n`;

  if (step.status === "FAILED") {
    output += `**Sentry hit an error completing this step.\n\n`;
    return output;
  }

  if (step.status !== "COMPLETED") {
    output += `**Sentry is still working on this step. Please check back in a minute.**\n\n`;
    return output;
  }

  if (step.type === "root_cause_analysis") {
    const typedStep = step as z.infer<
      typeof AutofixRunStepRootCauseAnalysisSchema
    >;

    for (const cause of typedStep.causes) {
      if (cause.description) {
        output += `${cause.description}\n\n`;
      }
      for (const entry of cause.root_cause_reproduction) {
        output += `**${entry.title}**\n\n`;
        output += `${entry.code_snippet_and_analysis}\n\n`;
      }
    }
    return output;
  }

  if (step.type === "solution") {
    const typedStep = step as z.infer<typeof AutofixRunStepSolutionSchema>;
    output += `${typedStep.description}\n\n`;
    for (const entry of typedStep.solution) {
      output += `**${entry.title}**\n`;
      output += `${entry.code_snippet_and_analysis}\n\n`;
    }

    if (typedStep.status === "FAILED") {
      output += `**Sentry hit an error completing this step.\n\n`;
    } else if (typedStep.status !== "COMPLETED") {
      output += `**Sentry is still working on this step.**\n\n`;
    }

    return output;
  }

  const typedStep = step as z.infer<typeof AutofixRunStepDefaultSchema>;
  if (typedStep.insights && typedStep.insights.length > 0) {
    for (const entry of typedStep.insights) {
      output += `**${entry.insight}**\n`;
      output += `${entry.justification}\n\n`;
    }
  } else if (step.output_stream) {
    output += `${step.output_stream}\n`;
  }

  return output;
}
