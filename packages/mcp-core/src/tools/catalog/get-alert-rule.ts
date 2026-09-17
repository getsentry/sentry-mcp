import { setTag } from "@sentry/core";
import { z } from "zod";
import type { IssueAlertRule, MetricAlertRule } from "../../api-client/types";
import { UserInputError } from "../../errors";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import { defineTool } from "../../internal/tool-helpers/define";
import { structuredResult } from "../../internal/tool-helpers/results";
import {
  ParamOrganizationSlug,
  ParamProjectSlugOrAll,
  ParamRegionUrl,
} from "../../schema";
import type { ServerContext } from "../../types";
import { toAlertRuleSummary } from "./support/alert-rule-config";
import {
  formatMetricAlertRule,
  resolveIssueAlertRule,
  resolveMetricAlertRule,
} from "./support/alerts";
import { assertProjectRefWithinConstraint } from "./support/project-constraints";

const AlertRuleKind = z
  .enum(["all", "issue", "metric"])
  .describe(
    "Which alert rule family to inspect. Use `issue` or `metric` for numeric IDs; `all` treats the value as an exact-name lookup.",
  );

type AlertRuleMatch =
  | {
      kind: "issue";
      rule: IssueAlertRule;
      projectSlug: string;
    }
  | {
      kind: "metric";
      rule: MetricAlertRule;
      projectSlug?: string;
    };

function describeMatch(match: AlertRuleMatch): string {
  const project = match.projectSlug ? ` project ${match.projectSlug}` : "";
  return `${match.kind} alert ${String(match.rule.id)} (${match.rule.name})${project}`;
}

function assertMetricAlertRuleWithinProject(
  rule: MetricAlertRule,
  projectSlug?: string,
): void {
  if (!projectSlug) {
    return;
  }

  if (!rule.projects?.includes(projectSlug)) {
    throw new UserInputError(
      `Metric alert rule is outside project "${projectSlug}".`,
    );
  }
}

export default defineTool({
  name: "get_alert_rule",
  skills: ["inspect"],
  requiredScopes: ["org:read", "project:read"],
  description: [
    "Get details for a Sentry alert rule.",
    "",
    "Use this tool when you need to inspect an alert rule's exact conditions, query, triggers, and actions before explaining or planning changes.",
    "",
    "<examples>",
    "get_alert_rule(organizationSlug='my-org', kind='metric', ruleIdOrName='12345')",
    "get_alert_rule(organizationSlug='my-org', kind='issue', projectSlug='backend', ruleIdOrName='Notify backend team')",
    "get_alert_rule(organizationSlug='my-org', projectSlug='backend', ruleIdOrName='P95 latency')",
    "</examples>",
    "",
    "<hints>",
    "- Use `kind='issue'` or `kind='metric'` for numeric IDs because issue and metric alerts use separate endpoints.",
    "- With `kind='all'`, a digit-only `ruleIdOrName` is treated as an exact alert rule name.",
    "- Issue alert rules are project-scoped, so `projectSlug` is required when `kind` is `issue`.",
    "- Issue alert details include the complete editable configuration and component IDs for update_alert_rule. Preserve unchanged groups, conditions, and actions when editing.",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    regionUrl: ParamRegionUrl.nullable().default(null),
    kind: AlertRuleKind.default("all"),
    projectSlug: ParamProjectSlugOrAll.nullable().default(null),
    ruleIdOrName: z
      .string()
      .trim()
      .min(1)
      .describe("The alert rule's numeric ID, or an exact alert rule name."),
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    const requestedProjectSlug =
      params.projectSlug && params.projectSlug !== "all"
        ? params.projectSlug
        : undefined;
    if (requestedProjectSlug) {
      assertProjectRefWithinConstraint({
        resourceLabel: "Alert rule",
        scopedProjectSlug: context.constraints.projectSlug,
        project: { slug: requestedProjectSlug },
      });
    }
    const projectSlug = context.constraints.projectSlug ?? requestedProjectSlug;

    if (params.kind === "issue" && !projectSlug) {
      throw new UserInputError(
        "projectSlug is required when inspecting an issue alert rule.",
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

    let match: AlertRuleMatch;
    if (params.kind === "issue") {
      const rule = await resolveIssueAlertRule(apiService, {
        organizationSlug,
        projectSlug: projectSlug ?? "",
        ruleIdOrName: params.ruleIdOrName,
      });
      match = { kind: "issue", rule, projectSlug: projectSlug ?? "" };
    } else if (params.kind === "metric") {
      const rule = await resolveMetricAlertRule(apiService, {
        organizationSlug,
        projectSlug,
        ruleIdOrName: params.ruleIdOrName,
      });
      assertMetricAlertRuleWithinProject(rule, projectSlug);
      match = { kind: "metric", rule, projectSlug };
    } else {
      const matches: AlertRuleMatch[] = [];
      if (projectSlug) {
        const issueRules = await apiService.listIssueAlertRules({
          organizationSlug,
          projectSlug,
          query: params.ruleIdOrName,
          limit: 100,
        });
        matches.push(
          ...issueRules
            .filter(
              (rule) =>
                rule.name.toLowerCase() === params.ruleIdOrName.toLowerCase(),
            )
            .map(
              (rule): AlertRuleMatch => ({
                kind: "issue",
                rule,
                projectSlug,
              }),
            ),
        );
      }

      const metricRules = await apiService.listMetricAlertRules({
        organizationSlug,
        projectSlug,
        query: params.ruleIdOrName,
        limit: 100,
      });
      matches.push(
        ...metricRules
          .filter(
            (rule) =>
              rule.name.toLowerCase() === params.ruleIdOrName.toLowerCase(),
          )
          .map(
            (rule): AlertRuleMatch => ({
              kind: "metric",
              rule,
              projectSlug,
            }),
          ),
      );

      if (matches.length === 0) {
        throw new UserInputError(
          `Alert rule "${params.ruleIdOrName}" was not found.`,
        );
      }
      if (matches.length > 1) {
        throw new UserInputError(
          `Multiple alert rules named "${params.ruleIdOrName}" were found: ${matches.map(describeMatch).join(", ")}. Retry with the numeric rule ID and explicit kind.`,
        );
      }
      const [found] = matches;
      match =
        found.kind === "issue"
          ? {
              ...found,
              rule: await apiService.getIssueAlertRule({
                organizationSlug,
                projectSlug: found.projectSlug,
                ruleId: found.rule.id,
              }),
            }
          : {
              ...found,
              rule: await apiService.getMetricAlertRule({
                organizationSlug,
                ruleId: found.rule.id,
              }),
            };
      if (match.kind === "metric") {
        assertMetricAlertRuleWithinProject(match.rule, match.projectSlug);
      }
    }

    if (match.kind === "issue") {
      return structuredResult({
        alertRule: toAlertRuleSummary(
          match.rule,
          apiService.getIssueAlertRuleUrl(organizationSlug, match.rule.id),
        ),
      });
    }

    const scopeLabel = projectSlug
      ? `${organizationSlug}/${projectSlug}`
      : organizationSlug;
    let output = `# Alert Rule in **${scopeLabel}**\n\n`;
    output += formatMetricAlertRule(match.rule, {
      url: apiService.getMetricAlertRuleUrl(organizationSlug, match.rule.id),
    });
    output += "\n\n## Response Notes\n\n";
    output +=
      "- Use these details to inspect alert conditions, filters, routing, and notification actions before changing the rule in Sentry.\n";
    return output;
  },
});
