import { setTag } from "@sentry/core";
import { defineTool } from "../../internal/tool-helpers/define";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import {
  ensureIssueWithinProjectConstraint,
  parseIssueParams,
} from "../../internal/tool-helpers/issue";
import type { UserReportList } from "../../api-client/types";
import type { ServerContext } from "../../types";
import {
  ParamIssueShortId,
  ParamIssueUrl,
  ParamOrganizationSlug,
  ParamRegionUrl,
} from "../../schema";
import { formatDate } from "./support/api-formatting";

function formatUserReport(report: UserReportList[number]): string {
  const date = formatDate(report.dateCreated) ?? "unknown time";
  const reporter = report.name ?? report.email ?? "anonymous";
  return `- ${date} by ${reporter}:\n  - "${report.comments}"`;
}

export default defineTool({
  name: "get_issue_user_reports",
  skills: ["inspect", "triage"],
  requiredScopes: ["event:read"],
  description: [
    "Get User Feedback (crash-report / user-feedback widget submissions) attached to a Sentry issue.",
    "",
    "Use this tool when you need to:",
    "- See what a user said happened when an error occurred",
    "- Check if any bug reports or feedback were submitted for this issue",
    "- Get the human-provided context behind a crash, beyond the stack trace",
    "",
    "<examples>",
    "get_issue_user_reports(organizationSlug='my-organization', issueId='PROJECT-123')",
    "get_issue_user_reports(issueUrl='https://my-organization.sentry.io/issues/PROJECT-123/')",
    "</examples>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug.optional(),
    regionUrl: ParamRegionUrl.nullable().default(null),
    issueId: ParamIssueShortId.optional(),
    issueUrl: ParamIssueUrl.optional(),
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    const parsed = parseIssueParams({
      issueUrl: params.issueUrl,
      issueId: params.issueId,
      organizationSlug:
        params.organizationSlug ?? context.constraints.organizationSlug,
    });

    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl ?? context.constraints.regionUrl ?? undefined,
    });
    setTag("organization.slug", parsed.organizationSlug);
    setTag("issue.id", parsed.issueId);

    await ensureIssueWithinProjectConstraint({
      apiService,
      organizationSlug: parsed.organizationSlug,
      issueId: parsed.issueId,
      projectSlug: context.constraints.projectSlug,
    });

    const reports = await apiService.getIssueUserReports({
      organizationSlug: parsed.organizationSlug,
      issueId: parsed.issueId,
    });

    const output = [
      `# User Feedback for Issue ${parsed.issueId} in **${parsed.organizationSlug}**`,
      "",
      reports.length === 0
        ? "No user feedback found for this issue."
        : reports.map(formatUserReport).join("\n"),
    ];

    return `${output.join("\n")}\n`;
  },
});
