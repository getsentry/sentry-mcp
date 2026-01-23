import { setTag } from "@sentry/core";
import { z } from "zod";
import { defineTool } from "../internal/tool-helpers/define";
import { apiServiceFromContext } from "../internal/tool-helpers/api";
import { UserInputError } from "../errors";
import type { ServerContext } from "../types";
import { ParamOrganizationSlug, ParamRegionUrl } from "../schema";
import { formatFlamegraphComparison } from "./profile/formatter";
import { hasProfileData } from "./profile/analyzer";

export default defineTool({
  name: "compare_transaction_profiles",
  skills: ["inspect"],
  requiredScopes: ["event:read"],

  description: [
    "Compare transaction profiles between two time periods to detect performance regressions.",
    "",
    "USE THIS TOOL WHEN:",
    "- User asks if performance has regressed after a release",
    "- User wants to compare current vs baseline performance",
    "- User notices a transaction is slower and wants to find the cause",
    "- User asks about performance changes over time",
    "",
    "RETURNS:",
    "- Comparison summary with regression status",
    "- Key function-level changes with percentage differences",
    "- Major regressions highlighted with suggested actions",
    "- Both improved and degraded functions identified",
    "",
    "TRIGGER PATTERNS:",
    "- 'Has /api/users gotten slower?' -> use compare_transaction_profiles",
    "- 'Compare performance before and after release' -> use compare_transaction_profiles",
    "- 'Did we introduce a performance regression?' -> use compare_transaction_profiles",
    "- 'What changed between last week and this week?' -> use compare_transaction_profiles",
    "",
    "<examples>",
    "### Compare last 7 days vs previous 14 days",
    "```",
    "compare_transaction_profiles(",
    "  organizationSlug='my-org',",
    "  transactionName='/api/users',",
    "  projectId=1",
    ")",
    "```",
    "",
    "### Compare specific time periods",
    "```",
    "compare_transaction_profiles(",
    "  organizationSlug='my-org',",
    "  transactionName='POST /graphql',",
    "  projectId='my-app',",
    "  baselinePeriod='30d',",
    "  currentPeriod='7d'",
    ")",
    "```",
    "</examples>",
    "",
    "<hints>",
    "- Baseline period should be older/longer to establish normal performance",
    "- Current period should be recent to detect new regressions",
    "- Changes >20% are flagged as major regressions",
    "- Changes 10-20% are flagged as minor regressions",
    "- Use focusOnUserCode: true (default) to focus on your code, not libraries",
    "- For single transaction analysis, use get_transaction_profile instead",
    "</hints>",
  ].join("\n"),

  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    regionUrl: ParamRegionUrl.nullable().default(null),
    transactionName: z
      .string()
      .trim()
      .min(1)
      .describe("Transaction name (e.g., '/api/users', 'POST /graphql')"),
    projectId: z.union([z.string(), z.number()]).describe("Project ID or slug"),
    baselinePeriod: z
      .string()
      .default("14d")
      .describe(
        "Baseline time period (older): '7d', '14d', '30d' (default: '14d')",
      ),
    currentPeriod: z
      .string()
      .default("7d")
      .describe(
        "Current time period (recent): '1h', '24h', '7d' (default: '7d')",
      ),
    focusOnUserCode: z
      .boolean()
      .default(true)
      .describe(
        "Compare only user code (is_application: true). Set to false to include library code.",
      ),
  },

  annotations: { readOnlyHint: true, openWorldHint: false },

  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl ?? undefined,
    });

    const organizationSlug = params.organizationSlug;

    if (!organizationSlug) {
      throw new UserInputError(
        "Organization slug is required. Please provide an organizationSlug parameter.",
      );
    }

    setTag("organization.slug", organizationSlug);
    setTag("transaction.name", params.transactionName);
    setTag("project.id", String(params.projectId));
    setTag("baseline.period", params.baselinePeriod);
    setTag("current.period", params.currentPeriod);

    // Fetch both flamegraphs in parallel
    const [baselineFlamegraph, currentFlamegraph] = await Promise.all([
      apiService.getFlamegraph({
        organizationSlug,
        projectId: params.projectId,
        transactionName: params.transactionName,
        statsPeriod: params.baselinePeriod,
      }),
      apiService.getFlamegraph({
        organizationSlug,
        projectId: params.projectId,
        transactionName: params.transactionName,
        statsPeriod: params.currentPeriod,
      }),
    ]);

    const hasBaselineData = hasProfileData(baselineFlamegraph);
    const hasCurrentData = hasProfileData(currentFlamegraph);

    // Handle missing data cases
    if (!hasBaselineData && !hasCurrentData) {
      return [
        `# Profile Comparison: ${params.transactionName}`,
        "",
        "## No Profile Data Found",
        "",
        `No profiling data found for transaction **${params.transactionName}** in either time period.`,
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
        `# Profile Comparison: ${params.transactionName}`,
        "",
        "## Insufficient Baseline Data",
        "",
        `No profiling data found for the baseline period (${params.baselinePeriod}).`,
        `Current period (${params.currentPeriod}) has data.`,
        "",
        "**Suggestion:** Try a shorter baseline period or use get_transaction_profile to analyze the current period only.",
      ].join("\n");
    }

    if (!hasCurrentData) {
      return [
        `# Profile Comparison: ${params.transactionName}`,
        "",
        "## Insufficient Current Data",
        "",
        `No profiling data found for the current period (${params.currentPeriod}).`,
        `Baseline period (${params.baselinePeriod}) has data.`,
        "",
        "**Suggestion:** The transaction may not have been executed recently. Try a longer current period.",
      ].join("\n");
    }

    // Format and return the comparison
    return formatFlamegraphComparison(baselineFlamegraph, currentFlamegraph, {
      focusOnUserCode: params.focusOnUserCode,
    });
  },
});
