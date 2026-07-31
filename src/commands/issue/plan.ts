/**
 * sentry issue plan
 *
 * Generate a solution plan for a Sentry issue using Seer AI.
 * Automatically runs root cause analysis if not already done.
 */

import type { SentryContext } from "../../context.js";
import { triggerSolutionPlanning } from "../../lib/api-client.js";
import { buildCommand } from "../../lib/command.js";
import { ApiError } from "../../lib/errors.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import {
  formatSolution,
  handleSeerApiError,
} from "../../lib/formatters/seer.js";
import {
  applyFreshFlag,
  FRESH_ALIASES,
  FRESH_FLAG,
} from "../../lib/list-command.js";
import { logger } from "../../lib/logger.js";
import {
  type AutofixState,
  extractExaminedFiles,
  extractNoSolutionReason,
  extractRootCauses,
  extractSolution,
  requireAutofixRunId,
  type SolutionArtifact,
} from "../../types/seer.js";
import {
  ensureRootCauseAnalysis,
  issueIdPositional,
  pollAutofixState,
  resolveOrgAndIssueId,
} from "./utils.js";

type PlanFlags = {
  readonly json: boolean;
  readonly force: boolean;
  readonly fresh: boolean;
  readonly fields?: string[];
};

/** Context about why no solution was produced */
type NoSolutionContext = {
  /** Seer's reason for not producing a solution (from the artifact) */
  reason?: string;
  /** Root cause description that was analyzed */
  root_cause?: string;
  /** Files Seer examined during analysis */
  files_examined?: string[];
};

/** Return type for issue plan — includes state metadata and solution data */
type PlanData = {
  run_id: string | number;
  status: string;
  /** The solution data (without the artifact wrapper). Null when no solution is available. */
  solution: SolutionArtifact["data"] | null;
  /** Context about why no solution was produced. Only present when solution is null. */
  no_solution_context?: NoSolutionContext;
};

/**
 * Format solution plan data for human-readable terminal output.
 *
 * Returns the formatted solution, or a contextual message explaining
 * why no solution was produced.
 */
function formatPlanOutput(data: PlanData): string {
  if (data.solution) {
    return formatSolution({ key: "solution", data: data.solution });
  }

  const lines: string[] = [];
  const ctx = data.no_solution_context;

  if (ctx?.reason) {
    lines.push(`No solution found: ${ctx.reason}`);
  } else {
    lines.push(
      "No solution found. Seer completed analysis but could not identify a code fix."
    );
    if (ctx?.root_cause) {
      lines.push("");
      lines.push(`Root cause analyzed: ${ctx.root_cause}`);
    }
  }

  if (ctx?.files_examined && ctx.files_examined.length > 0) {
    lines.push("");
    lines.push("Files examined:");
    for (const file of ctx.files_examined) {
      lines.push(`  ${file}`);
    }
  }

  return lines.join("\n");
}

/**
 * Gather context about why Seer produced no solution.
 *
 * Returns undefined when there's nothing useful to report.
 */
function buildNoSolutionContext(
  state: AutofixState
): NoSolutionContext | undefined {
  const reason = extractNoSolutionReason(state);
  const cause = extractRootCauses(state)[0];
  const files = cause ? extractExaminedFiles([cause]) : [];

  if (!(reason || cause?.description) && files.length === 0) {
    return;
  }

  const ctx: NoSolutionContext = {};
  if (reason) {
    ctx.reason = reason;
  }
  if (cause?.description) {
    ctx.root_cause = cause.description;
  }
  if (files.length > 0) {
    ctx.files_examined = files;
  }
  return ctx;
}

/**
 * Build the plan data object from autofix state.
 *
 * Stores `solution.data` (not the full artifact) to keep the JSON shape flat —
 * consumers get `{ run_id, status, solution: { one_line_summary, steps, ... } }`.
 *
 * When no solution is available, includes context about why (reason from the
 * API, root cause description, and files examined) so the user isn't left
 * with a bare "no solution found" message.
 */
function buildPlanData(state: AutofixState): PlanData {
  const solution = extractSolution(state);
  const data: PlanData = {
    run_id: requireAutofixRunId(state),
    status: state.status,
    solution: solution?.data ?? null,
  };

  if (!solution) {
    data.no_solution_context = buildNoSolutionContext(state);
  }

  return data;
}

export const planCommand = buildCommand({
  docs: {
    brief: "Generate a solution plan using Seer AI",
    fullDescription:
      "Generate a solution plan for a Sentry issue using Seer AI.\n\n" +
      "This command automatically runs root cause analysis if needed, then " +
      "generates a solution plan with specific implementation steps to fix the issue.\n\n" +
      "Use --force to regenerate a plan even if one already exists.\n\n" +
      "Issue formats:\n" +
      "  @latest          - Most recent unresolved issue\n" +
      "  @most_frequent   - Issue with highest event frequency\n" +
      "  <org>/ID         - Explicit org: sentry/EXTENSION-7, sentry/cli-G\n" +
      "  <org>/@selector  - Selector with org: my-org/@latest\n" +
      "  <project>-suffix - Project + suffix: cli-G, spotlight-electron-4Y\n" +
      "  ID               - Short ID: CLI-G (searches across orgs)\n" +
      "  suffix           - Suffix only: G (requires DSN context)\n" +
      "  numeric          - Numeric ID: 123456789\n\n" +
      "Prerequisites:\n" +
      "  - GitHub integration configured for your organization\n" +
      "  - Code mappings set up for your project\n\n" +
      "Examples:\n" +
      "  sentry issue plan @latest\n" +
      "  sentry issue plan 123456789\n" +
      "  sentry issue plan sentry/EXTENSION-7\n" +
      "  sentry issue plan cli-G\n" +
      "  sentry issue plan 123456789 --force",
  },
  output: {
    human: formatPlanOutput,
  },
  parameters: {
    positional: issueIdPositional,
    flags: {
      force: {
        kind: "boolean",
        brief: "Force new plan even if one exists",
        default: false,
      },
      fresh: FRESH_FLAG,
    },
    aliases: FRESH_ALIASES,
  },
  async *func(this: SentryContext, flags: PlanFlags, issueArg: string) {
    applyFreshFlag(flags);
    const { cwd } = this;

    let resolvedOrg: string | undefined;

    try {
      const { org, issueId: numericId } = await resolveOrgAndIssueId({
        issueArg,
        cwd,
        command: "plan",
      });
      resolvedOrg = org;

      // Ensure root cause analysis exists (runs explain if needed)
      const state = await ensureRootCauseAnalysis({
        org,
        issueId: numericId,
        json: flags.json,
      });

      // Check if solution already exists (skip if --force)
      if (!flags.force) {
        const existingSolution = extractSolution(state);
        if (existingSolution) {
          return yield new CommandOutput(buildPlanData(state));
        }
      }

      // Trigger solution planning
      const causes = extractRootCauses(state);
      if (!flags.json && causes.length > 0) {
        const log = logger.withTag("issue.plan");
        const cause = causes[0];
        if (cause) {
          log.info("Creating plan...");
          log.info(`"${cause.description}"`);
        }
      }

      await triggerSolutionPlanning(org, numericId, requireAutofixRunId(state));

      // Poll until solution is ready or terminal
      const finalState = await pollAutofixState({
        orgSlug: org,
        issueId: numericId,
        json: flags.json,
        stopOnWaitingForUser: true,
        timeoutMessage:
          "Plan creation timed out after 6 minutes. Try again or check the issue in Sentry web UI.",
        timeoutHint:
          "The plan may still be generated in the background.\n" +
          `  Or retry: sentry issue plan ${issueArg}`,
      });

      if (finalState.status === "ERROR") {
        throw new Error(
          "Plan creation failed. Check the Sentry web UI for details."
        );
      }

      if (finalState.status === "CANCELLED") {
        throw new Error("Plan creation was cancelled.");
      }

      return yield new CommandOutput(buildPlanData(finalState));
    } catch (error) {
      if (error instanceof ApiError) {
        throw handleSeerApiError(error.status, error.detail, resolvedOrg);
      }
      throw error;
    }
  },
});
