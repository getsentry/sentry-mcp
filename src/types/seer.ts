/**
 * Seer API Types
 *
 * Zod schemas and TypeScript types for Sentry's Seer Autofix API.
 */

import { z } from "zod";

// Status Constants

/** Possible autofix run statuses */
export const AUTOFIX_STATUSES = [
  "PROCESSING",
  "COMPLETED",
  "ERROR",
  "CANCELLED",
  "NEED_MORE_INFORMATION",
  "WAITING_FOR_USER_RESPONSE",
] as const;

export type AutofixStatus = (typeof AUTOFIX_STATUSES)[number];

/** Terminal statuses that indicate the run has finished */
export const TERMINAL_STATUSES: AutofixStatus[] = [
  "COMPLETED",
  "ERROR",
  "CANCELLED",
];

/** Stopping point values for autofix runs */
export const STOPPING_POINTS = [
  "root_cause",
  "solution",
  "code_changes",
  "open_pr",
] as const;

export type StoppingPoint = (typeof STOPPING_POINTS)[number];

// Progress Message

export const ProgressMessageSchema = z.object({
  message: z.string(),
  timestamp: z.string(),
  type: z.string().optional(),
});

export type ProgressMessage = z.infer<typeof ProgressMessageSchema>;

// Relevant Code File

export const RelevantCodeFileSchema = z.object({
  file_path: z.string(),
  repo_name: z.string(),
});

export type RelevantCodeFile = z.infer<typeof RelevantCodeFileSchema>;

// Reproduction Step

export const ReproductionStepSchema = z.object({
  title: z.string(),
  code_snippet_and_analysis: z.string(),
  is_most_important_event: z.boolean().optional(),
  relevant_code_file: RelevantCodeFileSchema.optional(),
  timeline_item_type: z.string().optional(),
});

export type ReproductionStep = z.infer<typeof ReproductionStepSchema>;

// Root Cause

export const RootCauseSchema = z.object({
  id: z.number(),
  description: z.string(),
  relevant_repos: z.array(z.string()).optional(),
  reproduction_urls: z.array(z.string()).optional(),
  root_cause_reproduction: z.array(ReproductionStepSchema).optional(),
});

export type RootCause = z.infer<typeof RootCauseSchema>;

// Root Cause Selection

export const RootCauseSelectionSchema = z.object({
  cause_id: z.number(),
  instruction: z.string().nullable().optional(),
});

export type RootCauseSelection = z.infer<typeof RootCauseSelectionSchema>;

// Autofix Step

export const AutofixStepSchema = z
  .object({
    id: z.string(),
    key: z.string(),
    status: z.string(),
    title: z.string(),
    progress: z.array(ProgressMessageSchema).optional(),
    causes: z.array(RootCauseSchema).optional(),
    selection: RootCauseSelectionSchema.optional(),
  })
  .passthrough(); // Allow additional fields like artifacts

export type AutofixStep = z.infer<typeof AutofixStepSchema>;

// Repository Info

export const RepositoryInfoSchema = z.object({
  integration_id: z.number().optional(),
  url: z.string().optional(),
  external_id: z.string(),
  name: z.string(),
  provider: z.string().optional(),
  default_branch: z.string().optional(),
  is_readable: z.boolean().optional(),
  is_writeable: z.boolean().optional(),
});

export type RepositoryInfo = z.infer<typeof RepositoryInfoSchema>;

// Codebase Info

export const CodebaseInfoSchema = z.object({
  repo_external_id: z.string(),
  file_changes: z.array(z.unknown()).optional(),
  is_readable: z.boolean().optional(),
  is_writeable: z.boolean().optional(),
});

export type CodebaseInfo = z.infer<typeof CodebaseInfoSchema>;

// PR Info (from completed fix)

export const PullRequestInfoSchema = z.object({
  pr_number: z.number().optional(),
  pr_url: z.string().optional(),
  repo_name: z.string().optional(),
});

export type PullRequestInfo = z.infer<typeof PullRequestInfoSchema>;

// Solution Artifact (from plan command)

/** A single step in the solution plan */
export const SolutionStepSchema = z.object({
  title: z.string(),
  description: z.string(),
});

export type SolutionStep = z.infer<typeof SolutionStepSchema>;

/** Solution data containing the plan to fix the issue */
export const SolutionDataSchema = z.object({
  one_line_summary: z.string(),
  steps: z.array(SolutionStepSchema),
});

export type SolutionData = z.infer<typeof SolutionDataSchema>;

/** Solution artifact from the autofix response */
export const SolutionArtifactSchema = z.object({
  key: z.literal("solution"),
  data: SolutionDataSchema,
  reason: z.string().optional(),
});

export type SolutionArtifact = z.infer<typeof SolutionArtifactSchema>;

// Autofix State

export const AutofixStateSchema = z
  .object({
    /** @deprecated Use sentry_run_id instead. */
    run_id: z.number().optional(),
    /** Null for legacy runs predating this field. */
    sentry_run_id: z.string().nullable().optional(),
    status: z.string(),
    updated_at: z.string().optional(),
    request: z
      .object({
        organization_id: z.number().optional(),
        project_id: z.number().optional(),
        repos: z.array(z.unknown()).optional(),
      })
      .optional(),
    codebases: z.record(z.string(), CodebaseInfoSchema).optional(),
    steps: z.array(AutofixStepSchema).optional(),
    repositories: z.array(RepositoryInfoSchema).optional(),
    coding_agents: z.record(z.string(), z.unknown()).optional(),
    created_at: z.string().optional(),
    completed_at: z.string().optional(),
  })
  .passthrough(); // Allow additional fields like blocks

export type AutofixState = z.infer<typeof AutofixStateSchema>;

// Autofix Response (GET /issues/{id}/autofix/)

export const AutofixResponseSchema = z.object({
  autofix: AutofixStateSchema.nullable(),
});

export type AutofixResponse = z.infer<typeof AutofixResponseSchema>;

// Update Payloads

export const SelectRootCausePayloadSchema = z.object({
  type: z.literal("select_root_cause"),
  cause_id: z.number(),
  stopping_point: z.enum(["solution", "code_changes", "open_pr"]).optional(),
});

export type SelectRootCausePayload = z.infer<
  typeof SelectRootCausePayloadSchema
>;

export const SelectSolutionPayloadSchema = z.object({
  type: z.literal("select_solution"),
});

export type SelectSolutionPayload = z.infer<typeof SelectSolutionPayloadSchema>;

export const CreatePrPayloadSchema = z.object({
  type: z.literal("create_pr"),
});

export type CreatePrPayload = z.infer<typeof CreatePrPayloadSchema>;

export type AutofixUpdatePayload =
  | SelectRootCausePayload
  | SelectSolutionPayload
  | CreatePrPayload;

// Helper Functions

/**
 * Check if an autofix status is terminal (no more updates expected).
 *
 * @param status - The status string to check
 * @returns True if the status indicates completion (COMPLETED, ERROR, CANCELLED)
 */
export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.includes(status as AutofixStatus);
}

// At least one of sentry_run_id/run_id is always present on a non-null
// autofix state, so a missing run ID means a malformed response.
export function requireAutofixRunId(state: AutofixState): string | number {
  const runId = state.sentry_run_id ?? state.run_id;
  if (runId === undefined) {
    throw new Error(
      "Unexpected autofix response: missing both sentry_run_id and run_id."
    );
  }
  return runId;
}

/** Container that may hold root cause analysis data (legacy format) */
type WithCauses = { key: string; causes?: RootCause[] };

/**
 * Search an array of containers (blocks or steps) for root causes
 * in the legacy format where causes are stored directly on the container.
 */
function searchContainersForRootCauses(
  containers: WithCauses[]
): RootCause[] | null {
  for (const container of containers) {
    // Require a non-empty causes array. An empty `causes: []` is truthy and
    // would short-circuit here, blocking fallthrough to the agent artifact
    // format (`searchBlocksForAgentRootCause`) when only that has data.
    if (
      container.key === "root_cause_analysis" &&
      container.causes &&
      container.causes.length > 0
    ) {
      return container.causes;
    }
  }
  return null;
}

/** Agent root cause artifact data from the explorer endpoint */
type AgentRootCauseData = {
  one_line_description: string;
  five_whys?: string[];
  reproduction_steps?: string[];
  relevant_repo?: string | null;
};

/**
 * Search blocks for root cause artifacts in the agent format.
 *
 * The agent endpoint stores root causes as artifacts with `key: "root_cause"`
 * and data `{ one_line_description, five_whys, reproduction_steps, relevant_repo }`.
 * Maps to the existing {@link RootCause} shape for downstream compatibility.
 */
function searchBlocksForAgentRootCause(
  blocks: WithArtifacts[]
): RootCause[] | null {
  for (const block of blocks) {
    if (!block.artifacts) {
      continue;
    }
    for (const artifact of block.artifacts) {
      if (artifact.key === "root_cause" && artifact.data) {
        const agentData = artifact.data as AgentRootCauseData;
        const cause: RootCause = {
          id: 0,
          description: agentData.one_line_description,
          relevant_repos: agentData.relevant_repo
            ? [agentData.relevant_repo]
            : undefined,
        };
        return [cause];
      }
    }
  }
  return null;
}

/**
 * Extract root causes from autofix state.
 *
 * Searches through blocks and steps for root cause data in multiple formats:
 * 1. Legacy step/block format: containers with `key: "root_cause_analysis"` and `causes[]`
 * 2. Agent artifact format: blocks with artifacts `key: "root_cause"` containing
 *    `{ one_line_description, five_whys, reproduction_steps, relevant_repo }`
 *
 * @param state - The autofix state containing analysis data
 * @returns Array of root causes, or empty array if none found
 */
export function extractRootCauses(state: AutofixState): RootCause[] {
  const stateWithExtras = state as AutofixState & {
    blocks?: (WithCauses & WithArtifacts)[];
    steps?: WithCauses[];
  };

  if (stateWithExtras.blocks) {
    // Try legacy format first (containers with causes[])
    const causes = searchContainersForRootCauses(stateWithExtras.blocks);
    if (causes) {
      return causes;
    }
    // Try agent artifact format (artifacts with key: "root_cause")
    const agentCauses = searchBlocksForAgentRootCause(stateWithExtras.blocks);
    if (agentCauses) {
      return agentCauses;
    }
  }

  if (stateWithExtras.steps) {
    const causes = searchContainersForRootCauses(stateWithExtras.steps);
    if (causes) {
      return causes;
    }
  }

  return [];
}

/** Artifact structure used in blocks and steps */
type ArtifactEntry = { key: string; data: unknown; reason?: string };

/** Structure that may contain artifacts */
type WithArtifacts = { artifacts?: ArtifactEntry[] };

/**
 * Search artifacts array for a solution artifact.
 */
function findSolutionInArtifacts(
  artifacts: ArtifactEntry[]
): SolutionArtifact | null {
  for (const artifact of artifacts) {
    if (artifact.key === "solution") {
      const result = SolutionArtifactSchema.safeParse(artifact);
      if (result.success) {
        return result.data;
      }
    }
  }
  return null;
}

/**
 * Search artifacts for a solution-keyed entry and return its reason string.
 *
 * When Seer completes but cannot produce a code fix, the API may return
 * `{ key: "solution", data: null, reason: "..." }`. The full artifact
 * fails `SolutionArtifactSchema` validation (data is required), but the
 * `reason` field still carries useful context for the user.
 */
function findNoSolutionReason(artifacts: ArtifactEntry[]): string | undefined {
  for (const artifact of artifacts) {
    if (artifact.key === "solution" && artifact.reason) {
      return artifact.reason;
    }
  }
  return;
}

/**
 * Search containers (blocks or steps) for a no-solution reason in artifacts.
 */
function searchContainersForNoSolutionReason(
  containers: WithArtifacts[]
): string | undefined {
  for (const container of containers) {
    if (container.artifacts) {
      const reason = findNoSolutionReason(container.artifacts);
      if (reason) {
        return reason;
      }
    }
  }
  return;
}

/**
 * Search containers for a step-level no-solution reason.
 *
 * The current Seer API returns solution data directly on steps with
 * `key === "solution"`. When no fix is produced the step has an empty/missing
 * `solution` array but its `description` field carries the reason. This mirrors
 * {@link searchContainersForStepLevelSolution} for the no-solution path.
 */
function searchContainersForStepLevelNoSolutionReason(
  containers: StepWithSolution[]
): string | undefined {
  for (const container of containers) {
    if (
      container.key === "solution" &&
      (!container.solution || container.solution.length === 0) &&
      container.description
    ) {
      return container.description;
    }
  }
  return;
}

/**
 * Search an array of containers (blocks or steps) for a solution artifact.
 */
function searchContainersForSolution(
  containers: WithArtifacts[]
): SolutionArtifact | null {
  for (const container of containers) {
    if (container.artifacts) {
      const solution = findSolutionInArtifacts(container.artifacts);
      if (solution) {
        return solution;
      }
    }
  }
  return null;
}

/** Step-level solution item returned by the Seer API */
type StepSolutionItem = {
  title: string;
  code_snippet_and_analysis?: string;
  relevant_code_file?: { file_path: string | null; repo_name: string };
};

/** Step shape with passthrough fields for solution data */
type StepWithSolution = {
  key: string;
  description?: string;
  solution?: StepSolutionItem[];
};

/**
 * Search containers for step-level solution data.
 *
 * The Seer API returns solution data directly on steps with `key === "solution"`
 * rather than inside the `artifacts` array. This function finds such steps and
 * maps the data to the existing {@link SolutionArtifact} shape so downstream
 * formatters and commands don't need changes.
 */
function searchContainersForStepLevelSolution(
  containers: StepWithSolution[]
): SolutionArtifact | null {
  for (const container of containers) {
    if (
      container.key === "solution" &&
      container.solution &&
      container.solution.length > 0
    ) {
      return {
        key: "solution",
        data: {
          one_line_summary: container.description ?? "",
          steps: container.solution.map((item) => ({
            title: item.title,
            description: item.code_snippet_and_analysis ?? "",
          })),
        },
      };
    }
  }
  return null;
}

/**
 * Extract solution artifact from autofix state.
 *
 * Searches through blocks and steps for solution data. The Seer API may
 * return solution data in two formats:
 * 1. Step-level: `step.solution[]` array with `step.description` (current API)
 * 2. Artifact-level: `step.artifacts[]` with `key === "solution"` (legacy/fallback)
 *
 * Step-level data is checked first since it matches the current API response shape.
 *
 * @param state - Autofix state (may contain blocks or steps with solution data)
 * @returns SolutionArtifact if found, null otherwise
 */
export function extractSolution(state: AutofixState): SolutionArtifact | null {
  // Access blocks and steps from passthrough fields
  const stateWithExtras = state as AutofixState & {
    blocks?: (WithArtifacts & StepWithSolution)[];
    steps?: (WithArtifacts & StepWithSolution)[];
  };

  // Search blocks first (explorer mode / newer API)
  if (stateWithExtras.blocks) {
    const stepLevel = searchContainersForStepLevelSolution(
      stateWithExtras.blocks
    );
    if (stepLevel) {
      return stepLevel;
    }
    const artifactLevel = searchContainersForSolution(stateWithExtras.blocks);
    if (artifactLevel) {
      return artifactLevel;
    }
  }

  // Search steps (regular autofix API)
  if (stateWithExtras.steps) {
    const stepLevel = searchContainersForStepLevelSolution(
      stateWithExtras.steps
    );
    if (stepLevel) {
      return stepLevel;
    }
    const artifactLevel = searchContainersForSolution(stateWithExtras.steps);
    if (artifactLevel) {
      return artifactLevel;
    }
  }

  return null;
}

/**
 * Extract the reason why no solution was produced.
 *
 * Searches blocks and steps for a no-solution reason in two formats:
 * 1. Step-level: `step.key === "solution"` with an empty/missing `solution[]`
 *    and a `description` explaining why (current API).
 * 2. Artifact-level: `artifact.key === "solution"` with a `reason` field
 *    (legacy format, kept as fallback).
 *
 * Step-level is checked first to match {@link extractSolution}'s ordering.
 *
 * @param state - Autofix state (may contain blocks or steps with solution data)
 * @returns Reason string if found, undefined otherwise
 */
export function extractNoSolutionReason(
  state: AutofixState
): string | undefined {
  const stateWithExtras = state as AutofixState & {
    blocks?: (WithArtifacts & StepWithSolution)[];
    steps?: (WithArtifacts & StepWithSolution)[];
  };

  if (stateWithExtras.blocks) {
    const reason = findNoSolutionReasonInContainers(stateWithExtras.blocks);
    if (reason) {
      return reason;
    }
  }

  if (stateWithExtras.steps) {
    const reason = findNoSolutionReasonInContainers(stateWithExtras.steps);
    if (reason) {
      return reason;
    }
  }

  return;
}

/**
 * Resolve a no-solution reason for a single container list, preferring the
 * step-level `description` (current API) over the artifact-level `reason`
 * (legacy). Extracted to keep {@link extractNoSolutionReason} flat and within
 * the cognitive-complexity budget.
 */
function findNoSolutionReasonInContainers(
  containers: (WithArtifacts & StepWithSolution)[]
): string | undefined {
  const stepLevel = searchContainersForStepLevelNoSolutionReason(containers);
  if (stepLevel) {
    return stepLevel;
  }
  return searchContainersForNoSolutionReason(containers);
}

/**
 * Extract file paths examined during root cause analysis.
 *
 * Collects file paths from reproduction steps across all root causes.
 *
 * @param causes - Array of root causes from the autofix state
 * @returns Deduplicated array of file paths, or empty array if none found
 */
export function extractExaminedFiles(causes: RootCause[]): string[] {
  const files = new Set<string>();
  for (const cause of causes) {
    if (cause.root_cause_reproduction) {
      for (const step of cause.root_cause_reproduction) {
        const path = step.relevant_code_file?.file_path;
        if (path && path !== "N/A") {
          files.add(path);
        }
      }
    }
  }
  return [...files];
}
