import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../../internal/tool-helpers/define";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import type { ServerContext } from "../../types";
import { ParamOrganizationSlug, ParamRegionUrl } from "../../schema";
import {
  filterDashboardsByProjectConstraint,
  formatDashboardList,
  resolveDashboardProjectConstraint,
} from "../support/dashboards";

export default defineTool({
  name: "find_dashboards",
  skills: ["inspect"],
  requiredScopes: ["org:read"],
  description: [
    "Find Sentry dashboards in an organization.",
    "",
    "Use this tool when you need to:",
    "- List dashboards in an organization",
    "- Find a dashboard ID before calling get_dashboard_details",
    "- Search dashboards by title",
    "",
    "<examples>",
    "find_dashboards(organizationSlug='my-organization')",
    "find_dashboards(organizationSlug='my-organization', titleQuery='errors')",
    "</examples>",
    "",
    "<hints>",
    "- Dashboard IDs are organization-scoped.",
    "- Use `get_dashboard_details` after finding the correct dashboard ID.",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    regionUrl: ParamRegionUrl.nullable().default(null),
    titleQuery: z
      .string()
      .trim()
      .describe("Optional title substring to search for.")
      .nullable()
      .default(null),
    sort: z
      .enum(["title", "-title", "dateCreated", "-dateCreated"])
      .describe("Sort order for dashboard results.")
      .default("title"),
    cursor: z
      .string()
      .trim()
      .describe("Optional pagination cursor from a previous response.")
      .nullable()
      .default(null),
    limit: z
      .number()
      .int()
      .positive()
      .max(100)
      .describe("Maximum number of dashboards to return.")
      .default(10),
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl ?? undefined,
    });
    const organizationSlug = params.organizationSlug;

    setTag("organization.slug", organizationSlug);

    const scopedProject = await resolveDashboardProjectConstraint({
      apiService,
      organizationSlug,
      scopedProjectSlug: context.constraints.projectSlug,
    });
    if (scopedProject) {
      setTag("project.slug", scopedProject.slug);
      setTag("project.id", String(scopedProject.id));
    }

    const { dashboards, nextCursor } = await apiService.listDashboards({
      organizationSlug,
      query: params.titleQuery ?? undefined,
      sortBy: params.sort,
      limit: params.limit,
      cursor: params.cursor ?? undefined,
    });

    const visibleDashboards = filterDashboardsByProjectConstraint({
      dashboards,
      projectId: scopedProject?.id,
    });

    return formatDashboardList({
      dashboards: visibleDashboards,
      organizationSlug,
      titleQuery: params.titleQuery,
      nextCursor,
      getDashboardUrl: (dashboard) =>
        apiService.getDashboardUrl(organizationSlug, String(dashboard.id), {
          projectId:
            scopedProject?.id ??
            (dashboard.projects.length === 1 ? dashboard.projects[0] : null),
        }),
    });
  },
});
