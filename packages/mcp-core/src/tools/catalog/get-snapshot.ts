import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../../internal/tool-helpers/define";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import type { ServerContext } from "../../types";
import { ParamOrganizationSlug, ParamRegionUrl } from "../../schema";
import { UserInputError } from "../../errors";
import { fetchSnapshotSummary } from "../support/snapshots/handlers";

export default defineTool({
  name: "get_snapshot",
  skills: ["preprod"],
  requiredScopes: ["project:read"],
  description: [
    "Get a preprod snapshot comparison summary, including metadata, counts, and changed image sections.",
    "",
    "Use this tool when you need to:",
    "- Investigate a failed snapshot test from CI",
    "- Review what changed in a specific preprod snapshot",
    "- Browse snapshot image file names before viewing a specific image",
    "",
    "Pass organizationSlug and snapshotId. Use get_sentry_resource for snapshot URLs.",
    "Compact output is returned by default. Set showUnmodified=true to list unchanged and skipped images separately.",
    "",
    "<examples>",
    "### Browse a snapshot",
    "",
    "```",
    'get_snapshot(organizationSlug="sentry", snapshotId="231949")',
    "```",
    "",
    "### Include unchanged and skipped images",
    "",
    "```",
    'get_snapshot(organizationSlug="sentry", snapshotId="231949", showUnmodified=true)',
    "```",
    "</examples>",
    "",
    "<hints>",
    "- Use get_snapshot_image to view a specific image preview or full-resolution image bytes.",
    "- Use get_sentry_resource when starting from a Sentry snapshot URL.",
    "- The diff percent field shows what percentage of pixels changed (0-100).",
    "- showUnmodified=true is useful when a diff snapshot has no changed image sections.",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    snapshotId: z
      .string()
      .trim()
      .min(1)
      .describe("The numeric snapshot artifact ID."),
    showUnmodified: z
      .boolean()
      .describe(
        "When true, include unchanged and skipped image sections. This can substantially increase response size and token usage for large snapshots.",
      )
      .default(false),
    regionUrl: ParamRegionUrl.nullable().default(null),
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    if (!params.organizationSlug || !params.snapshotId) {
      throw new UserInputError(
        "Provide both organizationSlug and snapshotId. Use get_sentry_resource for snapshot URLs.",
      );
    }

    setTag("organization.slug", params.organizationSlug);

    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl ?? undefined,
    });

    return fetchSnapshotSummary(
      apiService,
      params.organizationSlug,
      params.snapshotId,
      null,
      {
        showUnmodified: params.showUnmodified,
        listImagesWhenNoDiffs: true,
        nextSteps: "snapshot-tools",
      },
    );
  },
});
