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
} from "./api-formatting";

const NUMERIC_ID_PATTERN = /^\d+$/;

type AlertComponent = Record<string, unknown>;

export function isNumericAlertRuleId(value: string): boolean {
  return NUMERIC_ID_PATTERN.test(value);
}

function formatComponent(component: AlertComponent): string {
  const id = component.id;
  if (typeof id === "string" && id.trim()) {
    const { id: _id, ...params } = component;
    if (Object.keys(params).length === 0) {
      return id;
    }
    return `${id} ${formatUnknown(params)}`;
  }
  return formatUnknown(component);
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
  const lines = [`${heading} ${label}`, ""];
  for (const component of components.slice(0, 5)) {
    lines.push(`- ${formatComponent(component)}`);
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
  const detectorIds = rule.detectorIds ?? [];
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
    detectorIds.length > 0
      ? `**Detector IDs**: ${detectorIds.map(String).join(", ")}`
      : null,
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
