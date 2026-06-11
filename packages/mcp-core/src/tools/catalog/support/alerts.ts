import type {
  IssueAlertRule,
  MetricAlertRule,
} from "../../../api-client/types";
import type { SentryApiService } from "../../../api-client";
import { ApiNotFoundError } from "../../../api-client";
import { UserInputError } from "../../../errors";
import {
  compactLines,
  formatActor,
  formatDate,
  formatId,
  formatUnknown,
  isRecord,
} from "./api-formatting";

const NUMERIC_ID_PATTERN = /^\d+$/;

type AlertComponent = Record<string, unknown>;
type AlertComponentDetail = [string, unknown];

const COMPONENT_DETAIL_SKIP_KEYS = new Set([
  "id",
  "type",
  "conditions",
  "actions",
]);
const WORKFLOW_GROUP_DETAIL_SKIP_KEYS = new Set([
  "id",
  "type",
  "logicType",
  "conditions",
  "actions",
]);

export function isNumericAlertRuleId(value: string): boolean {
  return NUMERIC_ID_PATTERN.test(value);
}

function humanizeKey(value: string): string {
  if (value === "conditionResult") {
    return "result";
  }
  if (value === "targetIdentifier") {
    return "target";
  }
  if (value === "alertThreshold") {
    return "threshold";
  }
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
}

function humanizeValue(value: string): string {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  if (!normalized) {
    return value;
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatScalar(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return formatUnknown(value);
  }
  return null;
}

function formatDetailValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    const items = value
      .map(formatDetailValue)
      .filter((item): item is string => item !== null);
    return items.length > 0 ? items.join(", ") : null;
  }
  if (isRecord(value)) {
    const details = Object.entries(value)
      .filter(([key]) => key !== "id")
      .map(([key, item]) => {
        const formatted = formatDetailValue(item);
        return formatted ? `${humanizeKey(key)}: ${formatted}` : null;
      })
      .filter((item): item is string => item !== null);
    return details.length > 0 ? details.join(", ") : null;
  }
  return formatScalar(value);
}

function shouldSkipDetail(key: string, value: unknown): boolean {
  return (
    key === "targetDisplay" &&
    typeof value === "string" &&
    value.toLowerCase() === "unknown"
  );
}

function getComponentDetailEntries(
  component: AlertComponent,
  skippedKeys: ReadonlySet<string>,
): AlertComponentDetail[] {
  const detailEntries: AlertComponentDetail[] = [];
  for (const [key, value] of Object.entries(component)) {
    if (
      !skippedKeys.has(key) &&
      value !== undefined &&
      value !== null &&
      !shouldSkipDetail(key, value)
    ) {
      if (key === "config" && isRecord(value)) {
        detailEntries.push(
          ...Object.entries(value).filter(
            ([configKey, configValue]) =>
              !shouldSkipDetail(configKey, configValue),
          ),
        );
        continue;
      }
      detailEntries.push([key, value]);
    }
  }
  return detailEntries;
}

function formatComponentDetails(
  component: AlertComponent,
  skippedKeys: ReadonlySet<string>,
): string | null {
  const details = getComponentDetailEntries(component, skippedKeys)
    .map(([key, value]) => {
      const formatted = formatDetailValue(value);
      return formatted ? `${humanizeKey(key)}: ${formatted}` : null;
    })
    .filter((item): item is string => item !== null)
    .join(", ");
  return details || null;
}

function formatComponent(component: AlertComponent): string {
  const type = typeof component.type === "string" ? component.type : null;
  const label = type ? humanizeValue(type) : "Component";
  const details = formatComponentDetails(component, COMPONENT_DETAIL_SKIP_KEYS);
  if (!details) {
    return label;
  }
  return `${label} (${details})`;
}

function singularizeComponentLabel(label: string): string {
  if (label.endsWith("ies")) {
    return `${label.slice(0, -3)}y`;
  }
  if (label.endsWith("s")) {
    return label.slice(0, -1);
  }
  return label;
}

function formatThresholdTrigger(component: AlertComponent): string | null {
  const label = formatScalar(component.label);
  const threshold = formatScalar(component.alertThreshold);
  const resolveThreshold = formatScalar(component.resolveThreshold);
  if (!threshold) {
    return null;
  }

  const thresholdLabel = label
    ? `${humanizeValue(label)} threshold`
    : "Threshold";
  return resolveThreshold
    ? `${thresholdLabel}: ${threshold}; resolves below: ${resolveThreshold}`
    : `${thresholdLabel}: ${threshold}`;
}

function formatWorkflowGroup(
  component: AlertComponent,
  componentLabel: string,
): string[] {
  const lines: string[] = [];
  const logicType =
    typeof component.logicType === "string" ? component.logicType : null;
  if (logicType) {
    lines.push(`- Logic: ${logicType}`);
  }

  const componentDetails =
    componentLabel === "Trigger"
      ? (formatThresholdTrigger(component) ??
        formatComponentDetails(component, WORKFLOW_GROUP_DETAIL_SKIP_KEYS))
      : formatComponentDetails(component, WORKFLOW_GROUP_DETAIL_SKIP_KEYS);
  if (componentDetails) {
    lines.push(`- ${componentLabel}: ${componentDetails}`);
  }

  const conditions = readComponentList(component.conditions);
  if (conditions?.length) {
    lines.push(
      `- Conditions: ${conditions.slice(0, 5).map(formatComponent).join("; ")}`,
    );
    if (conditions.length > 5) {
      lines.push(`- ...and ${conditions.length - 5} more conditions`);
    }
  }

  const actions = readComponentList(component.actions);
  if (actions?.length) {
    lines.push(
      `- Actions: ${actions.slice(0, 5).map(formatComponent).join("; ")}`,
    );
    if (actions.length > 5) {
      lines.push(`- ...and ${actions.length - 5} more actions`);
    }
  }

  if (lines.length === 0) {
    lines.push(`- ${formatComponent(component)}`);
  }
  return lines;
}

function readComponentList(value: unknown): AlertComponent[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter(isRecord);
}

function formatComponentSummary(
  label: string,
  components: AlertComponent[] | undefined,
  headingLevel: number,
): string[] {
  if (!components || components.length === 0) {
    return [];
  }
  const heading = "#".repeat(Math.min(headingLevel, 6));
  const lines = ["", `${heading} ${label}`, ""];
  const componentLabel = singularizeComponentLabel(label);
  for (const component of components.slice(0, 5)) {
    lines.push(...formatWorkflowGroup(component, componentLabel));
  }
  if (components.length > 5) {
    lines.push(`- ...and ${components.length - 5} more`);
  }
  return lines;
}

function getIssueAlertRuleFrequency(rule: IssueAlertRule): number | null {
  if (rule.frequency !== undefined && rule.frequency !== null) {
    return rule.frequency;
  }
  const frequency = rule.config.frequency;
  return typeof frequency === "number" ? frequency : null;
}

export function formatIssueAlertRule(
  rule: IssueAlertRule,
  projectSlug: string,
  options: {
    headingLevel?: number;
    includeComponents?: boolean;
    url?: string;
  } = {},
): string {
  const headingLevel = options.headingLevel ?? 2;
  const includeComponents = options.includeComponents ?? true;
  const heading = "#".repeat(Math.min(headingLevel, 6));
  const owner = rule.owner ? formatActor(rule.owner) : null;
  const frequency = getIssueAlertRuleFrequency(rule);
  const lines = compactLines([
    `${heading} ${rule.name}`,
    "",
    `**Kind**: Issue Alert`,
    `**ID**: ${formatId(rule.id)}`,
    `**Project**: ${projectSlug}`,
    rule.status
      ? `**Status**: ${rule.status}`
      : rule.enabled !== undefined
        ? `**Status**: ${rule.enabled ? "enabled" : "disabled"}`
        : null,
    rule.actionMatch ? `**Action Match**: ${rule.actionMatch}` : null,
    rule.filterMatch ? `**Filter Match**: ${rule.filterMatch}` : null,
    frequency !== null ? `**Frequency**: ${frequency} minutes` : null,
    rule.environment ? `**Environment**: ${rule.environment}` : null,
    owner ? `**Owner**: ${owner}` : null,
    formatDate(rule.dateCreated)
      ? `**Created**: ${formatDate(rule.dateCreated)}`
      : null,
    formatDate(rule.dateUpdated)
      ? `**Updated**: ${formatDate(rule.dateUpdated)}`
      : null,
    formatDate(rule.lastTriggered)
      ? `**Last Triggered**: ${formatDate(rule.lastTriggered)}`
      : null,
    options.url ? `**URL**: ${options.url}` : null,
  ]);

  if (includeComponents) {
    const workflowTriggers = rule.triggers ? [rule.triggers] : [];
    lines.push(
      ...formatComponentSummary(
        "Conditions",
        rule.conditions,
        headingLevel + 1,
      ),
      ...formatComponentSummary("Filters", rule.filters, headingLevel + 1),
      ...formatComponentSummary("Actions", rule.actions, headingLevel + 1),
      ...formatComponentSummary("Triggers", workflowTriggers, headingLevel + 1),
      ...formatComponentSummary(
        "Action Filters",
        rule.actionFilters ?? [],
        headingLevel + 1,
      ),
    );
  }

  return lines.join("\n");
}

export function formatMetricAlertRule(
  rule: MetricAlertRule,
  options: {
    headingLevel?: number;
    includeComponents?: boolean;
    url?: string;
  } = {},
): string {
  const headingLevel = options.headingLevel ?? 2;
  const includeComponents = options.includeComponents ?? true;
  const heading = "#".repeat(Math.min(headingLevel, 6));
  const owner = rule.owner ? formatActor(rule.owner) : null;
  const projects = rule.projects ?? [];
  const lines = compactLines([
    `${heading} ${rule.name}`,
    "",
    `**Kind**: Metric Alert`,
    `**ID**: ${formatId(rule.id)}`,
    rule.status !== undefined
      ? `**Status**: ${formatUnknown(rule.status)}`
      : null,
    rule.dataset ? `**Dataset**: ${rule.dataset}` : null,
    rule.aggregate ? `**Aggregate**: ${rule.aggregate}` : null,
    rule.query ? `**Query**: ${rule.query}` : null,
    rule.timeWindow !== undefined && rule.timeWindow !== null
      ? `**Time Window**: ${rule.timeWindow} minutes`
      : null,
    projects.length > 0 ? `**Projects**: ${projects.join(", ")}` : null,
    rule.environment ? `**Environment**: ${rule.environment}` : null,
    owner ? `**Owner**: ${owner}` : null,
    formatDate(rule.dateCreated)
      ? `**Created**: ${formatDate(rule.dateCreated)}`
      : null,
    options.url ? `**URL**: ${options.url}` : null,
  ]);

  if (includeComponents) {
    lines.push(
      ...formatComponentSummary("Triggers", rule.triggers, headingLevel + 1),
    );
  }
  return lines.join("\n");
}

async function findExactIssueAlertRuleMatches(
  apiService: SentryApiService,
  params: {
    organizationSlug: string;
    projectSlug: string;
    ruleName: string;
  },
): Promise<IssueAlertRule[]> {
  const rules = await apiService.listIssueAlertRules({
    organizationSlug: params.organizationSlug,
    projectSlug: params.projectSlug,
    query: params.ruleName,
    limit: 100,
  });
  return rules.filter(
    (rule) => rule.name.toLowerCase() === params.ruleName.toLowerCase(),
  );
}

async function findExactMetricAlertRuleMatches(
  apiService: SentryApiService,
  params: {
    organizationSlug: string;
    projectSlug?: string;
    ruleName: string;
  },
): Promise<MetricAlertRule[]> {
  const rules = await apiService.listMetricAlertRules({
    organizationSlug: params.organizationSlug,
    projectSlug: params.projectSlug,
    query: params.ruleName,
    limit: 100,
  });
  return rules.filter(
    (rule) => rule.name.toLowerCase() === params.ruleName.toLowerCase(),
  );
}

export async function getMetricAlertRuleWithOrgFallback(
  apiService: SentryApiService,
  params: {
    organizationSlug: string;
    projectSlug?: string;
    ruleId: string | number;
  },
): Promise<MetricAlertRule> {
  try {
    return await apiService.getMetricAlertRule(params);
  } catch (error) {
    if (!(error instanceof ApiNotFoundError) || !params.projectSlug) {
      throw error;
    }
  }
  return apiService.getMetricAlertRule({
    organizationSlug: params.organizationSlug,
    ruleId: params.ruleId,
  });
}

export async function resolveIssueAlertRule(
  apiService: SentryApiService,
  params: {
    organizationSlug: string;
    projectSlug: string;
    ruleIdOrName: string;
  },
): Promise<IssueAlertRule> {
  if (isNumericAlertRuleId(params.ruleIdOrName)) {
    try {
      return await apiService.getIssueAlertRule({
        organizationSlug: params.organizationSlug,
        projectSlug: params.projectSlug,
        ruleId: params.ruleIdOrName,
      });
    } catch (error) {
      if (!(error instanceof ApiNotFoundError)) {
        throw error;
      }
    }
  }

  const matches = await findExactIssueAlertRuleMatches(apiService, {
    organizationSlug: params.organizationSlug,
    projectSlug: params.projectSlug,
    ruleName: params.ruleIdOrName,
  });

  if (matches.length === 1) {
    return apiService.getIssueAlertRule({
      organizationSlug: params.organizationSlug,
      projectSlug: params.projectSlug,
      ruleId: matches[0].id,
    });
  }
  if (matches.length > 1) {
    throw new UserInputError(
      `Multiple issue alert rules named "${params.ruleIdOrName}" were found. Retry with the numeric rule ID.`,
    );
  }
  throw new UserInputError(
    `Issue alert rule "${params.ruleIdOrName}" was not found in project ${params.projectSlug}.`,
  );
}

export async function resolveMetricAlertRule(
  apiService: SentryApiService,
  params: {
    organizationSlug: string;
    projectSlug?: string;
    ruleIdOrName: string;
  },
): Promise<MetricAlertRule> {
  if (isNumericAlertRuleId(params.ruleIdOrName)) {
    try {
      return await getMetricAlertRuleWithOrgFallback(apiService, {
        organizationSlug: params.organizationSlug,
        projectSlug: params.projectSlug,
        ruleId: params.ruleIdOrName,
      });
    } catch (error) {
      if (!(error instanceof ApiNotFoundError)) {
        throw error;
      }
    }
  }

  const matches = await findExactMetricAlertRuleMatches(apiService, {
    organizationSlug: params.organizationSlug,
    projectSlug: params.projectSlug,
    ruleName: params.ruleIdOrName,
  });

  if (matches.length === 1) {
    return getMetricAlertRuleWithOrgFallback(apiService, {
      organizationSlug: params.organizationSlug,
      projectSlug: params.projectSlug,
      ruleId: matches[0].id,
    });
  }
  if (matches.length > 1) {
    throw new UserInputError(
      `Multiple metric alert rules named "${params.ruleIdOrName}" were found. Retry with the numeric rule ID.`,
    );
  }
  throw new UserInputError(
    `Metric alert rule "${params.ruleIdOrName}" was not found.`,
  );
}
