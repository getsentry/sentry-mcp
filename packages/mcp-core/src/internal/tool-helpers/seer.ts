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

function escapeXmlAttribute(value: string | number): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function wrapSeerAnalysisOutput({
  output,
  runId,
  step,
  includeProvenanceTags,
}: {
  output: string;
  runId?: number;
  step: string;
  includeProvenanceTags: boolean;
}): string {
  if (!includeProvenanceTags) {
    return `${output.trimEnd()}\n`;
  }

  const attrs = [
    runId === undefined ? null : `run_id="${escapeXmlAttribute(runId)}"`,
    `step="${escapeXmlAttribute(step)}"`,
  ].filter(Boolean);

  return `<seer_analysis ${attrs.join(" ")}>\n${output.trimEnd()}\n</seer_analysis>\n`;
}

export function getOutputForAutofixStep(
  step: z.infer<typeof AutofixRunStepSchema>,
  options: { runId?: number; includeProvenanceTags?: boolean } = {},
) {
  const includeProvenanceTags = options.includeProvenanceTags ?? true;
  const heading = `## ${step.title}\n\n`;

  if (step.status === "FAILED") {
    return `${heading}**Sentry hit an error completing this step.\n\n`;
  }

  if (step.status !== "COMPLETED") {
    return `${heading}**Sentry is still working on this step. Please check back in a minute.**\n\n`;
  }

  if (step.type === "root_cause_analysis") {
    const typedStep = step as z.infer<
      typeof AutofixRunStepRootCauseAnalysisSchema
    >;
    let body = "";

    for (const cause of typedStep.causes) {
      if (cause.description) {
        body += `${cause.description}\n\n`;
      }
      for (const entry of cause.root_cause_reproduction) {
        body += `**${entry.title}**\n\n`;
        body += `${entry.code_snippet_and_analysis}\n\n`;
      }
    }
    return wrapSeerAnalysisOutput({
      output: body,
      runId: options.runId,
      step: step.key,
      includeProvenanceTags,
    });
  }

  if (step.type === "solution") {
    const typedStep = step as z.infer<typeof AutofixRunStepSolutionSchema>;
    let body = `${typedStep.description}\n\n`;
    for (const entry of typedStep.solution) {
      body += `**${entry.title}**\n`;
      if (entry.code_snippet_and_analysis) {
        body += `${entry.code_snippet_and_analysis}\n\n`;
      }
    }

    if (typedStep.status === "FAILED") {
      body += `**Sentry hit an error completing this step.\n\n`;
    } else if (typedStep.status !== "COMPLETED") {
      body += `**Sentry is still working on this step.**\n\n`;
    }

    return wrapSeerAnalysisOutput({
      output: body,
      runId: options.runId,
      step: step.key,
      includeProvenanceTags,
    });
  }

  const typedStep = step as z.infer<typeof AutofixRunStepDefaultSchema>;
  let body = "";
  let hasGeneratedOutput = false;
  if (typedStep.insights && typedStep.insights.length > 0) {
    hasGeneratedOutput = true;
    for (const entry of typedStep.insights) {
      body += `**${entry.insight}**\n`;
      body += `${entry.justification}\n\n`;
    }
  } else if (step.output_stream) {
    hasGeneratedOutput = true;
    body += `${step.output_stream}\n`;
  }

  if (hasGeneratedOutput) {
    return wrapSeerAnalysisOutput({
      output: body,
      runId: options.runId,
      step: step.key,
      includeProvenanceTags,
    });
  }

  return heading;
}
