import { describe, it, expect } from "vitest";
import getTransactionProfile from "./get-transaction-profile";

describe("get_transaction_profile", () => {
  it("analyzes a transaction profile", async () => {
    const result = await getTransactionProfile.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectId: "cloudflare-mcp",
        transactionName: "/api/users",
        statsPeriod: "7d",
        focusOnUserCode: true,
        maxHotPaths: 5,
        regionUrl: null,
      },
      {
        constraints: {
          organizationSlug: null,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );

    expect(result).toMatchInlineSnapshot(`
      "# Profile Analysis: /api/users

      ## Transaction Information
      - **Transaction**: /api/users
      - **Project ID**: 4509062593708032
      - **Platform**: python
      - **Total Profiles**: 1
      - **Total Samples**: 80
      - **Estimated Total Time**: 160ms

      ## Performance Summary

      ### Code Breakdown
      - **Total User Code Time**: 320ms (76.2%)
      - **Total Library Time**: 100ms (23.8%)

      ### Top Slow Functions

      | Function | File:Line | Samples | % Time | p75 | p95 | p99 | Insights |
      |----------|-----------|---------|--------|-----|-----|-----|----------|
      | \`handle_request\` | main.py:10 | 80 | 38.1% | 50ms | 80ms | 120ms |  |
      | \`fetch_data\` | utils.py:25 | 80 | 38.1% | 40ms | 70ms | 100ms |  |

      ## Top Hot Paths

      ### Path #1: 62.5% of execution time

      **50 samples** across 1 profiles

      \`\`\`
      main.py:handle_request:10 [YOUR CODE]
        utils.py:fetch_data:25 [YOUR CODE] ← PRIMARY BOTTLENECK
      \`\`\`

      **Performance Characteristics:**
      - **p75**: 50ms
      - **p95**: 90ms
      - **p99**: 200ms (⚠️ High variance - some calls are very slow)

      **💡 Recommendation:**
      This path accounts for 62.5% of CPU time. The high p99 indicates some operations are very slow.

      ---

      ### Path #2: 37.5% of execution time

      **30 samples** across 1 profiles

      \`\`\`
      main.py:handle_request:10 [YOUR CODE]
        utils.py:fetch_data:25 [YOUR CODE] ← PRIMARY BOTTLENECK
      \`\`\`

      **Performance Characteristics:**
      - **p75**: 40ms
      - **p95**: 70ms
      - **p99**: 100ms

      **💡 Recommendation:**
      This path accounts for 37.5% of CPU time.


      ## Actionable Next Steps

      ### Immediate Actions (High Impact)
      1. **Optimize \`execute\` function** - Accounts for 62.5% of CPU time
      2. **Add caching layer** - Consider caching frequently accessed data
      3. **Review query patterns** - Look for N+1 queries or inefficient data access

      ### Investigation Actions
      1. **Get detailed profile**: Use profiler_id \`profile-abc123\` for sample-level analysis
      2. **Compare with baseline**: Use compare_transaction_profiles to check for regressions"
    `);
  });

  it("returns no data message for unknown transaction", async () => {
    const result = await getTransactionProfile.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectId: "cloudflare-mcp",
        transactionName: "/api/nonexistent",
        statsPeriod: "7d",
        focusOnUserCode: true,
        maxHotPaths: 5,
        regionUrl: null,
      },
      {
        constraints: {
          organizationSlug: null,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );

    expect(result).toMatchInlineSnapshot(`
      "# Profile Analysis: /api/nonexistent

      ## No Profile Data Found

      No profiling data found for transaction **/api/nonexistent** in the last 7d.

      **Possible reasons:**
      - Transaction name doesn't match exactly (names are case-sensitive)
      - No profiles collected for this transaction in the time period
      - Profiling may not be enabled for this project
      - Transaction may not have been executed recently

      **Suggestions:**
      - Verify the exact transaction name using search_events
      - Try a longer time period (e.g., '30d')
      - Check if profiling is enabled for this project"
    `);
  });

  it("works with numeric project ID", async () => {
    const result = await getTransactionProfile.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectId: 4509062593708032,
        transactionName: "/api/users",
        statsPeriod: "7d",
        focusOnUserCode: true,
        maxHotPaths: 5,
        regionUrl: null,
      },
      {
        constraints: {
          organizationSlug: null,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );

    // Verify it still works with numeric ID
    expect(result).toContain("# Profile Analysis: /api/users");
    expect(result).toContain("## Transaction Information");
  });
});
