import { setTag } from "@sentry/core";
import { z } from "zod";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import { defineTool } from "../../internal/tool-helpers/define";
import { structuredResult } from "../../internal/tool-helpers/results";
import {
  ParamOrganizationSlug,
  ParamProjectSlugOrAll,
  ParamRegionUrl,
} from "../../schema";
import type { ServerContext } from "../../types";
import { assertProjectRefWithinConstraint } from "./support/project-constraints";
import {
  toUptimeMonitorSummary,
  uptimeMonitorSummarySchema,
} from "./support/uptime-monitors";

export const findUptimeMonitorsOutputSchema = z.object({
  monitors: z.array(uptimeMonitorSummarySchema),
  hasMore: z.boolean(),
});

export default defineTool({
  name: "find_uptime_monitors",
  skills: ["inspect"],
  requiredScopes: ["org:read", "project:read"],
  description: [
    "Find Sentry uptime monitors.",
    "",
    "Use this tool when you need to:",
    "- List HTTP uptime monitors in an organization",
    "- Find a monitor by name or URL before getting details",
    "- Check monitor status, owner, project, interval, or target URL",
    "- When `hasMore` is true, narrow results with project, environment, owner, or query filters",
    "",
    "This is separate from cron monitors (`find_monitors`).",
    "",
    "<examples>",
    "find_uptime_monitors(organizationSlug='my-organization')",
    "find_uptime_monitors(organizationSlug='my-organization', projectSlug='backend', query='api')",
    "</examples>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    regionUrl: ParamRegionUrl.nullable().default(null),
    projectSlug: ParamProjectSlugOrAll.nullable().default(null),
    environment: z
      .string()
      .trim()
      .describe("Optional environment name to limit monitors.")
      .nullable()
      .default(null),
    owner: z
      .string()
      .trim()
      .describe(
        "Optional owner filter, such as `user:123`, `team:456`, `myteams`, or `unassigned`.",
      )
      .nullable()
      .default(null),
    query: z
      .string()
      .trim()
      .describe("Optional search query for monitor name or URL.")
      .nullable()
      .default(null),
    limit: z
      .number()
      .int()
      .positive()
      .max(99)
      .describe("Maximum number of monitors to return.")
      .default(10),
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
  },
  outputSchema: findUptimeMonitorsOutputSchema,
  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl ?? undefined,
    });
    const organizationSlug = params.organizationSlug;
    setTag("organization.slug", organizationSlug);

    const requestedProjectSlug =
      params.projectSlug && params.projectSlug !== "all"
        ? params.projectSlug
        : undefined;
    if (requestedProjectSlug) {
      assertProjectRefWithinConstraint({
        resourceLabel: "Uptime monitor list",
        scopedProjectSlug: context.constraints.projectSlug,
        project: { slug: requestedProjectSlug },
      });
    }
    const projectSlug = context.constraints.projectSlug ?? requestedProjectSlug;
    if (projectSlug) {
      setTag("project.slug", projectSlug);
    }

    const monitors = await apiService.listUptimeMonitors({
      organizationSlug,
      projectSlug,
      environment: params.environment ?? undefined,
      owner: params.owner ?? undefined,
      query: params.query ?? undefined,
      limit: params.limit + 1,
    });

    return structuredResult({
      monitors: monitors
        .slice(0, params.limit)
        .map((monitor) =>
          toUptimeMonitorSummary(
            monitor,
            apiService.getUptimeMonitorUrl(organizationSlug, monitor.id),
          ),
        ),
      hasMore: monitors.length > params.limit,
    });
  },
});
