import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../../internal/tool-helpers/define";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import type { Detector, Workflow } from "../../api-client/types";
import type { ServerContext } from "../../types";
import { ParamOrganizationSlug, ParamRegionUrl } from "../../schema";
import {
  compactLines,
  formatActor,
  formatDate,
  formatId,
  formatUnknown,
} from "./support/api-formatting";
import {
  assertProjectConstraintEvidence,
  assertProjectRefWithinConstraint,
} from "./support/project-constraints";

function formatWorkflowDetails(workflow: Workflow): string {
  const createdBy = workflow.createdBy ? formatActor(workflow.createdBy) : null;
  const trigger = workflow.triggers ?? workflow.whenConditionGroup;

  const lines = compactLines([
    `# Alert ${workflow.name}`,
    "",
    `**Alert ID**: ${formatId(workflow.id)}`,
    workflow.enabled !== undefined && workflow.enabled !== null
      ? `**Enabled**: ${workflow.enabled ? "yes" : "no"}`
      : null,
    createdBy ? `**Created By**: ${createdBy}` : null,
    workflow.environment ? `**Environment**: ${workflow.environment}` : null,
    formatDate(workflow.dateCreated)
      ? `**Created**: ${formatDate(workflow.dateCreated)}`
      : null,
    formatDate(workflow.dateUpdated)
      ? `**Updated**: ${formatDate(workflow.dateUpdated)}`
      : null,
  ]);

  if (trigger) {
    lines.push("", "## When", "", formatUnknown(trigger));
  }

  if (workflow.actionFilters && workflow.actionFilters.length > 0) {
    lines.push("", "## Actions", "");
    for (const action of workflow.actionFilters) {
      lines.push(`- ${formatUnknown(action)}`);
    }
  }

  if (workflow.detectorIds && workflow.detectorIds.length > 0) {
    lines.push("", "## Detector IDs", "");
    for (const detectorId of workflow.detectorIds) {
      lines.push(`- ${formatId(detectorId)}`);
    }
  } else if (workflow.detectors && workflow.detectors.length > 0) {
    lines.push("", "## Embedded Detectors", "");
    for (const detector of workflow.detectors) {
      lines.push(`- ${formatUnknown(detector)}`);
    }
  }

  return lines.join("\n");
}

function formatConnectedDetector(detector: Detector): string {
  const project =
    detector.project?.slug ??
    detector.project?.name ??
    (detector.projectId !== undefined ? formatId(detector.projectId) : null);
  const owner = detector.owner ? formatActor(detector.owner) : null;

  return compactLines([
    `### ${detector.name}`,
    "",
    `**Detector ID**: ${formatId(detector.id)}`,
    detector.type ? `**Type**: ${detector.type}` : null,
    detector.enabled !== undefined && detector.enabled !== null
      ? `**Enabled**: ${detector.enabled ? "yes" : "no"}`
      : null,
    project ? `**Project**: ${project}` : null,
    owner ? `**Owner**: ${owner}` : null,
    formatDate(detector.dateCreated)
      ? `**Created**: ${formatDate(detector.dateCreated)}`
      : null,
    formatDate(detector.dateUpdated)
      ? `**Updated**: ${formatDate(detector.dateUpdated)}`
      : null,
  ]).join("\n");
}

export default defineTool({
  name: "get_alert_details",
  skills: ["inspect"],
  requiredScopes: ["org:read"],
  description: [
    "Get details for a Sentry alert workflow.",
    "",
    "Use this tool when you need to:",
    "- Inspect one alert's workflow configuration",
    "- See connected detectors/monitors",
    "- Understand when conditions and notification actions",
    "",
    "<examples>",
    "get_alert_details(organizationSlug='my-organization', alertId='123')",
    "</examples>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    regionUrl: ParamRegionUrl.nullable().default(null),
    alertId: z.string().trim().min(1).describe("Alert workflow ID."),
    includeDetectors: z.boolean().default(true),
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
    setTag("alert.id", params.alertId);

    const workflow = await apiService.getWorkflow({
      organizationSlug,
      workflowId: params.alertId,
    });

    const shouldFetchDetectors =
      params.includeDetectors || Boolean(context.constraints.projectSlug);
    const detectors = shouldFetchDetectors
      ? await apiService.listDetectors({
          organizationSlug,
          workflowId: params.alertId,
          projectSlug: context.constraints.projectSlug ?? undefined,
          limit: 25,
        })
      : [];
    if (context.constraints.projectSlug) {
      assertProjectConstraintEvidence({
        resourceLabel: "Alert",
        scopedProjectSlug: context.constraints.projectSlug,
        hasEvidence: detectors.length > 0,
      });
      for (const detector of detectors) {
        assertProjectRefWithinConstraint({
          resourceLabel: "Alert",
          scopedProjectSlug: context.constraints.projectSlug,
          project: detector.project,
        });
      }
    }

    const output = [formatWorkflowDetails(workflow)];

    if (params.includeDetectors) {
      output.push("", "## Connected Detectors", "");
      output.push(
        detectors.length === 0
          ? "No connected detectors found."
          : detectors.map(formatConnectedDetector).join("\n\n"),
      );
    }

    output.push("", "## Response Notes", "");
    output.push(
      "- Alert workflows are the workflow-engine representation of Sentry alerts.",
    );

    return `${output.join("\n")}\n`;
  },
});
