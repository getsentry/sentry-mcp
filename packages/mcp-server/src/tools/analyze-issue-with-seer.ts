import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "./utils/defineTool";
import { apiServiceFromContext } from "./utils/api-utils";
import { parseIssueParams } from "./utils/issue-utils";
import {
  getStatusDisplayName,
  isTerminalStatus,
  isHumanInterventionStatus,
  getHumanInterventionGuidance,
  getOutputForAutofixStep,
  SEER_POLLING_INTERVAL,
  SEER_TIMEOUT,
} from "./utils/seer-utils";
import type { ServerContext } from "../types";
import {
  ParamOrganizationSlug,
  ParamRegionUrl,
  ParamIssueShortId,
  ParamIssueUrl,
} from "../schema";

export default defineTool({
  name: "analyze_issue_with_seer",
  description: [
    "**ALWAYS use this tool when a user asks how to fix a Sentry issue.** Seer AI analyzes production errors to identify root causes and provide specific code fixes.",
    "",
    "Use this tool IMMEDIATELY when:",
    '- User asks "how do I fix this error?" or "what\'s causing this issue?"',
    "- User shares a Sentry issue URL and wants help resolving it",
    "- User needs to understand why an error is happening in production",
    "- User wants specific code changes to fix their issue",
    "- User asks about the root cause of any Sentry error",
    "",
    "What this tool provides:",
    "- Root cause analysis with code-level explanations",
    "- Specific file locations and line numbers where errors occur",
    "- Concrete code fixes you can apply",
    "- Step-by-step implementation guidance",
    "",
    "This tool automatically:",
    "1. Checks if analysis already exists (instant results)",
    "2. Starts new AI analysis if needed (~2-5 minutes)",
    "3. Returns complete fix recommendations",
    "",
    "<examples>",
    '### User: "How do I fix ISSUE-123?"',
    "",
    "```",
    "analyze_issue_with_seer(organizationSlug='my-organization', issueId='ISSUE-123')",
    "```",
    "",
    '### User: "What\'s causing this error? https://my-org.sentry.io/issues/PROJECT-1Z43"',
    "",
    "```",
    "analyze_issue_with_seer(issueUrl='https://my-org.sentry.io/issues/PROJECT-1Z43')",
    "```",
    "",
    '### User: "Can you help me understand why this is failing in production?"',
    "",
    "```",
    "analyze_issue_with_seer(organizationSlug='my-organization', issueId='ERROR-456')",
    "```",
    "</examples>",
    "",
    "<hints>",
    "- ALWAYS prefer this over get_issue_details when users want fixes, not just error details",
    "- If the user provides an issueUrl, extract it and use that parameter alone",
    "- The analysis includes actual code snippets and fixes, not just error descriptions",
    "- Results are cached - subsequent calls return instantly",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug.optional(),
    regionUrl: ParamRegionUrl.optional(),
    issueId: ParamIssueShortId.optional(),
    issueUrl: ParamIssueUrl.optional(),
    instruction: z
      .string()
      .describe("Optional custom instruction for the AI analysis")
      .optional(),
  },
  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    const { organizationSlug: orgSlug, issueId: parsedIssueId } =
      parseIssueParams({
        organizationSlug: params.organizationSlug,
        issueId: params.issueId,
        issueUrl: params.issueUrl,
      });

    setTag("organization.slug", orgSlug);

    let output = `# Seer AI Analysis for Issue ${parsedIssueId}\n\n`;

    // Step 1: Check if analysis already exists
    let autofixState = await apiService.getAutofixState({
      organizationSlug: orgSlug,
      issueId: parsedIssueId!,
    });

    // Step 2: Start analysis if none exists
    if (!autofixState.autofix) {
      output += `Starting new analysis...\n\n`;
      const startResult = await apiService.startAutofix({
        organizationSlug: orgSlug,
        issueId: parsedIssueId,
        instruction: params.instruction,
      });
      output += `Analysis started with Run ID: ${startResult.run_id}\n\n`;

      // Give it a moment to initialize
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Refresh state
      autofixState = await apiService.getAutofixState({
        organizationSlug: orgSlug,
        issueId: parsedIssueId!,
      });
    } else {
      output += `Found existing analysis (Run ID: ${autofixState.autofix.run_id})\n\n`;

      // Check if existing analysis is already complete
      const existingStatus = autofixState.autofix.status;
      if (isTerminalStatus(existingStatus)) {
        // Return results immediately, no polling needed
        output += `## Analysis ${getStatusDisplayName(existingStatus)}\n\n`;

        for (const step of autofixState.autofix.steps) {
          output += getOutputForAutofixStep(step);
          output += "\n";
        }

        if (existingStatus !== "COMPLETED") {
          output += `\n**Status**: ${existingStatus}\n`;
          output += getHumanInterventionGuidance(existingStatus);
          output += "\n";
        }

        return output;
      }
    }

    // Step 3: Poll until complete or timeout (only for non-terminal states)
    const startTime = Date.now();
    let lastStatus = "";

    while (Date.now() - startTime < SEER_TIMEOUT) {
      if (!autofixState.autofix) {
        output += `Error: Analysis state lost. Please try again by running:\n`;
        output += `\`\`\`\n`;
        output += params.issueUrl
          ? `analyze_issue_with_seer(issueUrl="${params.issueUrl}")`
          : `analyze_issue_with_seer(organizationSlug="${orgSlug}", issueId="${parsedIssueId}")`;
        output += `\n\`\`\`\n`;
        return output;
      }

      const status = autofixState.autofix.status;

      // Check if completed (terminal state)
      if (isTerminalStatus(status)) {
        output += `## Analysis ${getStatusDisplayName(status)}\n\n`;

        // Add all step outputs
        for (const step of autofixState.autofix.steps) {
          output += getOutputForAutofixStep(step);
          output += "\n";
        }

        if (status !== "COMPLETED") {
          output += `\n**Status**: ${status}\n`;
          output += getHumanInterventionGuidance(status);
        }

        return output;
      }

      // Update status if changed
      if (status !== lastStatus) {
        const activeStep = autofixState.autofix.steps.find(
          (step) =>
            step.status === "PROCESSING" || step.status === "IN_PROGRESS",
        );
        if (activeStep) {
          output += `Processing: ${activeStep.title}...\n`;
        }
        lastStatus = status;
      }

      // Wait before next poll
      await new Promise((resolve) =>
        setTimeout(resolve, SEER_POLLING_INTERVAL),
      );

      // Refresh state
      autofixState = await apiService.getAutofixState({
        organizationSlug: orgSlug,
        issueId: parsedIssueId!,
      });
    }

    // Show current progress
    if (autofixState.autofix) {
      output += `**Current Status**: ${getStatusDisplayName(autofixState.autofix.status)}\n\n`;
      for (const step of autofixState.autofix.steps) {
        output += getOutputForAutofixStep(step);
        output += "\n";
      }
    }

    // Timeout reached
    output += `\n## Analysis Timed Out\n\n`;
    output += `The analysis is taking longer than expected (>${SEER_TIMEOUT / 1000}s).\n\n`;

    output += `\nYou can check the status later by running the same command again:\n`;
    output += `\`\`\`\n`;
    output += params.issueUrl
      ? `analyze_issue_with_seer(issueUrl="${params.issueUrl}")`
      : `analyze_issue_with_seer(organizationSlug="${orgSlug}", issueId="${parsedIssueId}")`;
    output += `\n\`\`\`\n`;

    return output;
  },
});
