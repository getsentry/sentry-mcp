import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../internal/tool-helpers/define";
import { apiServiceFromContext } from "../internal/tool-helpers/api";
import {
  ensureIssueWithinProjectConstraint,
  parseIssueParams,
} from "../internal/tool-helpers/issue";
import {
  getStatusDisplayName,
  isTerminalStatus,
  getHumanInterventionGuidance,
  getOutputForAutofixSection,
  getOrderedAutofixSections,
  hasSection,
  findCompletedSection,
  SEER_POLLING_INTERVAL,
  SEER_TIMEOUT,
  SEER_MAX_RETRIES,
  SEER_INITIAL_RETRY_DELAY,
  type AutofixSection,
} from "../internal/tool-helpers/seer";
import { retryWithBackoff } from "../internal/fetch-utils";
import type { ServerContext } from "../types";
import { ApiError, ApiServerError } from "../api-client/index";
import type {
  AutofixStep,
  AutofixRunState,
  SentryApiService,
} from "../api-client/index";
import {
  ParamOrganizationSlug,
  ParamRegionUrl,
  ParamIssueShortId,
  ParamIssueUrl,
} from "../schema";

const SHOULD_RETRY = (error: unknown) =>
  error instanceof ApiServerError || !(error instanceof ApiError);

async function fetchAutofixState({
  apiService,
  organizationSlug,
  issueId,
}: {
  apiService: SentryApiService;
  organizationSlug: string;
  issueId: string;
}): Promise<AutofixRunState> {
  return retryWithBackoff(
    () => apiService.getAutofixState({ organizationSlug, issueId }),
    {
      maxRetries: SEER_MAX_RETRIES,
      initialDelay: SEER_INITIAL_RETRY_DELAY,
      shouldRetry: SHOULD_RETRY,
    },
  );
}

interface StepWaitResult {
  state: AutofixRunState;
  outcome: "completed" | "timeout" | "needs_input" | "errored";
  section?: AutofixSection;
}

/**
 * Polls the explorer endpoint until `targetStep` reports `completed` (or the
 * run hits a terminal state for a different reason). The function uses the
 * same retry/back-off behavior as the previous step polling loop.
 */
async function waitForSection({
  apiService,
  organizationSlug,
  issueId,
  targetStep,
  initialState,
}: {
  apiService: SentryApiService;
  organizationSlug: string;
  issueId: string;
  targetStep: AutofixStep;
  initialState: AutofixRunState;
}): Promise<StepWaitResult> {
  let state = initialState;
  const startTime = Date.now();

  while (Date.now() - startTime < SEER_TIMEOUT) {
    if (!state.autofix) {
      return { state, outcome: "errored" };
    }

    const sections = getOrderedAutofixSections(state.autofix);
    const section = findCompletedSection(sections, targetStep);
    if (section) {
      return { state, outcome: "completed", section };
    }

    if (state.autofix.status === "awaiting_user_input") {
      return { state, outcome: "needs_input" };
    }
    if (state.autofix.status === "error") {
      return { state, outcome: "errored" };
    }
    if (
      state.autofix.status === "completed" &&
      !hasSection(sections, targetStep)
    ) {
      // Run completed without ever producing the target section.
      return { state, outcome: "errored" };
    }

    await new Promise((resolve) => setTimeout(resolve, SEER_POLLING_INTERVAL));

    try {
      state = await fetchAutofixState({
        apiService,
        organizationSlug,
        issueId,
      });
    } catch {
      // Swallow transient errors and let the loop retry; retryWithBackoff has
      // already exhausted retries before giving up.
    }
  }

  return { state, outcome: "timeout" };
}

function renderRunInstructions({
  issueUrl,
  organizationSlug,
  issueId,
}: {
  issueUrl: string | undefined;
  organizationSlug: string;
  issueId: string;
}): string {
  if (issueUrl) {
    return `analyze_issue_with_seer(issueUrl="${issueUrl}")`;
  }
  return `analyze_issue_with_seer(organizationSlug="${organizationSlug}", issueId="${issueId}")`;
}

export default defineTool({
  name: "analyze_issue_with_seer",
  skills: ["seer"],
  requiredScopes: [],
  description: [
    "Use Seer to analyze production errors and get detailed root cause analysis with specific code fixes.",
    "",
    "Use this tool when:",
    "- The user explicitly asks for root cause analysis, Seer analysis, or help fixing/debugging an issue",
    "- You are unable to accurately determine the root cause from the issue details alone",
    "",
    "Do NOT call this tool as an automatic follow-up to get_sentry_resource.",
    "",
    "What this tool provides:",
    "- Root cause analysis with code-level explanations",
    "- A proposed solution with concrete steps",
    "- Pointers to file locations relevant to the fix",
    "",
    "This tool automatically:",
    "1. Checks if analysis already exists (instant results)",
    "2. Runs the root cause step, then the solution step (~2-5 minutes total)",
    "3. Returns complete fix recommendations",
    "",
    "<examples>",
    '### User: "Run Seer on this issue"',
    "",
    "```",
    "analyze_issue_with_seer(issueUrl='https://my-org.sentry.io/issues/PROJECT-1Z43')",
    "```",
    "",
    '### User: "Analyze this issue and suggest a fix"',
    "",
    "```",
    "analyze_issue_with_seer(organizationSlug='my-organization', issueId='ERROR-456')",
    "```",
    "</examples>",
    "",
    "<hints>",
    "- Only use when the user explicitly requests analysis or you cannot determine the root cause from issue details alone",
    "- If the user provides an issueUrl, extract it and use that parameter alone",
    "- The analysis includes actual code snippets and fixes, not just error descriptions",
    "- Results are cached - subsequent calls return instantly",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug.optional(),
    regionUrl: ParamRegionUrl.nullable().default(null),
    issueId: ParamIssueShortId.optional(),
    issueUrl: ParamIssueUrl.optional(),
    instruction: z
      .string()
      .describe("Optional custom instruction for the AI analysis")
      .optional(),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl ?? undefined,
    });
    const { organizationSlug: orgSlug, issueId: parsedIssueId } =
      parseIssueParams({
        organizationSlug: params.organizationSlug,
        issueId: params.issueId,
        issueUrl: params.issueUrl,
      });

    setTag("organization.slug", orgSlug);

    await ensureIssueWithinProjectConstraint({
      apiService,
      organizationSlug: orgSlug,
      issueId: parsedIssueId!,
      projectSlug: context.constraints.projectSlug,
    });

    const issueId = parsedIssueId!;
    const retryHint = renderRunInstructions({
      issueUrl: params.issueUrl,
      organizationSlug: orgSlug,
      issueId,
    });

    let output = `# Seer Analysis for Issue ${issueId}\n\n`;

    let state = await fetchAutofixState({
      apiService,
      organizationSlug: orgSlug,
      issueId,
    });

    let runId: number | undefined = state.autofix?.run_id;
    if (state.autofix) {
      output += `Found existing analysis (Run ID: ${state.autofix.run_id})\n\n`;
    } else {
      output += `Starting new analysis...\n\n`;
      const startResult = await apiService.startAutofix({
        organizationSlug: orgSlug,
        issueId,
        step: "root_cause",
        userContext: params.instruction,
      });
      runId = startResult.run_id;
      output += `Analysis started with Run ID: ${runId}\n\n`;

      // Give the run a moment to register before the first poll.
      await new Promise((resolve) => setTimeout(resolve, 1000));

      state = await fetchAutofixState({
        apiService,
        organizationSlug: orgSlug,
        issueId,
      });
    }

    // Drive the explorer flow: root_cause → solution. Each step waits for its
    // own section to land before kicking off the next one.
    const stepsToRun: AutofixStep[] = ["root_cause", "solution"];

    for (const step of stepsToRun) {
      const sections = state.autofix
        ? getOrderedAutofixSections(state.autofix)
        : [];

      // If the section already exists and is completed, skip ahead.
      if (findCompletedSection(sections, step)) {
        continue;
      }

      // If the section hasn't been started yet, ask the server to start it.
      // (For `root_cause` on a fresh run we already issued the POST above; this
      // covers the existing-run case where solution hasn't run yet.)
      if (!hasSection(sections, step) && runId !== undefined) {
        // Don't POST a follow-up step against a run that already settled.
        // For example, an existing run with `status: "error"` and only a
        // completed `root_cause` section should not have `solution` kicked
        // off — render what's there and exit.
        if (state.autofix && state.autofix.status !== "processing") {
          output += await renderPartialOutput({
            state,
            retryHint,
            timedOut: false,
          });
          return output;
        }

        try {
          await apiService.startAutofix({
            organizationSlug: orgSlug,
            issueId,
            step,
            runId,
          });
          await new Promise((resolve) => setTimeout(resolve, 1000));
          state = await fetchAutofixState({
            apiService,
            organizationSlug: orgSlug,
            issueId,
          });
        } catch (error) {
          output += `\n## Error During Analysis\n\n`;
          output += `Unable to start the ${step.replace(/_/g, " ")} step.\n`;
          output += `Error: ${error instanceof Error ? error.message : String(error)}\n\n`;
          output += `You can retry by running:\n\`\`\`\n${retryHint}\n\`\`\`\n`;
          return output;
        }
      }

      const waitResult = await waitForSection({
        apiService,
        organizationSlug: orgSlug,
        issueId,
        targetStep: step,
        initialState: state,
      });

      state = waitResult.state;

      if (waitResult.outcome === "timeout") {
        output += await renderPartialOutput({
          state,
          retryHint,
          timedOut: true,
        });
        return output;
      }

      if (waitResult.outcome === "needs_input") {
        output += await renderPartialOutput({
          state,
          retryHint,
          timedOut: false,
        });
        return output;
      }

      if (waitResult.outcome === "errored") {
        output += `\n## Error During Analysis\n\n`;
        const status = state.autofix?.status ?? "error";
        output += `Run ended in status: ${status}\n\n`;
        output += `You can retry by running:\n\`\`\`\n${retryHint}\n\`\`\`\n`;
        return output;
      }
    }

    if (!state.autofix) {
      output += `\nError: Analysis state lost. Please try again by running:\n\`\`\`\n${retryHint}\n\`\`\`\n`;
      return output;
    }

    output += `## Analysis ${getStatusDisplayName(state.autofix.status)}\n\n`;
    const sections = getOrderedAutofixSections(state.autofix);
    const pullRequests = Object.values(state.autofix.repo_pr_states ?? {});
    for (const section of sections) {
      output += getOutputForAutofixSection(section, {
        runId: state.autofix.run_id,
        pullRequests,
      });
      output += "\n";
    }
    if (
      isTerminalStatus(state.autofix.status) &&
      state.autofix.status !== "completed"
    ) {
      output += `\n**Status**: ${state.autofix.status}\n`;
      output += getHumanInterventionGuidance(state.autofix.status);
    }

    return output;
  },
});

async function renderPartialOutput({
  state,
  retryHint,
  timedOut,
}: {
  state: AutofixRunState;
  retryHint: string;
  timedOut: boolean;
}): Promise<string> {
  let output = "";
  if (state.autofix) {
    output += `**Current Status**: ${getStatusDisplayName(state.autofix.status)}\n\n`;
    const sections = getOrderedAutofixSections(state.autofix);
    const pullRequests = Object.values(state.autofix.repo_pr_states ?? {});
    for (const section of sections) {
      output += getOutputForAutofixSection(section, {
        runId: state.autofix.run_id,
        pullRequests,
      });
      output += "\n";
    }
  }

  if (timedOut) {
    output += `\n## Analysis Timed Out\n\n`;
    output += `The analysis is taking longer than expected (>${SEER_TIMEOUT / 1000}s).\n\n`;
  } else if (state.autofix?.status === "awaiting_user_input") {
    output += getHumanInterventionGuidance(state.autofix.status);
  }

  output += `\nYou can check the status later by running the same command again:\n`;
  output += `\`\`\`\n${retryHint}\n\`\`\`\n`;
  return output;
}
