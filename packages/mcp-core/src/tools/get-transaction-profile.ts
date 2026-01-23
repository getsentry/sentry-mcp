import { setTag } from "@sentry/core";
import { z } from "zod";
import { defineTool } from "../internal/tool-helpers/define";
import { apiServiceFromContext } from "../internal/tool-helpers/api";
import { UserInputError } from "../errors";
import type { ServerContext } from "../types";
import { ParamOrganizationSlug, ParamRegionUrl } from "../schema";
import { formatFlamegraphAnalysis } from "./profile/formatter";
import { hasProfileData } from "./profile/analyzer";

export default defineTool({
  name: "get_transaction_profile",
  skills: ["inspect"],
  requiredScopes: ["event:read"],

  description: [
    "Analyze CPU profiling data for a specific transaction to identify performance bottlenecks.",
    "",
    "USE THIS TOOL WHEN:",
    "- User asks why a specific endpoint/transaction is slow",
    "- User wants to understand where CPU time is spent in a transaction",
    "- User needs to identify optimization opportunities",
    "- User asks about performance bottlenecks in a specific API endpoint",
    "",
    "RETURNS:",
    "- Hot paths (call stacks consuming the most CPU time)",
    "- Performance percentiles (p75, p95, p99) for each function",
    "- User code vs library code breakdown",
    "- Actionable recommendations for optimization",
    "",
    "TRIGGER PATTERNS:",
    "- 'Why is /api/users slow?' → use get_transaction_profile",
    "- 'Show me the profile for POST /graphql' → use get_transaction_profile",
    "- 'What's the bottleneck in /api/orders' → use get_transaction_profile",
    "- 'Analyze performance of /checkout' → use get_transaction_profile",
    "",
    "<examples>",
    "### Analyze a transaction",
    "```",
    "get_transaction_profile(",
    "  organizationSlug='my-org',",
    "  transactionName='/api/users',",
    "  projectId=1",
    ")",
    "```",
    "",
    "### Analyze with custom time period",
    "```",
    "get_transaction_profile(",
    "  organizationSlug='my-org',",
    "  transactionName='POST /graphql',",
    "  projectId='my-app',",
    "  statsPeriod='24h'",
    ")",
    "```",
    "</examples>",
    "",
    "<hints>",
    "- Use `focusOnUserCode: true` (default) to filter out library code noise",
    "- High p99 relative to p75 indicates inconsistent performance",
    "- The output includes profile IDs for deep-dive analysis with get_profile_details",
    "- For regression detection, use compare_transaction_profiles instead",
    "- Transaction names are case-sensitive and must match exactly",
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
    statsPeriod: z
      .string()
      .default("7d")
      .describe("Time period: '1h', '24h', '7d', '14d', '30d' (default: '7d')"),
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

    const organizationSlug = params.organizationSlug;

    if (!organizationSlug) {
      throw new UserInputError(
        "Organization slug is required. Please provide an organizationSlug parameter.",
      );
    }

    setTag("organization.slug", organizationSlug);
    setTag("transaction.name", params.transactionName);
    setTag("project.id", String(params.projectId));

    // Fetch flamegraph data
    const flamegraph = await apiService.getFlamegraph({
      organizationSlug,
      projectId: params.projectId,
      transactionName: params.transactionName,
      statsPeriod: params.statsPeriod,
    });

    // Check if we got data
    if (!hasProfileData(flamegraph)) {
      return [
        `# Profile Analysis: ${params.transactionName}`,
        "",
        "## No Profile Data Found",
        "",
        `No profiling data found for transaction **${params.transactionName}** in the last ${params.statsPeriod}.`,
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
