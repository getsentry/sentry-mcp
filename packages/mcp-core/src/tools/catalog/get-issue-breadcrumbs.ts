import { setTag } from "@sentry/core";
import { z } from "zod";
import { ApiNotFoundError } from "../../api-client";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import { fetchAndFormatBreadcrumbs } from "../../internal/tool-helpers/breadcrumbs";
import { defineTool } from "../../internal/tool-helpers/define";
import { enhanceNotFoundError } from "../../internal/tool-helpers/enhance-error";
import {
  ensureIssueWithinProjectConstraint,
  parseIssueParams,
} from "../../internal/tool-helpers/issue";
import {
  ParamIssueShortId,
  ParamIssueUrl,
  ParamOrganizationSlug,
  ParamRegionUrl,
} from "../../schema";
import type { ServerContext } from "../../types";

export default defineTool({
  name: "get_issue_breadcrumbs",
  skills: ["inspect", "triage"],
  requiredScopes: ["event:read"],
  description: [
    "Get the breadcrumb trail from a Sentry issue event.",
    "Defaults to the latest event when eventId is omitted.",
    "",
    "Use this tool when you need to:",
    "- See the user and application actions leading up to an error",
    "- Inspect navigation, console, HTTP, and other breadcrumb events",
    "- Reconstruct the immediate context before an issue occurred",
    "- Compare breadcrumb trails across multiple events in the same issue",
    "",
    "<examples>",
    "get_issue_breadcrumbs(organizationSlug='my-org', issueId='PROJECT-123')",
    "get_issue_breadcrumbs(organizationSlug='my-org', issueId='PROJECT-123', eventId='abc123')",
    "get_issue_breadcrumbs(issueUrl='https://my-org.sentry.io/issues/PROJECT-123/')",
    "</examples>",
    "",
    "<hints>",
    "- `eventId` is optional and defaults to `latest`.",
    "- Pass a specific event ID to inspect breadcrumbs for a non-latest event in the issue.",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug.optional(),
    regionUrl: ParamRegionUrl.nullable().default(null),
    issueId: ParamIssueShortId.optional(),
    issueUrl: ParamIssueUrl.optional(),
    eventId: z
      .string()
      .trim()
      .min(1)
      .default("latest")
      .describe("The event ID for the issue. Defaults to `latest`."),
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
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

    try {
      await ensureIssueWithinProjectConstraint({
        apiService,
        organizationSlug: parsed.organizationSlug,
        issueId: parsed.issueId,
        projectSlug: context.constraints.projectSlug,
      });
      return await fetchAndFormatBreadcrumbs(
        apiService,
        parsed.organizationSlug,
        parsed.issueId,
        params.eventId,
      );
    } catch (error) {
      if (error instanceof ApiNotFoundError) {
        throw enhanceNotFoundError(error, {
          organizationSlug: parsed.organizationSlug,
          issueId: parsed.issueId,
          eventId: params.eventId,
        });
      }
      throw error;
    }
  },
});
