import { setTag } from "@sentry/core";
import { z } from "zod";
import {
  AgenticOnboardingRunStatusUpdateSchema,
  AgenticOnboardingStageSchema,
  AgenticOnboardingStageStatusUpdateSchema,
  AgenticOnboardingStatusUpdateSchema,
} from "../../api-client/schema";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import { defineTool } from "../../internal/tool-helpers/define";
import { ParamOrganizationSlug, ParamRegionUrl } from "../../schema";
import { ALL_SKILLS } from "../../skills";
import type { ServerContext } from "../../types";

export default defineTool({
  name: "onboarding_status_update",
  skills: ALL_SKILLS,
  includeInSkillDefinitions: false,
  requiredScopes: ["org:read"],
  description: [
    "Update the progress shown in Sentry's agentic onboarding UI.",
    "",
    "Use this tool only when the Sentry getting started skill provides a run token. Call it at the workflow boundaries described by that skill.",
    "",
    "<hints>",
    "- Progress updates are operational UI state, not user analytics.",
    "- Keep eventNote brief and limited to context useful in the progress UI.",
    "- Do not include source code, repository paths, credentials, error output, or other sensitive data.",
    "- status is required for every update.",
    "- Set runStatus to completed or failed only when the entire onboarding run reaches that state.",
    "- A failed status requires a brief eventNote explaining the failure.",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    regionUrl: ParamRegionUrl.nullable().default(null),
    runToken: AgenticOnboardingStatusUpdateSchema.shape.runToken.describe(
      "The 10-character onboarding run token supplied by Sentry.",
    ),
    stage: AgenticOnboardingStageSchema.describe(
      "The onboarding stage being updated.",
    ),
    status: AgenticOnboardingStageStatusUpdateSchema.describe(
      "The stage's current status.",
    ),
    runStatus: AgenticOnboardingRunStatusUpdateSchema.optional().describe(
      "Set only when the entire onboarding run has completed or failed.",
    ),
    eventNote: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .optional()
      .describe(
        "Short context to display with this progress event. Required when status is failed.",
      ),
    projectSlugs:
      AgenticOnboardingStatusUpdateSchema.shape.projectSlugs.describe(
        "Validated Sentry project slugs. Send only for create_project. Values accumulate across updates; include each project as it becomes usable while active, then all known projects when completed.",
      ),
    issueIds: AgenticOnboardingStatusUpdateSchema.shape.issueIds.describe(
      "Validated Sentry issue IDs returned by MCP. Send only for receive_verification_error. Values accumulate across updates; include each matching issue as it is confirmed, then all known issues when completed.",
    ),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl ?? context.constraints.regionUrl ?? undefined,
    });

    setTag("organization.slug", params.organizationSlug);

    const run = await apiService.updateAgenticOnboardingStatus({
      organizationSlug: params.organizationSlug,
      update: {
        schemaVersion: 1,
        runToken: params.runToken,
        stage: params.stage,
        status: params.status,
        ...(params.runStatus ? { runStatus: params.runStatus } : {}),
        ...(params.eventNote ? { eventNote: params.eventNote } : {}),
        ...(params.projectSlugs ? { projectSlugs: params.projectSlugs } : {}),
        ...(params.issueIds ? { issueIds: params.issueIds } : {}),
      },
    });

    return `Onboarding status updated. Continue updates: ${run.continueUpdates ? "yes" : "no"}.`;
  },
});
