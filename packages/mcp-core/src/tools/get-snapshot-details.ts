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
import { blobToBase64 } from "../internal/blob-utils";

interface SnapshotImageEntry {
  display_name?: string | null;
  group?: string | null;
  image_file_name?: string;
  [key: string]: unknown;
}

interface SnapshotDiffPair {
  base_image?: SnapshotImageEntry;
  head_image?: SnapshotImageEntry;
  diff?: number | null;
}

interface SnapshotImageContext {
  preview?: { container_display_name?: string; display_name?: string };
  simulator?: { device_name?: string };
  test_name?: string;
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
  context?: SnapshotImageContext;
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

function getImageDisplayName(img: SnapshotImageEntry): string {
  return img.display_name || img.image_file_name || "unknown";
}

function formatImageLine(img: SnapshotImageEntry): string {
  const name = getImageDisplayName(img);
  const group = img.group ? ` (${img.group})` : "";
  const file =
    img.image_file_name && img.image_file_name !== img.display_name
      ? ` — file: \`${img.image_file_name}\``
      : "";
  return `- \`${name}\`${group}${file}`;
}

export default defineTool({
  name: "get_snapshot_details",
  internalOnly: true,
  skills: ["preprod"],
  requiredScopes: ["project:read"],
  description: [
    "Get details of a preprod snapshot comparison, including image index and diff summary.",
    "When selectedSnapshot is provided, fetches the actual image and full metadata for that image.",
    "",
    "Use this tool when you need to:",
    "- Investigate a failed snapshot test from CI",
    "- Browse what images exist in a snapshot build",
    "- View a specific image from a snapshot (via selectedSnapshot param or ?selectedSnapshot= in URL)",
    "",
    "Returns compact image metadata (display_name, image_file_name, group, description) for all images.",
    "To view a specific image, use get_sentry_resource with a snapshot URL containing ?selectedSnapshot=<image_file_name>.",
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
    "</examples>",
    "",
    "<hints>",
    "- Response includes compact metadata per image (display_name, image_file_name, group, description).",
    "- To view an image, use get_sentry_resource with snapshot URL + ?selectedSnapshot=<image_file_name>.",
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
        "Image file name to fetch. When provided, returns the image binary + full metadata instead of the snapshot summary.",
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

function formatImageMetadata(img: SnapshotImageInfo): string[] {
  const lines: string[] = [];
  if (img.display_name) lines.push(`- **Display Name**: ${img.display_name}`);
  if (img.group) lines.push(`- **Group**: ${img.group}`);
  if (img.image_file_name) lines.push(`- **File**: \`${img.image_file_name}\``);
  if (img.width || img.height)
    lines.push(`- **Dimensions**: ${img.width}×${img.height}`);
  if (img.description) lines.push(`- **Description**: ${img.description}`);
  if (img.context?.preview?.container_display_name)
    lines.push(
      `- **Container**: ${img.context.preview.container_display_name}`,
    );
  if (img.context?.simulator?.device_name)
    lines.push(`- **Device**: ${img.context.simulator.device_name}`);
  if (img.context?.test_name)
    lines.push(`- **Test**: ${img.context.test_name}`);
  return lines;
}

async function fetchAndAppendImage(
  apiService: ReturnType<typeof apiServiceFromContext>,
  imageUrl: string,
  label: string,
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
  parts.push({ type: "text", text: `### ${label}` });
  parts.push({
    type: "image",
    data: await blobToBase64(blob),
    mimeType: contentType,
  });
}

async function fetchSnapshotImage(
  apiService: ReturnType<typeof apiServiceFromContext>,
  organizationSlug: string,
  snapshotId: string,
  imageName: string,
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
      `- **Diff**: ${Math.round(detail.diff_percentage * 10000) / 100}%`,
    );
  if (detail.previous_image_file_name)
    lines.push(`- **Previous File**: \`${detail.previous_image_file_name}\``);

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
      contentParts,
    );
  }

  if (baseImage?.image_url && baseImage.image_url !== headImage?.image_url) {
    await fetchAndAppendImage(
      apiService,
      baseImage.image_url,
      "Base (previous)",
      contentParts,
    );
  }

  if (detail.diff_image_url) {
    await fetchAndAppendImage(
      apiService,
      detail.diff_image_url,
      "Diff Mask",
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

  const changedCount = (data.changed_count as number) ?? changed.length;
  const addedCount = (data.added_count as number) ?? added.length;
  const removedCount = (data.removed_count as number) ?? removed.length;
  const renamedCount = (data.renamed_count as number) ?? renamed.length;
  const unchangedCount = (data.unchanged_count as number) ?? 0;
  const erroredCount = (data.errored_count as number) ?? errored.length;
  sections.push(
    `- **Images**: ${allImages.length} total (${changedCount} changed, ${addedCount} added, ${removedCount} removed, ${renamedCount} renamed, ${unchangedCount} unchanged, ${erroredCount} errored)`,
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

    if (changed.length > 0) {
      sections.push("**Changed:**");
      for (const pair of changed) {
        const img = pair.head_image ?? {};
        const name = getImageDisplayName(img);
        const group = img.group ? ` (${img.group})` : "";
        const file =
          img.image_file_name && img.image_file_name !== img.display_name
            ? ` — file: \`${img.image_file_name}\``
            : "";
        const diff =
          pair.diff != null
            ? ` — ${Math.round(pair.diff * 10000) / 100}% diff`
            : "";
        sections.push(`- \`${name}\`${group}${file}${diff}`);
      }
    }

    if (added.length > 0) {
      sections.push("\n**Added:**");
      for (const img of added) sections.push(formatImageLine(img));
    }

    if (removed.length > 0) {
      sections.push("\n**Removed:**");
      for (const img of removed) sections.push(formatImageLine(img));
    }

    if (renamed.length > 0) {
      sections.push("\n**Renamed:**");
      for (const pair of renamed) {
        const newName = getImageDisplayName(pair.head_image ?? {});
        const oldName = getImageDisplayName(pair.base_image ?? {});
        sections.push(`- \`${oldName}\` → \`${newName}\``);
      }
    }

    if (errored.length > 0) {
      sections.push("\n**Errored:**");
      for (const pair of errored)
        sections.push(formatImageLine(pair.head_image ?? {}));
    }
  }

  if (allImages.length > 0) {
    sections.push("\n## All Images\n");
    for (const img of allImages) sections.push(formatImageLine(img));
  }

  sections.push(
    `\n## Next Steps\n\n- To view a specific image, use \`get_sentry_resource(url="${resolvedSnapshotUrl}?selectedSnapshot=<image_file_name>")\``,
  );

  return sections.join("\n");
}
