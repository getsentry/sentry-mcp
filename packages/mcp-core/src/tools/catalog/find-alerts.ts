import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../../internal/tool-helpers/define";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import type { Detector, Workflow } from "../../api-client/types";
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
} from "./support/api-formatting";

function formatWorkflow(workflow: Workflow): string {
  const createdBy = workflow.createdBy ? formatActor(workflow.createdBy) : null;
  const detectorCount =
    workflow.detectorIds?.length ?? workflow.detectors?.length;
  const actionCount = workflow.actionFilters?.length;

  return compactLines([
    `## ${workflow.name}`,
    "",
    `**Alert ID**: ${formatId(workflow.id)}`,
    workflow.enabled !== undefined && workflow.enabled !== null
      ? `**Enabled**: ${workflow.enabled ? "yes" : "no"}`
      : null,
    createdBy ? `**Created By**: ${createdBy}` : null,
    workflow.environment ? `**Environment**: ${workflow.environment}` : null,
    detectorCount !== undefined
      ? `**Connected Detectors**: ${detectorCount}`
      : null,
    actionCount !== undefined ? `**Action Filters**: ${actionCount}` : null,
    formatDate(workflow.dateCreated)
      ? `**Created**: ${formatDate(workflow.dateCreated)}`
      : null,
    formatDate(workflow.dateUpdated)
      ? `**Updated**: ${formatDate(workflow.dateUpdated)}`
      : null,
  ]).join("\n");
}

function formatDetector(detector: Detector): string {
  const project =
    detector.project?.slug ??
    detector.project?.name ??
    (detector.projectId !== undefined ? formatId(detector.projectId) : null);
  const owner = detector.owner ? formatActor(detector.owner) : null;

  return compactLines([
    `- ${detector.name} (${formatId(detector.id)})`,
    detector.type ? `  - Type: ${detector.type}` : null,
    detector.enabled !== undefined && detector.enabled !== null
      ? `  - Enabled: ${detector.enabled ? "yes" : "no"}`
      : null,
    project ? `  - Project: ${project}` : null,
    owner ? `  - Owner: ${owner}` : null,
  ]).join("\n");
}

export default defineTool({
  name: "find_alerts",
  skills: ["inspect"],
  requiredScopes: ["org:read"],
  description: [
    "Find Sentry alerts.",
    "",
    "Use this tool when you need to:",
    "- List alert workflows in an organization",
    "- Search alerts by name or action",
    "- Find alert IDs before calling `get_alert_details`",
    "- Inspect connected monitors/detectors at a high level",
    "",
    "<examples>",
    "find_alerts(organizationSlug='my-organization')",
    "find_alerts(organizationSlug='my-organization', query='slack')",
    "find_alerts(organizationSlug='my-organization', projectSlug='backend', includeDetectors=true)",
    "</examples>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    regionUrl: ParamRegionUrl.nullable().default(null),
    projectSlug: ParamProjectSlugOrAll.nullable().default(null),
    query: z
      .string()
      .trim()
      .describe("Optional alert search query. Supports alert name/action text.")
      .nullable()
      .default(null),
    detectorId: z
      .string()
      .trim()
      .describe(
        "Optional detector ID to prioritize or filter connected alert workflows.",
      )
      .nullable()
      .default(null),
    includeDetectors: z.boolean().default(true),
    limit: z.number().int().positive().max(100).default(10),
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

    const project =
      params.projectSlug && params.projectSlug !== "all"
        ? params.projectSlug
        : undefined;

    const [workflows, detectors] = await Promise.all([
      apiService.listWorkflows({
        organizationSlug,
        projectSlug: project,
        query: params.query ?? undefined,
        detectorId: params.detectorId ?? undefined,
        limit: params.limit,
      }),
      params.includeDetectors
        ? apiService.listDetectors({
            organizationSlug,
            projectSlug: project,
            query: params.query ?? undefined,
            limit: params.limit,
          })
        : Promise.resolve([]),
    ]);

    const output = [`# Alerts in **${organizationSlug}**`, ""];

    if (workflows.length === 0) {
      output.push("No alert workflows found.");
    } else {
      output.push(
        workflows.slice(0, params.limit).map(formatWorkflow).join("\n\n"),
      );
    }

    if (params.includeDetectors) {
      output.push("", "## Connected Monitors And Detectors", "");
      output.push(
        detectors.length === 0
          ? "No detectors found."
          : detectors.slice(0, params.limit).map(formatDetector).join("\n"),
      );
    }

    output.push("", "## Response Notes", "");
    output.push(
      "- Use `get_alert_details` with an alert ID for full workflow details.",
    );
    output.push(
      "- Detector IDs can be used to find workflows connected to a monitor.",
    );

    return `${output.join("\n")}\n`;
  },
});
