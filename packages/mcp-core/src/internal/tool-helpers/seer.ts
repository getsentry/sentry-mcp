import { z } from "zod";
import type {
  AutofixRunState,
  AutofixRunStepSchema,
  AutofixRunStepRootCauseAnalysisSchema,
  AutofixRunStepSolutionSchema,
  AutofixRunStepDefaultSchema,
} from "../../api-client/index";

type AutofixRun = NonNullable<AutofixRunState["autofix"]>;

export const SEER_POLLING_INTERVAL = 5000; // 5 seconds
export const SEER_TIMEOUT = 5 * 60 * 1000; // 5 minutes
export const SEER_MAX_RETRIES = 3; // Maximum retries for transient failures
export const SEER_INITIAL_RETRY_DELAY = 1000; // 1 second initial retry delay

export function getStatusDisplayName(status: string): string {
  switch (status) {
    case "completed":
      return "Complete";
    case "error":
      return "Failed";
    case "awaiting_user_input":
      return "Waiting for Response";
    case "processing":
      return "Processing";
    default:
      return status;
  }
}

/**
 * Check if an autofix status is terminal (no more updates expected)
 */
export function isTerminalStatus(status: string): boolean {
  return ["completed", "error", "awaiting_user_input"].includes(status);
}

/**
 * Check if an autofix status requires human intervention
 */
export function isHumanInterventionStatus(status: string): boolean {
  return status === "awaiting_user_input";
}

/**
 * Get guidance message for human intervention states
 */
export function getHumanInterventionGuidance(status: string): string {
  if (status === "awaiting_user_input") {
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

  if (step.status === "error") {
    return `${heading}**Sentry hit an error completing this step.\n\n`;
  }

  if (step.status !== "completed") {
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
    if (!body.trim()) {
      return heading;
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
    let body =
      typeof typedStep.description === "string"
        ? `${typedStep.description}\n\n`
        : "";
    for (const entry of typedStep.solution) {
      body += `**${entry.title}**\n`;
      if (entry.code_snippet_and_analysis) {
        body += `${entry.code_snippet_and_analysis}\n\n`;
      }
    }

    if (!body.trim()) {
      return heading;
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

// Artifact data shapes from getsentry/sentry's
// `src/sentry/seer/autofix/artifact_schemas.py`. Fields are LLM-generated, so
// everything is treated as optional.
const RootCauseArtifactDataSchema = z.object({
  one_line_description: z.string().optional(),
  five_whys: z.array(z.string()).default([]),
  reproduction_steps: z.array(z.string()).default([]),
});

const SolutionArtifactDataSchema = z.object({
  one_line_summary: z.string().optional(),
  steps: z
    .array(
      z.object({
        title: z.string().default(""),
        description: z.string().default(""),
      }),
    )
    .default([]),
});

/**
 * Collect the latest artifact data for each key across the run's blocks,
 * mirroring `SeerRunState.get_artifacts()` in getsentry/sentry.
 */
function getAutofixArtifacts(autofix: AutofixRun): Record<string, unknown> {
  const artifacts: Record<string, unknown> = {};
  for (const block of autofix.blocks) {
    for (const artifact of block.artifacts) {
      if (artifact.data) {
        artifacts[artifact.key] = artifact.data;
      }
    }
  }
  return artifacts;
}

function formatRootCauseArtifact(data: unknown): string | null {
  const parsed = RootCauseArtifactDataSchema.safeParse(data);
  if (!parsed.success) {
    return null;
  }
  const { one_line_description, five_whys, reproduction_steps } = parsed.data;

  const sections: string[] = [];
  if (one_line_description) {
    sections.push(one_line_description);
  }
  if (five_whys.length > 0) {
    sections.push(five_whys.map((why, i) => `${i + 1}. ${why}`).join("\n"));
  }
  if (reproduction_steps.length > 0) {
    sections.push(reproduction_steps.map((step) => `- ${step}`).join("\n"));
  }
  return sections.length > 0 ? sections.join("\n\n") : null;
}

function formatSolutionArtifact(data: unknown): string | null {
  const parsed = SolutionArtifactDataSchema.safeParse(data);
  if (!parsed.success) {
    return null;
  }
  const { one_line_summary, steps } = parsed.data;

  const sections: string[] = [];
  if (one_line_summary) {
    sections.push(one_line_summary);
  }
  if (steps.length > 0) {
    sections.push(
      steps.map((step) => `- **${step.title}**: ${step.description}`).join("\n"),
    );
  }
  return sections.length > 0 ? sections.join("\n\n") : null;
}

/**
 * Render the analysis content of an agent-based autofix run: the root cause
 * and solution artifacts, plus links to any pull requests the run created.
 */
export function getOutputForAutofixRun(
  autofix: AutofixRun,
  options: { includeProvenanceTags?: boolean } = {},
): string {
  const includeProvenanceTags = options.includeProvenanceTags ?? true;
  const artifacts = getAutofixArtifacts(autofix);
  let output = "";

  const rootCause = formatRootCauseArtifact(artifacts.root_cause);
  if (rootCause) {
    output += wrapSeerAnalysisOutput({
      output: `## Root Cause Analysis\n\n${rootCause}`,
      runId: autofix.run_id,
      step: "root_cause",
      includeProvenanceTags,
    });
    output += "\n";
  }

  const solution = formatSolutionArtifact(artifacts.solution);
  if (solution) {
    output += wrapSeerAnalysisOutput({
      output: `## Proposed Solution\n\n${solution}`,
      runId: autofix.run_id,
      step: "solution",
      includeProvenanceTags,
    });
    output += "\n";
  }

  const prLinks = Object.entries(autofix.repo_pr_states ?? {})
    .filter(([, prState]) => prState.pr_url)
    .map(([repoName, prState]) => `- ${repoName}: ${prState.pr_url}`);
  if (prLinks.length > 0) {
    output += `## Pull Requests\n\n${prLinks.join("\n")}\n`;
  }

  return output;
}

/**
 * One-line root cause and solution summaries from the run's artifacts, for
 * compact displays like the issue-details Seer section.
 */
export function getAutofixArtifactSummaries(autofix: AutofixRun): {
  rootCause: string | null;
  solution: string | null;
} {
  const artifacts = getAutofixArtifacts(autofix);
  const rootCause = RootCauseArtifactDataSchema.safeParse(
    artifacts.root_cause,
  );
  const solution = SolutionArtifactDataSchema.safeParse(artifacts.solution);
  return {
    rootCause:
      (rootCause.success && rootCause.data.one_line_description) || null,
    solution: (solution.success && solution.data.one_line_summary) || null,
  };
}

/**
 * The agent's currently in-progress todo, used as a progress indicator while
 * a run is processing.
 */
export function getActiveAutofixTodo(autofix: AutofixRun): string | null {
  for (let i = autofix.blocks.length - 1; i >= 0; i--) {
    const todos = autofix.blocks[i].todos;
    if (!todos?.length) {
      continue;
    }
    const active = todos.find((todo) => todo.status === "in_progress");
    return active ? active.content : null;
  }
  return null;
}
