import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../../internal/tool-helpers/define";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import { UserInputError } from "../../errors";
import type { ServerContext } from "../../types";
import {
  ParamOrganizationSlug,
  ParamProjectSlugOrAll,
  ParamRegionUrl,
} from "../../schema";
import { assertProjectRefWithinConstraint } from "./support/project-constraints";
import { formatIssueAlertRule, formatMetricAlertRule } from "./support/alerts";
import { setOrganizationSlug } from "../../internal/tool-helpers/telemetry";

const AlertRuleKind = z
  .enum(["all", "issue", "metric"])
  .describe(
    "Which alert rule family to search. Use `all` to include metric alerts, plus issue alerts when a project is available.",
  );

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
    openWorldHint: true,
  },
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
    setOrganizationSlug(organizationSlug);
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
    const issueRules = issuePage.rules;
    const metricRules = metricPage.rules;

    const scopeLabel = projectSlug
      ? `${organizationSlug}/${projectSlug}`
      : organizationSlug;
    let output = `# Alert Rules in **${scopeLabel}**\n\n`;
    if (issueRules.length === 0 && metricRules.length === 0) {
      output += "No alert rules found.\n";
      if (params.kind === "all" && !projectSlug) {
        output +=
          "\nIssue alert rules are project-scoped; pass `projectSlug` to include them.\n";
      }
      return output;
    }

    if (issueRules.length > 0) {
      output += "## Issue Alert Rules\n\n";
      output += issueRules
        .slice(0, params.limit)
        .map((rule) =>
          formatIssueAlertRule(rule, projectSlug ?? "", {
            headingLevel: 3,
            includeComponents: false,
            url: apiService.getIssueAlertRuleUrl(organizationSlug, rule.id),
          }),
        )
        .join("\n\n");
      output += "\n\n";
    }

    if (metricRules.length > 0) {
      output += "## Metric Alert Rules\n\n";
      output += metricRules
        .slice(0, params.limit)
        .map((rule) =>
          formatMetricAlertRule(rule, {
            headingLevel: 3,
            includeComponents: false,
            url: apiService.getMetricAlertRuleUrl(organizationSlug, rule.id),
          }),
        )
        .join("\n\n");
      output += "\n\n";
    }

    output += "## Response Notes\n\n";
    output +=
      "- Use `get_alert_rule` with `kind` and the numeric rule ID for full details.\n";
    output +=
      "- Use full details to inspect alert conditions, filters, and notification actions before changing a rule in Sentry.\n";
    if (issuePage.nextCursor) {
      output += `- More issue alert rules are available. Pass \`kind: "issue"\` and \`cursor: "${issuePage.nextCursor}"\` with the same search scope to fetch the next page.\n`;
    }
    if (metricPage.nextCursor) {
      output += `- More metric alert rules are available. Pass \`kind: "metric"\` and \`cursor: "${metricPage.nextCursor}"\` with the same search scope to fetch the next page.\n`;
    }
    if (params.kind === "all" && !projectSlug) {
      output +=
        "- Issue alert rules are project-scoped; pass `projectSlug` to include them.\n";
    }
    return output;
  },
});
