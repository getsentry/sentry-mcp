import { setTag } from "@sentry/core";
import { z } from "zod";
import type { AlertRuleUpdate, IssueAlertRule } from "../../api-client/types";
import { UserInputError } from "../../errors";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import { defineTool } from "../../internal/tool-helpers/define";
import { structuredResult } from "../../internal/tool-helpers/results";
import { isPlainObject } from "../../internal/type-guards";
import {
  ParamOrganizationSlug,
  ParamProjectSlug,
  ParamRegionUrl,
} from "../../schema";
import type { ServerContext } from "../../types";
import {
  alertRuleSummarySchema,
  ParamAlertActionFilters,
  ParamAlertTriggers,
  toAlertRuleSummary,
} from "./support/alert-rule-config";
import { isNumericAlertRuleId } from "./support/alerts";
import {
  assertProjectConstraintEvidence,
  assertProjectRefWithinConstraint,
} from "./support/project-constraints";

// Owns workflow edits; monitor connections stay unchanged and project-scoped writes must be exclusive.

export const updateAlertRuleOutputSchema = z.object({
  alertRule: alertRuleSummarySchema,
});

/** Preserve copied actions while asking Sentry to resolve a renamed Slack destination. */
function resolveChangedSlackDestinations(
  groups: z.infer<typeof ParamAlertActionFilters>,
  current: IssueAlertRule,
): z.infer<typeof ParamAlertActionFilters> {
  const previousActions = (current.actionFilters ?? []).flatMap((group) =>
    Array.isArray(group.actions) ? group.actions.filter(isPlainObject) : [],
  );
  return groups.map((group) => ({
    ...group,
    actions: group.actions.map((action) => {
      const previous = previousActions.find(
        (candidate) =>
          action.id !== undefined && String(candidate.id) === String(action.id),
      );
      if (
        action.type !== "slack" ||
        !previous ||
        !isPlainObject(previous.config) ||
        typeof action.config.targetDisplay !== "string" ||
        action.config.targetDisplay.length === 0 ||
        action.config.targetDisplay === previous.config.targetDisplay ||
        action.config.targetIdentifier !== previous.config.targetIdentifier
      ) {
        return action;
      }
      // A copied channel ID would keep routing to the old destination. Let Sentry resolve the new name.
      const config = { ...action.config };
      delete config.targetIdentifier;
      return { ...action, config };
    }),
  }));
}

export default defineTool({
  name: "update_alert_rule",
  skills: ["project-management"],
  requiredScopes: ["org:read", "project:read", "alerts:write"],
  description: [
    "Update an existing Sentry Alert (workflow), including its Slack notification destination.",
    "Use get_alert_rule with kind='issue' first to inspect the complete triggers and actionFilters configuration.",
    "Omit fields to leave them unchanged. Pass null to clear owner or environment.",
    "triggers replaces the trigger conditions. actionFilters replaces ALL action groups: copy the complete configuration, retain existing IDs, and change only the intended values. Omitted groups, conditions, and actions are removed.",
    "For a Slack action, change config.targetDisplay to the channel name. An unchanged old targetIdentifier is cleared so Sentry resolves the new channel using the existing integrationId. You may also supply the new channel's targetIdentifier explicitly.",
    "This edits notification alerts, not Metric Monitor detection queries or thresholds. It does not change connected monitors.",
    "A project-constrained session can only edit alerts affecting that project exclusively.",
    "Be careful when using this tool! Requires an API token with alerts:write; reconnect OAuth if the existing token lacks it.",
    "<examples>",
    "update_alert_rule(organizationSlug='my-org', ruleIdOrName='12345', status='disabled')",
    "update_alert_rule(organizationSlug='my-org', projectSlug='backend', ruleIdOrName='Notify backend team', frequencyMinutes=30)",
    "</examples>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    regionUrl: ParamRegionUrl.nullable().default(null),
    projectSlug: ParamProjectSlug.nullable().optional(),
    ruleIdOrName: z
      .string()
      .trim()
      .min(1)
      .describe(
        "Workflow ID, or exact alert name with projectSlug. Use IDs from get_alert_rule(kind='issue').",
      ),
    name: z.string().trim().min(1).max(256).optional(),
    status: z.enum(["active", "disabled"]).optional(),
    frequencyMinutes: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Minimum interval between notifications, in minutes."),
    environment: z.string().min(1).nullable().optional(),
    owner: z
      .string()
      .regex(/^(user|team):\d+$/)
      .nullable()
      .optional()
      .describe("Owner actor user:ID or team:ID. Pass null to clear."),
    triggers: ParamAlertTriggers.optional(),
    actionFilters: ParamAlertActionFilters.optional(),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  outputSchema: updateAlertRuleOutputSchema,
  async handler(params, context: ServerContext) {
    if (
      [
        params.name,
        params.status,
        params.frequencyMinutes,
        params.environment,
        params.owner,
        params.triggers,
        params.actionFilters,
      ].every((value) => value === undefined)
    ) {
      throw new UserInputError(
        "Provide at least one field to update on the alert rule.",
      );
    }
    if (params.projectSlug) {
      assertProjectRefWithinConstraint({
        resourceLabel: "Alert rule",
        scopedProjectSlug: context.constraints.projectSlug,
        project: { slug: params.projectSlug },
      });
    }
    const projectSlug = context.constraints.projectSlug ?? params.projectSlug;
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl ?? undefined,
    });
    const organizationSlug = params.organizationSlug;
    setTag("organization.slug", organizationSlug);
    let ruleId = params.ruleIdOrName;
    if (!isNumericAlertRuleId(ruleId)) {
      if (!projectSlug) {
        throw new UserInputError(
          "projectSlug is required to update an alert by name. Alternatively, provide its numeric workflow ID.",
        );
      }
      const page = await apiService.listIssueAlertRulesPage({
        organizationSlug,
        projectSlug,
        query: ruleId,
        limit: 100,
      });
      const matches = page.rules.filter(
        (rule) => rule.name.toLowerCase() === ruleId.toLowerCase(),
      );
      if (page.nextCursor || matches.length > 1) {
        throw new UserInputError(
          "The alert name cannot be resolved unambiguously. Retry with the numeric workflow ID from get_alert_rule.",
        );
      }
      if (matches.length === 0) {
        throw new UserInputError(
          `Alert rule "${ruleId}" was not found in project ${projectSlug}.`,
        );
      }
      ruleId = String(matches[0].id);
    }
    const current = await apiService.getAlertRule({ organizationSlug, ruleId });
    if (projectSlug) {
      const [project, scope] = await Promise.all([
        apiService.getProject({
          organizationSlug,
          projectSlugOrId: projectSlug,
        }),
        apiService.getAlertRuleProjectScope({ organizationSlug, ruleId }),
      ]);
      assertProjectConstraintEvidence({
        resourceLabel: "Alert rule",
        scopedProjectSlug: context.constraints.projectSlug,
        hasEvidence:
          !scope.includesAllProjects &&
          scope.projectIds.length > 0 &&
          scope.projectIds.every((id) => id === String(project.id)),
      });
      if (
        !scope.includesAllProjects &&
        !scope.projectIds.includes(String(project.id))
      ) {
        throw new UserInputError(
          `Alert rule is outside project "${projectSlug}".`,
        );
      }
    }
    if (typeof current.enabled !== "boolean") {
      throw new Error(
        "Sentry returned an alert without its enabled state; refusing to update it.",
      );
    }
    // The workflow API defaults enabled to true even on PUT, so always preserve it explicitly.
    const body: AlertRuleUpdate = {
      name: params.name ?? current.name,
      enabled:
        params.status === undefined
          ? current.enabled
          : params.status === "active",
    };
    if (params.frequencyMinutes !== undefined)
      body.config = { ...current.config, frequency: params.frequencyMinutes };
    if (params.environment !== undefined) body.environment = params.environment;
    if (params.owner !== undefined) body.owner = params.owner;
    if (params.triggers !== undefined) body.triggers = params.triggers;
    if (params.actionFilters !== undefined)
      body.actionFilters = resolveChangedSlackDestinations(
        params.actionFilters,
        current,
      );
    const updated = await apiService.updateAlertRule({
      organizationSlug,
      ruleId,
      body,
    });
    const alertRule = toAlertRuleSummary(
      updated,
      apiService.getIssueAlertRuleUrl(organizationSlug, updated.id),
    );
    // Slack lookup timeouts can be saved by Sentry with an empty channel ID despite HTTP 200.
    if (
      params.actionFilters !== undefined &&
      alertRule.actionFilters?.some((group) =>
        group.actions?.some(
          (action) =>
            action.type === "slack" &&
            (typeof action.config?.targetIdentifier !== "string" ||
              action.config.targetIdentifier.length === 0),
        ),
      )
    ) {
      throw new UserInputError(
        "The alert was saved, but Sentry did not resolve a Slack destination. Read the alert again and retry with both the channel name (targetDisplay) and explicit channel ID (targetIdentifier).",
      );
    }
    return structuredResult({ alertRule });
  },
});
