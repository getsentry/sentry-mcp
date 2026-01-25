import { setTag } from "@sentry/core";
import { z } from "zod";
import { defineTool } from "../internal/tool-helpers/define";
import { apiServiceFromContext } from "../internal/tool-helpers/api";
import { UserInputError } from "../errors";
import type { ServerContext } from "../types";
import { ParamOrganizationSlug, ParamRegionUrl } from "../schema";
import { isNumericId } from "../utils/slug-validation";
import {
  formatFlamegraphAnalysis,
  formatFlamegraphComparison,
} from "./profile/formatter";
import { hasProfileData } from "./profile/analyzer";
import { parseSentryUrl, isProfileUrl } from "../internal/url-helpers";

interface ResolvedProfileParams {
  organizationSlug: string;
  projectSlugOrId?: string | number;
  transactionName?: string;
}

/**
 * Resolves profile parameters from URL or explicit params.
 * URL takes precedence if provided and valid.
 */
function resolveProfileParams(params: {
  profileUrl?: string | null;
  organizationSlug?: string | null;
  projectSlugOrId?: string | number | null;
  transactionName?: string | null;
}): ResolvedProfileParams {
  // URL-based resolution
  if (params.profileUrl) {
    if (!isProfileUrl(params.profileUrl)) {
      throw new UserInputError(
        "Invalid profile URL. URL must be a Sentry profile URL (containing /profiling/profile/).",
      );
    }
    const parsed = parseSentryUrl(params.profileUrl);
    return {
      organizationSlug: parsed.organizationSlug,
      projectSlugOrId:
        parsed.projectSlug ?? params.projectSlugOrId ?? undefined,
      transactionName: params.transactionName ?? undefined,
    };
  }

  // Explicit params resolution
  if (!params.organizationSlug) {
    throw new UserInputError(
      "Organization slug is required. Provide either a profileUrl or organizationSlug parameter.",
    );
  }

  return {
    organizationSlug: params.organizationSlug,
    projectSlugOrId: params.projectSlugOrId ?? undefined,
    transactionName: params.transactionName ?? undefined,
  };
}

export default defineTool({
  name: "get_profile",
  skills: ["inspect"],
  requiredScopes: ["event:read"],
  requiredCapabilities: ["profiles"],
  hideInExperimentalMode: true, // Replaced by get_sentry_resource in experimental mode

  description: [
    "Analyze CPU profiling data to identify performance bottlenecks and detect regressions.",
    "",
    "USE THIS TOOL WHEN:",
    "- User asks why a specific endpoint/transaction is slow",
    "- User wants to understand where CPU time is spent",
    "- User asks about performance bottlenecks",
    "- User wants to compare performance between time periods",
    "- User shares a Sentry profile URL",
    "",
    "RETURNS:",
    "- Hot paths (call stacks consuming the most CPU time)",
    "- Performance percentiles (p75, p95, p99) for each function",
    "- User code vs library code breakdown",
    "- Actionable recommendations for optimization",
    "- Regression analysis when comparing periods",
    "",
    "<examples>",
    "### Analyze from URL (with transaction name)",
    "```",
    "get_profile(",
    "  profileUrl='https://my-org.sentry.io/explore/profiling/profile/backend/flamegraph/?profilerId=abc123',",
    "  transactionName='/api/users'",
    ")",
    "```",
    "",
    "### Analyze by transaction name",
    "```",
    "get_profile(",
    "  organizationSlug='my-org',",
    "  transactionName='/api/users',",
    "  projectSlugOrId='backend'",
    ")",
    "```",
    "",
    "### Compare performance between periods",
    "```",
    "get_profile(",
    "  organizationSlug='my-org',",
    "  transactionName='/api/users',",
    "  projectSlugOrId='backend',",
    "  statsPeriod='7d',",
    "  compareAgainstPeriod='14d'",
    ")",
    "```",
    "</examples>",
    "",
    "<hints>",
    "- Use `focusOnUserCode: true` (default) to filter out library code",
    "- High p99 relative to p75 indicates inconsistent performance",
    "- Use compareAgainstPeriod to detect regressions over time",
    "- Transaction names are case-sensitive",
    "</hints>",
  ].join("\n"),

  inputSchema: {
    // URL-based input (preferred)
    profileUrl: z
      .string()
      .url()
      .optional()
      .describe(
        "Sentry profile URL. If provided, organization and project are extracted from URL. transactionName is still required.",
      ),

    // Explicit params (fallback)
    organizationSlug: ParamOrganizationSlug.optional(),
    regionUrl: ParamRegionUrl.nullable().default(null),
    projectSlugOrId: z
      .union([z.string(), z.number()])
      .optional()
      .describe("Project slug or numeric ID"),
    transactionName: z
      .string()
      .trim()
      .optional()
      .describe("Transaction name (e.g., '/api/users', 'POST /graphql')"),

    // Time params
    statsPeriod: z
      .string()
      .default("7d")
      .describe("Time period: '1h', '24h', '7d', '14d', '30d' (default: '7d')"),

    // Comparison mode
    compareAgainstPeriod: z
      .string()
      .optional()
      .describe(
        "Compare against this baseline period (e.g., '14d', '30d'). Enables regression detection.",
      ),

    // Analysis options
    focusOnUserCode: z
      .boolean()
      .default(true)
      .describe(
        "Show only user code (is_application: true). Set to false to include library code.",
      ),
    maxHotPaths: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(10)
      .describe("Number of hot paths to display (1-20, default: 10)"),
  },

  annotations: { readOnlyHint: true, openWorldHint: false },

  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl ?? undefined,
    });

    // Resolve params from URL or explicit values
    const resolved = resolveProfileParams({
      profileUrl: params.profileUrl,
      organizationSlug: params.organizationSlug,
      projectSlugOrId: params.projectSlugOrId,
      transactionName: params.transactionName,
    });

    const { organizationSlug, projectSlugOrId, transactionName } = resolved;

    if (!projectSlugOrId) {
      throw new UserInputError(
        "Project is required. Please provide a projectSlugOrId parameter or include it in the profile URL.",
      );
    }

    if (!transactionName) {
      throw new UserInputError(
        "Transaction name is required for flamegraph analysis. Please provide a transactionName parameter.",
      );
    }

    // Resolve project slug to numeric ID if needed (flamegraph API requires numeric ID)
    let projectId: string | number;
    if (
      typeof projectSlugOrId === "number" ||
      isNumericId(String(projectSlugOrId))
    ) {
      projectId = projectSlugOrId;
      setTag("project.id", String(projectSlugOrId));
    } else {
      // It's a slug, resolve to ID
      const project = await apiService.getProject({
        organizationSlug,
        projectSlugOrId: String(projectSlugOrId),
      });
      projectId = project.id;
      setTag("project.slug", String(projectSlugOrId));
      setTag("project.id", String(project.id));
    }

    setTag("organization.slug", organizationSlug);
    setTag("transaction.name", transactionName);

    // Comparison mode: compare two time periods
    if (params.compareAgainstPeriod) {
      setTag("baseline.period", params.compareAgainstPeriod);
      setTag("current.period", params.statsPeriod);

      // Fetch both flamegraphs in parallel
      const [baselineFlamegraph, currentFlamegraph] = await Promise.all([
        apiService.getFlamegraph({
          organizationSlug,
          projectId,
          transactionName,
          statsPeriod: params.compareAgainstPeriod,
        }),
        apiService.getFlamegraph({
          organizationSlug,
          projectId,
          transactionName,
          statsPeriod: params.statsPeriod,
        }),
      ]);

      const hasBaselineData = hasProfileData(baselineFlamegraph);
      const hasCurrentData = hasProfileData(currentFlamegraph);

      // Handle missing data cases
      if (!hasBaselineData && !hasCurrentData) {
        return [
          `# Profile Comparison: ${transactionName}`,
          "",
          "## No Profile Data Found",
          "",
          `No profiling data found for transaction **${transactionName}** in either time period.`,
          "",
          "**Possible reasons:**",
          "- Transaction name doesn't match exactly (names are case-sensitive)",
          "- No profiles collected for this transaction",
          "- Profiling may not be enabled for this project",
          "",
          "**Suggestions:**",
          "- Verify the exact transaction name using search_events",
          "- Check if profiling is enabled for this project",
        ].join("\n");
      }

      if (!hasBaselineData) {
        return [
          `# Profile Comparison: ${transactionName}`,
          "",
          "## Insufficient Baseline Data",
          "",
          `No profiling data found for the baseline period (${params.compareAgainstPeriod}).`,
          `Current period (${params.statsPeriod}) has data.`,
          "",
          "**Suggestion:** Try a shorter baseline period or analyze the current period only by removing compareAgainstPeriod.",
        ].join("\n");
      }

      if (!hasCurrentData) {
        return [
          `# Profile Comparison: ${transactionName}`,
          "",
          "## Insufficient Current Data",
          "",
          `No profiling data found for the current period (${params.statsPeriod}).`,
          `Baseline period (${params.compareAgainstPeriod}) has data.`,
          "",
          "**Suggestion:** The transaction may not have been executed recently. Try a longer current period.",
        ].join("\n");
      }

      // Format and return the comparison
      return formatFlamegraphComparison(baselineFlamegraph, currentFlamegraph, {
        focusOnUserCode: params.focusOnUserCode,
      });
    }

    // Single period analysis mode
    const flamegraph = await apiService.getFlamegraph({
      organizationSlug,
      projectId,
      transactionName,
      statsPeriod: params.statsPeriod,
    });

    // Check if we got data
    if (!hasProfileData(flamegraph)) {
      return [
        `# Profile Analysis: ${transactionName}`,
        "",
        "## No Profile Data Found",
        "",
        `No profiling data found for transaction **${transactionName}** in the last ${params.statsPeriod}.`,
        "",
        "**Possible reasons:**",
        "- Transaction name doesn't match exactly (names are case-sensitive)",
        "- No profiles collected for this transaction in the time period",
        "- Profiling may not be enabled for this project",
        "- Transaction may not have been executed recently",
        "",
        "**Suggestions:**",
        "- Verify the exact transaction name using search_events",
        "- Try a longer time period (e.g., '30d')",
        "- Check if profiling is enabled for this project",
      ].join("\n");
    }

    // Format and return the analysis
    return formatFlamegraphAnalysis(flamegraph, {
      focusOnUserCode: params.focusOnUserCode,
      maxHotPaths: params.maxHotPaths,
    });
  },
});
