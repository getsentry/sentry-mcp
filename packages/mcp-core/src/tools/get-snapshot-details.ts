import { z } from "zod";
import { setTag } from "@sentry/core";
import type {
  TextContent,
  ImageContent,
} from "@modelcontextprotocol/sdk/types.js";
import { defineTool } from "../internal/tool-helpers/define";
import { apiServiceFromContext } from "../internal/tool-helpers/api";
import type { ServerContext } from "../types";
import { UserInputError } from "../errors";
import { ParamOrganizationSlug, ParamRegionUrl } from "../schema";
import { resolveSnapshotParams } from "../internal/url-helpers";
import {
  blobToBase64,
  createImagePreview,
  type ImagePreviewResult,
} from "../internal/blob-utils";
import {
  formatSnapshotDiffPercent,
  getSnapshotImageDisplayName,
  renderSnapshotImageContext,
  renderSnapshotImageTreeSection,
  type SnapshotImageEntry,
  type SnapshotImageTreeItem,
} from "./snapshot-formatting";

interface SnapshotDiffPair {
  base_image?: SnapshotImageEntry;
  head_image?: SnapshotImageEntry;
  diff?: number | null;
}

interface SnapshotImageInfo {
  content_hash?: string;
  display_name?: string | null;
  group?: string | null;
  image_file_name?: string;
  width?: number;
  height?: number;
  description?: string | null;
  image_url?: string;
  context?: unknown;
  [key: string]: unknown;
}

interface SnapshotImageDetailResponse {
  image_file_name?: string;
  comparison_status?:
    | "added"
    | "removed"
    | "changed"
    | "unchanged"
    | "renamed"
    | "errored"
    | "skipped"
    | null;
  head_image?: SnapshotImageInfo | null;
  base_image?: SnapshotImageInfo | null;
  diff_image_url?: string | null;
  diff_percentage?: number | null;
  previous_image_file_name?: string | null;
}

type SnapshotImageResolution = "preview" | "full";

export default defineTool({
  name: "get_snapshot_details",
  internalOnly: true,
  skills: ["preprod"],
  requiredScopes: ["project:read"],
  description: [
    "Get details of a preprod snapshot comparison, including image index and diff summary.",
    "When selectedSnapshot is provided, fetches preview images and full metadata for that image by default.",
    "",
    "Use this tool when you need to:",
    "- Investigate a failed snapshot test from CI",
    "- Browse what images exist in a snapshot build",
    "- View a specific image from a snapshot (via selectedSnapshot param or ?selectedSnapshot= in URL)",
    "",
    "Returns compact image metadata (display_name, image_file_name, group, description) for all images.",
    "To view a specific image preview, use get_sentry_resource with a snapshot URL containing ?selectedSnapshot=<image_file_name>.",
    "To fetch original full-resolution image bytes, append &imageResolution=full to that snapshot URL.",
    "",
    "<examples>",
    "### Browse all images in a snapshot",
    "",
    "```",
    'get_snapshot_details(snapshotUrl="https://sentry.sentry.io/preprod/snapshots/231949/")',
    "```",
    "",
    "### View a specific image",
    "",
    "```",
    'get_snapshot_details(snapshotUrl="https://sentry.sentry.io/preprod/snapshots/231949/?selectedSnapshot=login_screen.png")',
    "```",
    "",
    "### View the original full-resolution image",
    "",
    "```",
    'get_snapshot_details(snapshotUrl="https://sentry.sentry.io/preprod/snapshots/231949/?selectedSnapshot=login_screen.png&imageResolution=full")',
    "```",
    "</examples>",
    "",
    "<hints>",
    "- Response includes compact metadata per image (display_name, image_file_name, group, description).",
    "- To view an image preview, use get_sentry_resource with snapshot URL + ?selectedSnapshot=<image_file_name>.",
    "- To view original full-resolution image bytes, append &imageResolution=full.",
    "- The diff_percent field shows what percentage of pixels changed (0-100).",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    snapshotUrl: z
      .string()
      .trim()
      .describe(
        "Full URL to the snapshot page, e.g. https://sentry.sentry.io/preprod/snapshots/231949/",
      )
      .nullable()
      .default(null),
    organizationSlug: ParamOrganizationSlug.nullable().default(null),
    snapshotId: z
      .string()
      .trim()
      .describe("The numeric snapshot artifact ID.")
      .nullable()
      .default(null),
    selectedSnapshot: z
      .string()
      .trim()
      .describe(
        "Image file name to fetch. When provided, returns preview image bytes + full metadata instead of the snapshot summary.",
      )
      .nullable()
      .default(null),
    regionUrl: ParamRegionUrl.nullable().default(null),
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    const { organizationSlug, snapshotId } = resolveSnapshotParams(params);
    const imageResolution = resolveImageResolution(params.snapshotUrl);

    setTag("organization.slug", organizationSlug);

    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl ?? undefined,
    });

    if (params.selectedSnapshot) {
      return fetchSnapshotImage(
        apiService,
        organizationSlug,
        snapshotId,
        params.selectedSnapshot,
        imageResolution,
      );
    }

    return fetchSnapshotSummary(
      apiService,
      organizationSlug,
      snapshotId,
      params.snapshotUrl,
    );
  },
});

function countField(
  data: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = data[key];
  return typeof value === "number" ? value : fallback;
}

function resolveImageResolution(
  snapshotUrl: string | null,
): SnapshotImageResolution {
  if (!snapshotUrl) {
    return "preview";
  }

  const value = new URL(snapshotUrl).searchParams.get("imageResolution");
  if (!value) {
    return "preview";
  }

  if (value === "full" || value === "preview") {
    return value;
  }

  throw new UserInputError(
    "Invalid imageResolution query value. Use imageResolution=full or omit it for preview images.",
  );
}

function formatImageMetadata(img: SnapshotImageInfo): string[] {
  const lines: string[] = [];
  if (img.display_name) lines.push(`- **Display Name**: ${img.display_name}`);
  if (img.group) lines.push(`- **Group**: ${img.group}`);
  if (img.image_file_name) lines.push(`- **File**: \`${img.image_file_name}\``);
  if (img.width || img.height)
    lines.push(`- **Dimensions**: ${img.width}×${img.height}`);
  if (img.description) lines.push(`- **Description**: ${img.description}`);
  const contextLines = renderSnapshotImageContext(img.context);
  if (contextLines.length > 0) {
    lines.push("", "### Context", ...contextLines);
  }
  return lines;
}

async function fetchAndAppendImage(
  apiService: ReturnType<typeof apiServiceFromContext>,
  imageUrl: string,
  label: string,
  imageResolution: SnapshotImageResolution,
  parts: (TextContent | ImageContent)[],
): Promise<void> {
  const { blob, contentType } = await apiService.fetchImageByUrl(imageUrl);
  if (!contentType.startsWith("image/")) {
    parts.push({
      type: "text",
      text: `(${label}: unexpected content type ${contentType})`,
    });
    return;
  }

  if (imageResolution === "full") {
    parts.push({ type: "text", text: `### ${label} — full` });
    parts.push({
      type: "image",
      data: await blobToBase64(blob),
      mimeType: contentType,
    });
    return;
  }

  const preview = await createPreviewOrNull(blob, contentType);
  if (!preview) {
    parts.push({
      type: "text",
      text: `### ${label} — preview unavailable. Retry with imageResolution=full to fetch the original image.`,
    });
    return;
  }

  parts.push({ type: "text", text: `### ${label} — preview` });
  parts.push({
    type: "image",
    data: await blobToBase64(preview.blob),
    mimeType: preview.contentType,
  });
}

async function createPreviewOrNull(
  blob: Blob,
  contentType: string,
): Promise<ImagePreviewResult | null> {
  try {
    return await createImagePreview(blob, contentType);
  } catch {
    return null;
  }
}

async function fetchSnapshotImage(
  apiService: ReturnType<typeof apiServiceFromContext>,
  organizationSlug: string,
  snapshotId: string,
  imageName: string,
  imageResolution: SnapshotImageResolution,
): Promise<(TextContent | ImageContent)[]> {
  const detail = (await apiService.getSnapshotImageDetail({
    organizationSlug,
    snapshotId,
    imageIdentifier: imageName,
  })) as SnapshotImageDetailResponse;

  const headImage = detail.head_image;
  const baseImage = detail.base_image;
  const status = detail.comparison_status;

  if (!headImage?.image_url && !baseImage?.image_url) {
    throw new UserInputError(
      `No image data returned for "${imageName}". The image may not exist in this snapshot.`,
    );
  }

  const lines: string[] = [`## ${imageName}\n`];
  if (status) lines.push(`- **Status**: ${status}`);
  if (detail.diff_percentage != null)
    lines.push(
      `- **Diff**: ${formatSnapshotDiffPercent(detail.diff_percentage)}`,
    );
  if (detail.previous_image_file_name)
    lines.push(`- **Previous File**: \`${detail.previous_image_file_name}\``);
  lines.push(`- **Image Resolution**: ${imageResolution}`);
  if (imageResolution === "preview") {
    lines.push(
      "- **Full Resolution**: append `&imageResolution=full` to the snapshot URL",
    );
  }

  const primary = headImage ?? baseImage;
  if (primary) lines.push(...formatImageMetadata(primary));

  const contentParts: (TextContent | ImageContent)[] = [
    { type: "text", text: lines.join("\n") },
  ];

  if (headImage?.image_url) {
    await fetchAndAppendImage(
      apiService,
      headImage.image_url,
      "Head (current)",
      imageResolution,
      contentParts,
    );
  }

  if (baseImage?.image_url && baseImage.image_url !== headImage?.image_url) {
    await fetchAndAppendImage(
      apiService,
      baseImage.image_url,
      "Base (previous)",
      imageResolution,
      contentParts,
    );
  }

  if (detail.diff_image_url) {
    await fetchAndAppendImage(
      apiService,
      detail.diff_image_url,
      "Diff Mask",
      imageResolution,
      contentParts,
    );
  }

  return contentParts;
}

async function fetchSnapshotSummary(
  apiService: ReturnType<typeof apiServiceFromContext>,
  organizationSlug: string,
  snapshotId: string,
  snapshotUrl: string | null,
): Promise<string> {
  const data = (await apiService.getSnapshotDetails({
    organizationSlug,
    snapshotId,
    compactMetadata: true,
  })) as Record<string, unknown>;

  const vcsInfo = data.vcs_info as Record<string, unknown> | undefined;
  const approvalInfo = data.approval_info as
    | Record<string, unknown>
    | undefined;

  const allImages = (data.images as SnapshotImageEntry[]) || [];
  const changed = (data.changed as SnapshotDiffPair[]) || [];
  const renamed = (data.renamed as SnapshotDiffPair[]) || [];
  const added = (data.added as SnapshotImageEntry[]) || [];
  const removed = (data.removed as SnapshotImageEntry[]) || [];
  const errored = (data.errored as SnapshotDiffPair[]) || [];

  const resolvedSnapshotUrl =
    snapshotUrl ||
    `https://${organizationSlug}.sentry.io/preprod/snapshots/${snapshotId}/`;

  const sections: string[] = [];

  sections.push(`# Snapshot ${snapshotId} in **${organizationSlug}**`);

  sections.push("\n## Summary\n");
  sections.push(`- **URL**: ${resolvedSnapshotUrl}`);
  sections.push(`- **Type**: ${data.comparison_type ?? "unknown"}`);
  sections.push(`- **State**: ${data.state ?? "unknown"}`);
  if (data.project_id) {
    sections.push(`- **Project ID**: ${data.project_id}`);
  }

  const totalCount = countField(data, "total_count", allImages.length);
  const changedCount = countField(data, "changed_count", changed.length);
  const addedCount = countField(data, "added_count", added.length);
  const removedCount = countField(data, "removed_count", removed.length);
  const renamedCount = countField(data, "renamed_count", renamed.length);
  const unchangedCount = countField(data, "unchanged_count", 0);
  const erroredCount = countField(data, "errored_count", errored.length);
  const skippedCount = countField(data, "skipped_count", 0);
  sections.push(
    `- **Images**: ${totalCount} total (${changedCount} changed, ${addedCount} added, ${removedCount} removed, ${renamedCount} renamed, ${unchangedCount} unchanged, ${erroredCount} errored, ${skippedCount} skipped)`,
  );

  if (vcsInfo) {
    sections.push("\n## VCS Info\n");
    if (vcsInfo.repo_name) sections.push(`- **Repo**: ${vcsInfo.repo_name}`);
    if (vcsInfo.head_ref)
      sections.push(
        `- **Head**: ${vcsInfo.head_ref} (\`${String(vcsInfo.head_sha ?? "").slice(0, 8)}\`)`,
      );
    if (vcsInfo.base_ref)
      sections.push(
        `- **Base**: ${vcsInfo.base_ref} (\`${String(vcsInfo.base_sha ?? "").slice(0, 8)}\`)`,
      );
    if (vcsInfo.pr_number) sections.push(`- **PR**: #${vcsInfo.pr_number}`);
  }

  if (approvalInfo) {
    const status = approvalInfo.status ?? "unknown";
    const auto = approvalInfo.is_auto_approved ? " (auto-approved)" : "";
    sections.push(`\n- **Approval**: ${status}${auto}`);
  }

  const hasDiffs =
    changed.length > 0 ||
    renamed.length > 0 ||
    added.length > 0 ||
    removed.length > 0 ||
    errored.length > 0;

  if (hasDiffs) {
    sections.push("\n## Changes\n");

    const sortedChanged = changed
      .slice()
      .sort((left, right) => (right.diff ?? -1) - (left.diff ?? -1));

    const diffSections: Array<{
      title: string;
      items: SnapshotImageTreeItem[];
    }> = [
      {
        title: "Changed",
        items: sortedChanged.map((pair) => ({
          image: pair.head_image ?? {},
          details:
            pair.diff != null
              ? [`${formatSnapshotDiffPercent(pair.diff)} diff`]
              : [],
        })),
      },
      { title: "Added", items: added.map((image) => ({ image })) },
      { title: "Removed", items: removed.map((image) => ({ image })) },
      {
        title: "Renamed",
        items: renamed.map((pair) => ({
          image: pair.head_image ?? {},
          details: [
            `previous: ${getSnapshotImageDisplayName(pair.base_image ?? {})}`,
          ],
        })),
      },
      {
        title: "Errored",
        items: errored.map((pair) => ({ image: pair.head_image ?? {} })),
      },
    ];

    const renderedDiffs = diffSections
      .map(({ title, items }) => renderSnapshotImageTreeSection(title, items))
      .filter((lines) => lines.length > 0);
    for (const [index, lines] of renderedDiffs.entries()) {
      if (index > 0) sections.push("");
      sections.push(...lines);
    }
  } else if (allImages.length > 0) {
    sections.push("\n## Images\n");
    sections.push(
      ...renderSnapshotImageTreeSection(
        "Snapshot Images",
        allImages.map((image) => ({ image })),
      ),
    );
  }

  sections.push(
    `\n## Next Steps\n\n- To view a specific image preview, use \`get_sentry_resource(url="${resolvedSnapshotUrl}?selectedSnapshot=<image_file_name>")\`\n- To fetch original full-resolution image bytes, append \`&imageResolution=full\` to the selected-image URL`,
  );

  return sections.join("\n");
}
