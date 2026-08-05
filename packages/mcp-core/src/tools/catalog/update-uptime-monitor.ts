import { setTag } from "@sentry/core";
import { z } from "zod";
import { UserInputError } from "../../errors";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import { defineTool } from "../../internal/tool-helpers/define";
import { structuredResult } from "../../internal/tool-helpers/results";
import {
  ParamOrganizationSlug,
  ParamProjectSlug,
  ParamRegionUrl,
} from "../../schema";
import type { ServerContext } from "../../types";
import { assertProjectRefWithinConstraint } from "./support/project-constraints";
import {
  ParamUptimeHeaders,
  ParamUptimeHttpMethod,
  ParamUptimeIntervalSeconds,
  ParamUptimeMonitorStatus,
  ParamUptimeTimeoutMs,
  toUptimeMonitorSummary,
  uptimeMonitorSummarySchema,
} from "./support/uptime-monitors";

export const updateUptimeMonitorOutputSchema = z.object({
  monitor: uptimeMonitorSummarySchema,
});

export default defineTool({
  name: "update_uptime_monitor",
  skills: ["project-management"],
  requiredScopes: ["project:write"],
  description: [
    "Update a Sentry HTTP uptime monitor.",
    "",
    "Use this tool when you need to:",
    "- Change URL, interval, timeout, method, headers, or body",
    "- Enable or disable a monitor (`status`)",
    "- Update owner, environment, or failure thresholds",
    "",
    "Be careful when using this tool!",
    "",
    "<examples>",
    "update_uptime_monitor(organizationSlug='my-organization', projectSlug='backend', uptimeMonitorId='12345', status='disabled')",
    "update_uptime_monitor(organizationSlug='my-organization', projectSlug='backend', uptimeMonitorId='12345', intervalSeconds=300, timeoutMs=8000)",
    "</examples>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    regionUrl: ParamRegionUrl.nullable().default(null),
    projectSlug: ParamProjectSlug,
    uptimeMonitorId: z
      .string()
      .trim()
      .min(1)
      .describe("Uptime monitor ID (detector id)."),
    name: z.string().trim().min(1).max(128).nullable().default(null),
    url: z.string().url().nullable().default(null),
    intervalSeconds: ParamUptimeIntervalSeconds.nullable().default(null),
    timeoutMs: ParamUptimeTimeoutMs.nullable().default(null),
    method: ParamUptimeHttpMethod.nullable().default(null),
    headers: ParamUptimeHeaders.nullable().default(null),
    body: z.string().nullable().default(null),
    assertion: z.unknown().nullable().default(null),
    status: ParamUptimeMonitorStatus.nullable().default(null),
    owner: z.string().trim().nullable().default(null),
    environment: z.string().trim().max(64).nullable().default(null),
    traceSampling: z.boolean().nullable().default(null),
    responseCaptureEnabled: z.boolean().nullable().default(null),
    recoveryThreshold: z.number().int().min(1).nullable().default(null),
    downtimeThreshold: z.number().int().min(1).nullable().default(null),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  outputSchema: updateUptimeMonitorOutputSchema,
  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl ?? undefined,
    });
    const organizationSlug = params.organizationSlug;
    setTag("organization.slug", organizationSlug);
    setTag("project.slug", params.projectSlug);
    setTag("uptime.monitor_id", params.uptimeMonitorId);

    assertProjectRefWithinConstraint({
      resourceLabel: "Uptime monitor",
      scopedProjectSlug: context.constraints.projectSlug,
      project: { slug: params.projectSlug },
    });

    const hasUpdate =
      params.name !== null ||
      params.url !== null ||
      params.intervalSeconds !== null ||
      params.timeoutMs !== null ||
      params.method !== null ||
      params.headers !== null ||
      params.body !== null ||
      params.assertion !== null ||
      params.status !== null ||
      params.owner !== null ||
      params.environment !== null ||
      params.traceSampling !== null ||
      params.responseCaptureEnabled !== null ||
      params.recoveryThreshold !== null ||
      params.downtimeThreshold !== null;

    if (!hasUpdate) {
      throw new UserInputError(
        "Provide at least one field to update on the uptime monitor.",
      );
    }

    const monitor = await apiService.updateUptimeMonitor({
      organizationSlug,
      projectSlug: params.projectSlug,
      uptimeMonitorId: params.uptimeMonitorId,
      name: params.name ?? undefined,
      url: params.url ?? undefined,
      intervalSeconds: params.intervalSeconds ?? undefined,
      timeoutMs: params.timeoutMs ?? undefined,
      method: params.method ?? undefined,
      headers: params.headers ?? undefined,
      body: params.body ?? undefined,
      assertion: params.assertion ?? undefined,
      status: params.status ?? undefined,
      owner: params.owner ?? undefined,
      environment: params.environment ?? undefined,
      traceSampling: params.traceSampling ?? undefined,
      responseCaptureEnabled: params.responseCaptureEnabled ?? undefined,
      recoveryThreshold: params.recoveryThreshold ?? undefined,
      downtimeThreshold: params.downtimeThreshold ?? undefined,
    });

    return structuredResult({
      monitor: toUptimeMonitorSummary(
        monitor,
        apiService.getUptimeMonitorUrl(organizationSlug, monitor.id),
      ),
    });
  },
});
