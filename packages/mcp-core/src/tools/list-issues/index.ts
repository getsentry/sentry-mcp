import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../../internal/tool-helpers/define";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import type { ServerContext } from "../../types";
import { ParamOrganizationSlug, ParamRegionUrl } from "../../schema";
import { validateSlugOrId, isNumericId } from "../../utils/slug-validation";
import { formatIssueResults } from "../search-issues/formatters";

export default defineTool({
  name: "list_issues",
  skills: ["inspect", "triage", "seer"],
  requiredScopes: ["event:read"],
  description: [
    "List issues using Sentry query syntax directly (no AI/LLM required).",
    "",
    "Use this tool when:",
    "- You know Sentry query syntax already",
    "- AI-powered search is unavailable (no OPENAI_API_KEY or ANTHROPIC_API_KEY)",
    "- You want precise control over the query",
    "",
    "For natural language queries, use search_issues instead.",
    "",
    "Common Query Syntax:",
    "- is:unresolved - Show unresolved issues only",
    "- is:unassigned - Show unassigned issues",
    "- level:error - Filter by error level",
    "- firstSeen:-24h - First seen in last 24 hours",
    "- lastSeen:-1h - Last seen in last hour",
    "- has:user - Issues with user context",
    "- user.email:user@example.com - Filter by user email",
    "- environment:production - Filter by environment",
    "- release:1.0.0 - Filter by release version",
    "",
    "Combine queries: is:unresolved is:unassigned level:error",
    "",
    "<examples>",
    "list_issues(organizationSlug='my-org', query='is:unresolved is:unassigned')",
    "list_issues(organizationSlug='my-org', query='level:error firstSeen:-24h', sort='freq')",
    "list_issues(organizationSlug='my-org', projectSlugOrId='my-project', query='is:unresolved')",
    "</examples>",
    "",
    "<hints>",
    "- If the user passes a parameter in the form of name/otherName, it's likely in the format of <organizationSlug>/<projectSlugOrId>.",
    "- The projectSlugOrId parameter accepts both project slugs (e.g., 'my-project') and numeric IDs (e.g., '123456').",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    query: z
      .string()
      .trim()
      .default("is:unresolved")
      .describe("Sentry issue search query syntax"),
    projectSlugOrId: z
      .string()
      .toLowerCase()
      .trim()
      .superRefine(validateSlugOrId)
      .nullable()
      .default(null)
      .describe("Filter by project slug or numeric ID (optional)"),
    sort: z
      .enum(["date", "freq", "new", "user"])
      .default("date")
      .describe(
        "Sort order: date (last seen), freq (frequency), new (first seen), user (user count)",
      ),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(10)
      .describe("Maximum number of issues to return (1-100)"),
    regionUrl: ParamRegionUrl.nullable().default(null),
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl ?? undefined,
    });

    setTag("organization.slug", params.organizationSlug);
    if (params.projectSlugOrId) {
      if (isNumericId(params.projectSlugOrId)) {
        setTag("project.id", params.projectSlugOrId);
      } else {
        setTag("project.slug", params.projectSlugOrId);
      }
    }

    const issues = await apiService.listIssues({
      organizationSlug: params.organizationSlug,
      projectSlug: params.projectSlugOrId ?? undefined,
      query: params.query,
      sortBy: params.sort,
      limit: params.limit,
    });

    return formatIssueResults({
      issues,
      organizationSlug: params.organizationSlug,
      projectSlugOrId: params.projectSlugOrId ?? undefined,
      query: params.query,
      regionUrl: params.regionUrl ?? undefined,
    });
  },
});
