import { z } from "zod";
import type { IssueAlertRule } from "../../../api-client/types";

const componentId = z.union([z.string(), z.number()]);
const logicType = z.enum(["all", "any", "any-short", "none"]);
const condition = z.object({
  id: componentId.optional(),
  type: z.string(),
  comparison: z.unknown(),
  conditionResult: z.unknown(),
});

export const ParamAlertTriggers = z
  .object({
    id: componentId.optional(),
    logicType,
    conditions: z.array(condition),
  })
  .describe(
    "The complete trigger group. Preserve existing condition IDs when editing; omitted conditions are removed. Use the configuration returned by get_alert_rule.",
  );

const action = z.object({
  id: componentId.optional(),
  type: z.string(),
  integrationId: componentId.nullable().optional(),
  data: z.record(z.string(), z.unknown()),
  config: z.record(z.string(), z.unknown()),
  status: z.string().optional(),
});

export const ParamAlertActionFilters = z
  .array(
    z.object({
      id: componentId.optional(),
      logicType,
      conditions: z.array(condition),
      actions: z.array(action),
    }),
  )
  .describe(
    "The complete list of action groups, conditions, and notification actions. Preserve their IDs and all unchanged groups and actions; omitted entries are removed. Slack actions use integrationId, config.targetDisplay for the channel name, and optional config.targetIdentifier for the channel ID.",
  );

// Older responses can omit fields, so read summaries preserve what is present
// without supplying defaults that would change a subsequent edit.
const triggerSummarySchema = z.object({
  id: componentId.optional(),
  logicType: z.string().optional(),
  conditions: z.array(condition.partial()).optional(),
});
const actionFilterSummarySchema = triggerSummarySchema.extend({
  actions: z.array(action.partial()).optional(),
});

export const alertRuleSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean().optional(),
  config: z
    .object({ frequency: z.number().int().min(0).optional() })
    .optional(),
  environment: z.string().nullable().optional(),
  owner: z.string().nullable().optional(),
  triggers: triggerSummarySchema.nullable().optional(),
  actionFilters: z.array(actionFilterSummarySchema).nullable().optional(),
  webUrl: z.string().url(),
});

/** Returns editable alert configuration and component IDs, excluding backend metadata. */
export function toAlertRuleSummary(
  rule: IssueAlertRule,
  webUrl: string,
): z.infer<typeof alertRuleSummarySchema> {
  return alertRuleSummarySchema.parse({
    id: String(rule.id),
    name: rule.name,
    enabled: rule.enabled,
    config: rule.config,
    environment: rule.environment,
    owner:
      typeof rule.owner === "string" || rule.owner === null
        ? rule.owner
        : undefined,
    triggers: rule.triggers,
    actionFilters: rule.actionFilters,
    webUrl,
  });
}
