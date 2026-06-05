import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../../internal/tool-helpers/define";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import type {
  Monitor,
  MonitorCheckIn,
  MonitorStat,
} from "../../api-client/types";
import type { ServerContext } from "../../types";
import {
  ParamOrganizationSlug,
  ParamProjectSlug,
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

function formatProject(monitor: Monitor): string | null {
  if (!monitor.project) {
    return null;
  }

  return monitor.project.slug ?? monitor.project.name ?? null;
}

function formatConfig(monitor: Monitor): string[] {
  const config = monitor.config;
  if (!config) {
    return [];
  }

  return [
    "schedule",
    "schedule_type",
    "timezone",
    "checkin_margin",
    "max_runtime",
  ]
    .filter((key) => config[key] !== undefined)
    .map((key) => `- **${key}**: ${formatUnknown(config[key])}`);
}

function formatCheckIn(checkIn: MonitorCheckIn): string {
  const date =
    formatDate(checkIn.dateCreated) ??
    formatDate(checkIn.dateUpdated) ??
    "unknown time";
  const duration =
    checkIn.duration === undefined || checkIn.duration === null
      ? ""
      : `, ${checkIn.duration}s`;
  const environment = checkIn.environment ? `, ${checkIn.environment}` : "";
  return `- ${date}: ${checkIn.status ?? "unknown"}${duration}${environment}`;
}

function formatStat(stat: MonitorStat): string {
  const timestamp =
    formatDate(new Date(stat.ts * 1000).toISOString()) ?? String(stat.ts);
  const parts = Object.entries(stat)
    .filter(([key]) => key !== "ts")
    .map(([key, value]) => `${key}=${formatUnknown(value)}`);
  return `- ${timestamp}: ${parts.join(", ") || "no check-ins"}`;
}

export default defineTool({
  name: "get_monitor_details",
  skills: ["inspect"],
  requiredScopes: ["org:read"],
  description: [
    "Get details for a Sentry cron monitor.",
    "",
    "Use this tool when you need to:",
    "- Inspect a monitor's schedule, status, owner, project, and environments",
    "- Review recent check-ins for missed, failed, timeout, or OK runs",
    "- Check monitor stats over a recent time range",
    "",
    "<examples>",
    "get_monitor_details(organizationSlug='my-organization', monitorSlug='nightly-import')",
    "get_monitor_details(organizationSlug='my-organization', monitorSlug='nightly-import', environment='production', statsPeriod='7d')",
    "</examples>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    regionUrl: ParamRegionUrl.nullable().default(null),
    projectSlug: ParamProjectSlug.nullable()
      .default(null)
      .describe(
        "Optional project slug to disambiguate monitors with the same slug.",
      ),
    monitorSlug: z.string().trim().min(1).describe("Monitor slug or GUID."),
    environment: z.string().trim().nullable().default(null),
    statsPeriod: z
      .string()
      .trim()
      .describe(
        "Relative time range, such as `24h`, `7d`, or `14d`. Defaults to `24h` when `start` and `end` are omitted.",
      )
      .nullable()
      .default(null),
    start: z
      .string()
      .datetime()
      .describe(
        "Absolute start time. Must be provided with `end`; do not combine with `statsPeriod`.",
      )
      .nullable()
      .default(null),
    end: z
      .string()
      .datetime()
      .describe(
        "Absolute end time. Must be provided with `start`; do not combine with `statsPeriod`.",
      )
      .nullable()
      .default(null),
    checkInLimit: z.number().int().positive().max(50).default(10),
    includeStats: z.boolean().default(true),
    rollupSeconds: z.number().int().positive().nullable().default(null),
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
    setTag("monitor.slug", params.monitorSlug);
    const projectSlug =
      params.projectSlug ?? context.constraints.projectSlug ?? null;
    if (params.projectSlug) {
      assertProjectRefWithinConstraint({
        resourceLabel: "Monitor",
        scopedProjectSlug: context.constraints.projectSlug,
        project: { slug: params.projectSlug },
      });
    }
    const start = params.start ?? undefined;
    const end = params.end ?? undefined;
    const hasAbsoluteTimeRange = start !== undefined || end !== undefined;
    const statsPeriod = hasAbsoluteTimeRange
      ? undefined
      : (params.statsPeriod ?? "24h");

    const monitor = await apiService.getMonitorDetails({
      organizationSlug,
      projectSlug: projectSlug ?? undefined,
      monitorSlug: params.monitorSlug,
      environment: params.environment ?? undefined,
    });
    assertProjectRefWithinConstraint({
      resourceLabel: "Monitor",
      scopedProjectSlug: context.constraints.projectSlug,
      project: monitor.project,
    });

    const project = formatProject(monitor);
    const monitorPath = project ? `${project}/${monitor.slug}` : monitor.slug;
    const monitorUrl = apiService.getMonitorUrl(organizationSlug, monitorPath);

    const [checkIns, stats] = await Promise.all([
      apiService.listMonitorCheckIns({
        organizationSlug,
        projectSlug: projectSlug ?? undefined,
        monitorSlug: params.monitorSlug,
        environment: params.environment ?? undefined,
        statsPeriod,
        start,
        end,
        limit: params.checkInLimit,
      }),
      params.includeStats
        ? apiService.getMonitorStats({
            organizationSlug,
            projectSlug: projectSlug ?? undefined,
            monitorSlug: params.monitorSlug,
            environment: params.environment ?? undefined,
            statsPeriod,
            start,
            end,
            rollup: params.rollupSeconds ?? undefined,
          })
        : Promise.resolve([]),
    ]);

    const owner = monitor.owner ? formatActor(monitor.owner) : null;
    const output = compactLines([
      `# Monitor ${monitor.name ?? monitor.slug} in **${organizationSlug}**`,
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

    const config = formatConfig(monitor);
    if (config.length > 0) {
      output.push("", "## Schedule", "", ...config);
    }

    if (monitor.environments && monitor.environments.length > 0) {
      output.push("", "## Environments", "");
      for (const environment of monitor.environments) {
        output.push(
          compactLines([
            `- ${environment.name ?? "unknown"}`,
            environment.status ? `  - Status: ${environment.status}` : null,
            formatDate(environment.lastCheckIn)
              ? `  - Last check-in: ${formatDate(environment.lastCheckIn)}`
              : null,
            formatDate(environment.nextCheckIn)
              ? `  - Next check-in: ${formatDate(environment.nextCheckIn)}`
              : null,
          ]).join("\n"),
        );
      }
    }

    output.push("", "## Recent Check-Ins", "");
    output.push(
      checkIns.length === 0
        ? "No check-ins found in this time range."
        : checkIns.slice(0, params.checkInLimit).map(formatCheckIn).join("\n"),
    );

    if (params.includeStats) {
      output.push("", "## Stats", "");
      output.push(
        stats.length === 0
          ? "No stats found in this time range."
          : stats.slice(-10).map(formatStat).join("\n"),
      );
    }

    output.push("", "## Response Notes", "");
    output.push(
      `- Search issues from this monitor with \`search_issues\` query \`monitor.slug:${monitor.slug}\`.`,
    );

    return `${output.join("\n")}\n`;
  },
});
