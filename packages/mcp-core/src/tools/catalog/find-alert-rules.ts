import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../../internal/tool-helpers/define";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import { structuredResult } from "../../internal/tool-helpers/results";
import { UserInputError } from "../../errors";
import type { ServerContext } from "../../types";
import type { IssueAlertRule, MetricAlertRule } from "../../api-client/types";
import {
  ParamOrganizationSlug,
  ParamProjectSlugOrAll,
  ParamRegionUrl,
} from "../../schema";
import { assertProjectRefWithinConstraint } from "./support/project-constraints";
import { formatActor, formatDate } from "./support/api-formatting";

const AlertRuleKind = z
  .enum(["all", "issue", "metric"])
  .describe(
    "Which alert rule family to search. Use `all` to include metric alerts, plus issue alerts when a project is available.",
  );

const issueAlertRuleSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string().nullable(),
  actionMatch: z.string().nullable(),
  filterMatch: z.string().nullable(),
  frequencyMinutes: z.number().nullable(),
  environment: z.string().nullable(),
  owner: z.string().nullable(),
  dateCreated: z.string().nullable(),
  dateUpdated: z.string().nullable(),
  lastTriggered: z.string().nullable(),
  webUrl: z.string(),
});

const metricAlertRuleSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.union([z.string(), z.number()]).nullable(),
  dataset: z.string().nullable(),
  aggregate: z.string().nullable(),
  query: z.string().nullable(),
  timeWindowMinutes: z.number().nullable(),
  projects: z.array(z.string()),
  environment: z.string().nullable(),
  owner: z.string().nullable(),
  dateCreated: z.string().nullable(),
  webUrl: z.string(),
});

const paginationStateSchema = z.object({
  nextCursor: z.string().nullable(),
});

export const findAlertRulesOutputSchema = z.object({
  issueRules: z.array(issueAlertRuleSummarySchema),
  metricRules: z.array(metricAlertRuleSummarySchema),
  pagination: z.object({
    issue: paginationStateSchema.nullable(),
    metric: paginationStateSchema.nullable(),
  }),
});

function getIssueAlertRuleFrequency(rule: IssueAlertRule): number | null {
  if (typeof rule.frequency === "number") {
    return rule.frequency;
  }
  const frequency = rule.config.frequency;
  return typeof frequency === "number" ? frequency : null;
}

function getIssueAlertRuleStatus(rule: IssueAlertRule): string | null {
  if (rule.status) {
    return rule.status;
  }
  if (rule.enabled === undefined) {
    return null;
  }
  return rule.enabled ? "enabled" : "disabled";
}

function getOwner(owner: unknown): string | null {
  return owner ? formatActor(owner) : null;
}

export default defineTool({
  name: "find_alert_rules",
  skills: ["inspect"],
  requiredScopes: ["org:read", "project:read"],
  description: [
    "Find Sentry alert rules.",
    "",
    "Use this tool when you need to:",
    "- List issue alert rules for a project",
    "- List metric alert rules for an organization or project",
    "- Find an alert rule ID by name before inspecting it",
    "- Check alert conditions, queries, triggers, actions, owner, or environment",
    "",
    "<examples>",
    "find_alert_rules(organizationSlug='my-org')",
    "find_alert_rules(organizationSlug='my-org', projectSlug='backend')",
    "find_alert_rules(organizationSlug='my-org', kind='issue', projectSlug='backend', query='critical')",
    "</examples>",
    "",
    "<hints>",
    "- Issue alert rules are project-scoped, so `projectSlug` is required when `kind` is `issue`.",
    "- Metric alert rules can be listed organization-wide or project-scoped.",
    "- Issue and metric alert rules have independent pagination state. Reuse a nextCursor only with its matching kind.",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    regionUrl: ParamRegionUrl.nullable().default(null),
    kind: AlertRuleKind.default("all"),
    projectSlug: ParamProjectSlugOrAll.nullable().default(null),
    query: z
      .string()
      .trim()
      .describe("Optional search query for alert rule name.")
      .nullable()
      .default(null),
    cursor: z
      .string()
      .trim()
      .describe(
        "Optional pagination cursor from a previous Sentry API response.",
      )
      .nullable()
      .default(null),
    limit: z
      .number()
      .int()
      .positive()
      .max(100)
      .describe("Maximum number of alert rules to return per alert family.")
      .default(10),
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
  },
  outputSchema: findAlertRulesOutputSchema,
  async handler(params, context: ServerContext) {
    const requestedProjectSlug =
      params.projectSlug && params.projectSlug !== "all"
        ? params.projectSlug
        : undefined;
    if (requestedProjectSlug) {
      assertProjectRefWithinConstraint({
        resourceLabel: "Alert rule list",
        scopedProjectSlug: context.constraints.projectSlug,
        project: { slug: requestedProjectSlug },
      });
    }
    const projectSlug = context.constraints.projectSlug ?? requestedProjectSlug;

    if (params.kind === "issue" && !projectSlug) {
      throw new UserInputError(
        "projectSlug is required when searching issue alert rules.",
      );
    }

    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl ?? undefined,
    });
    const organizationSlug = params.organizationSlug;
    setTag("organization.slug", organizationSlug);
    if (projectSlug) {
      setTag("project.slug", projectSlug);
    }

    const includeIssue = params.kind !== "metric" && Boolean(projectSlug);
    const includeMetric = params.kind !== "issue";
    if (params.cursor && includeIssue && includeMetric) {
      throw new UserInputError(
        "cursor cannot be used with `kind='all'` when both issue and metric alert rules are included. Retry with `kind='issue'` or `kind='metric'` using a cursor from the same alert rule family.",
      );
    }
    const issuePage =
      includeIssue && projectSlug
        ? await apiService.listIssueAlertRulesPage({
            organizationSlug,
            projectSlug,
            query: params.query ?? undefined,
            cursor: params.cursor ?? undefined,
            limit: params.limit,
          })
        : { rules: [], nextCursor: null };
    const metricPage = includeMetric
      ? await apiService.listMetricAlertRulesPage({
          organizationSlug,
          projectSlug,
          query: params.query ?? undefined,
          cursor: params.cursor ?? undefined,
          limit: params.limit,
        })
      : { rules: [], nextCursor: null };
    return structuredResult({
      issueRules: issuePage.rules.map((rule: IssueAlertRule) => ({
        id: String(rule.id),
        name: rule.name,
        status: getIssueAlertRuleStatus(rule),
        actionMatch: rule.actionMatch ?? null,
        filterMatch: rule.filterMatch ?? null,
        frequencyMinutes: getIssueAlertRuleFrequency(rule),
        environment: rule.environment ?? null,
        owner: getOwner(rule.owner),
        dateCreated: formatDate(rule.dateCreated),
        dateUpdated: formatDate(rule.dateUpdated),
        lastTriggered: formatDate(rule.lastTriggered),
        webUrl: apiService.getIssueAlertRuleUrl(organizationSlug, rule.id),
      })),
      metricRules: metricPage.rules.map((rule: MetricAlertRule) => ({
        id: String(rule.id),
        name: rule.name,
        status: rule.status ?? null,
        dataset: rule.dataset ?? null,
        aggregate: rule.aggregate ?? null,
        query: rule.query ?? null,
        timeWindowMinutes: rule.timeWindow ?? null,
        projects: rule.projects,
        environment: rule.environment ?? null,
        owner: getOwner(rule.owner),
        dateCreated: formatDate(rule.dateCreated),
        webUrl: apiService.getMetricAlertRuleUrl(organizationSlug, rule.id),
      })),
      pagination: {
        issue: includeIssue ? { nextCursor: issuePage.nextCursor } : null,
        metric: includeMetric ? { nextCursor: metricPage.nextCursor } : null,
      },
    });
  },
});
