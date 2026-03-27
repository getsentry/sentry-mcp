import { setTag } from "@sentry/core";
import { z } from "zod";
import { defineTool } from "../internal/tool-helpers/define";
import { apiServiceFromContext } from "../internal/tool-helpers/api";
import type { ServerContext } from "../types";
import { ParamOrganizationSlug, ParamRegionUrl } from "../schema";
import { isNumericId } from "../utils/slug-validation";
import { formatProfileChunkAnalysis } from "./profile/formatter";

export default defineTool({
  name: "get_profile_details",
  skills: ["inspect"],
  requiredScopes: ["event:read"],
  requiredCapabilities: ["profiles"],
  hideInExperimentalMode: true,

  description: [
    "Retrieve raw profile chunk data to inspect individual function calls, threads, and stack traces.",
    "",
    "USE THIS TOOL WHEN:",
    "- User wants to inspect raw profiling samples for a specific profiler session",
    "- User needs to see individual thread activity and stack traces",
    "- User wants detailed frame-level data (function names, file locations, call counts)",
    "",
    "RETURNS:",
    "- Profile chunk metadata (platform, release, environment)",
    "- Per-thread sample counts and names",
    "- Top frames by occurrence with file locations",
    "- User code vs library code breakdown",
    "",
    "NOTE: This tool requires a `profilerId` which identifies a specific profiling session.",
    "Use `get_profile` for aggregated flamegraph analysis by transaction name.",
    "",
    "<examples>",
    "### Inspect a profiler session",
    "```",
    "get_profile_details(",
    "  organizationSlug='my-org',",
    "  projectSlugOrId='backend',",
    "  profilerId='041bde57b9844e36b8b7e5734efae5f7',",
    "  start='2024-01-01T00:00:00',",
    "  end='2024-01-01T01:00:00'",
    ")",
    "```",
    "</examples>",
    "",
    "<hints>",
    "- Use `focusOnUserCode: true` (default) to filter out library/system frames",
    "- The profilerId can be found in Sentry profile URLs or event data",
    "</hints>",
  ].join("\n"),

  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    regionUrl: ParamRegionUrl.nullable().default(null),
    projectSlugOrId: z
      .union([z.string(), z.number()])
      .describe("Project slug or numeric ID"),
    profilerId: z
      .string()
      .trim()
      .describe("Profiler session ID (UUID from Sentry profile data)"),
    start: z
      .string()
      .trim()
      .describe(
        "Start time for the profile chunk query (ISO 8601 format, e.g., '2024-01-01T00:00:00')",
      ),
    end: z
      .string()
      .trim()
      .describe(
        "End time for the profile chunk query (ISO 8601 format, e.g., '2024-01-01T01:00:00')",
      ),
    focusOnUserCode: z
      .boolean()
      .default(true)
      .describe(
        "Show only user code (in_app: true). Set to false to include library code.",
      ),
  },

  annotations: { readOnlyHint: true, openWorldHint: false },

  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl ?? undefined,
    });

    const {
      organizationSlug,
      projectSlugOrId,
      profilerId,
      start,
      end,
      focusOnUserCode,
    } = params;

    setTag("organization.slug", organizationSlug);
    setTag("profiler.id", profilerId);

    // Resolve project slug to numeric ID (profiling API requires numeric IDs)
    let projectId: string | number;
    if (
      typeof projectSlugOrId === "number" ||
      isNumericId(String(projectSlugOrId))
    ) {
      projectId = projectSlugOrId;
      setTag("project.id", String(projectSlugOrId));
    } else {
      const project = await apiService.getProject({
        organizationSlug,
        projectSlugOrId: String(projectSlugOrId),
      });
      projectId = project.id;
      setTag("project.slug", String(projectSlugOrId));
      setTag("project.id", String(project.id));
    }

    const chunk = await apiService.getProfileChunk({
      organizationSlug,
      profilerId,
      projectId,
      start,
      end,
    });

    return formatProfileChunkAnalysis(chunk, { focusOnUserCode });
  },
});
