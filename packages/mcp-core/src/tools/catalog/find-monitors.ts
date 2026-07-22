import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../../internal/tool-helpers/define";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import type { Monitor } from "../../api-client/types";
import type { ServerContext } from "../../types";
import {
  ParamOrganizationSlug,
  ParamProjectSlugOrAll,
  ParamRegionUrl,
} from "../../schema";
import {
  compactLines,
  formatActor,
  formatDate,
  formatId,
  formatUnknown,
} from "./support/api-formatting";
import { assertProjectRefWithinConstraint } from "./support/project-constraints";
import { setOrganizationSlug } from "../../internal/tool-helpers/telemetry";

function formatProject(monitor: Monitor): string | null {
  if (!monitor.project) {
    return null;
  }

  return monitor.project.slug ?? monitor.project.name ?? null;
}

function formatMonitorConfig(monitor: Monitor): string[] {
  const config = monitor.config;
  if (!config) {
    return [];
  }

  return ["schedule", "schedule_type", "checkin_margin", "max_runtime"]
    .filter((key) => config[key] !== undefined)
    .map((key) => `**${key}**: ${formatUnknown(config[key])}`);
}

function formatMonitor(monitor: Monitor, monitorUrl: string): string {
  const project = formatProject(monitor);
  const owner = monitor.owner ? formatActor(monitor.owner) : null;
  const environments = monitor.environments ?? [];

  const lines = compactLines([
    `## ${monitor.name ?? monitor.slug}`,
    "",
    `**Slug**: ${monitor.slug}`,
    `**ID**: ${formatId(monitor.id)}`,
    project ? `**Project**: ${project}` : null,
    monitor.status ? `**Status**: ${monitor.status}` : null,
    monitor.type ? `**Type**: ${monitor.type}` : null,
    owner ? `**Owner**: ${owner}` : null,
    formatDate(monitor.lastCheckIn)
      ? `**Last Check-In**: ${formatDate(monitor.lastCheckIn)}`
      : null,
    formatDate(monitor.nextCheckIn)
      ? `**Next Check-In**: ${formatDate(monitor.nextCheckIn)}`
      : null,
    `**URL**: [Open Monitor](${monitorUrl})`,
  ]);

  const configLines = formatMonitorConfig(monitor);
  if (configLines.length > 0) {
    lines.push("", "### Schedule", "", ...configLines);
  }

  if (environments.length > 0) {
    lines.push("", "### Environments", "");
    for (const environment of environments.slice(0, 5)) {
      const label = environment.name ?? "unknown";
      const status = environment.status ? ` - ${environment.status}` : "";
      const lastCheckIn = formatDate(environment.lastCheckIn);
      lines.push(
        `- ${label}${status}${lastCheckIn ? ` (last check-in ${lastCheckIn})` : ""}`,
      );
    }
    if (environments.length > 5) {
      lines.push(`- ...and ${environments.length - 5} more`);
    }
  }

  return lines.join("\n");
}

export default defineTool({
  name: "find_monitors",
  skills: ["inspect"],
  requiredScopes: ["org:read"],
  description: [
    "Find Sentry cron monitors.",
    "",
    "Use this tool when you need to:",
    "- List cron monitors in an organization",
    "- Find a monitor by name or slug before getting details",
    "- Check monitor status, owner, project, schedule, or recent environment state",
    "",
    "<examples>",
    "find_monitors(organizationSlug='my-organization')",
    "find_monitors(organizationSlug='my-organization', projectSlug='backend', query='billing')",
    "</examples>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    regionUrl: ParamRegionUrl.nullable().default(null),
    projectSlug: ParamProjectSlugOrAll.nullable().default(null),
    environment: z
      .string()
      .trim()
      .describe("Optional environment name to limit monitor state.")
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
      .describe("Optional search query for monitor name or slug.")
      .nullable()
      .default(null),
    limit: z
      .number()
      .int()
      .positive()
      .max(100)
      .describe("Maximum number of monitors to return.")
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
    setOrganizationSlug(organizationSlug);
    const requestedProjectSlug =
      params.projectSlug && params.projectSlug !== "all"
        ? params.projectSlug
        : undefined;
    if (requestedProjectSlug) {
      assertProjectRefWithinConstraint({
        resourceLabel: "Monitor list",
        scopedProjectSlug: context.constraints.projectSlug,
        project: { slug: requestedProjectSlug },
      });
    }
    const projectSlug = context.constraints.projectSlug ?? requestedProjectSlug;
    if (projectSlug) {
      setTag("project.slug", projectSlug);
    }

    const monitors = await apiService.listMonitors({
      organizationSlug,
      projectSlug,
      environment: params.environment ?? undefined,
      owner: params.owner ?? undefined,
      query: params.query ?? undefined,
      limit: params.limit,
    });

    let output = `# Cron Monitors in **${organizationSlug}**\n\n`;
    if (monitors.length === 0) {
      output += "No monitors found.\n";
      return output;
    }

    output += monitors
      .slice(0, params.limit)
      .map((monitor) => {
        const project = formatProject(monitor);
        return formatMonitor(
          monitor,
          apiService.getMonitorUrl(
            organizationSlug,
            monitor.slug,
            project ?? undefined,
          ),
        );
      })
      .join("\n\n");
    output += "\n\n## Response Notes\n\n";
    output +=
      "- Use `get_monitor_details` with a monitor slug for check-ins and stats.\n";
    output += "- Monitor issue searches commonly use `monitor.slug:<slug>`.\n";
    return output;
  },
});
