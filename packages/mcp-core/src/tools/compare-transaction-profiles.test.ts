import { describe, it, expect } from "vitest";
import compareTransactionProfiles from "./compare-transaction-profiles";

describe("compare_transaction_profiles", () => {
  it("compares transaction profiles between periods", async () => {
    const result = await compareTransactionProfiles.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectId: "cloudflare-mcp",
        transactionName: "/api/users",
        baselinePeriod: "14d",
        currentPeriod: "7d",
        focusOnUserCode: true,
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
      "# Profile Comparison: /api/users

      ## Summary
      - **Status**: ✅ No Significant Changes

      ## Key Changes

      | Function | File:Line | Baseline | Current | Change | Status |
      |----------|-----------|----------|---------|--------|--------|
      | \`handle_request\` | main.py:10 | 160ms | 160ms | 0.00% | ➖ |
      | \`fetch_data\` | utils.py:25 | 160ms | 160ms | 0.00% | ➖ |
      "
    `);
  });

  it("returns no data message when both periods have no data", async () => {
    const result = await compareTransactionProfiles.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectId: "cloudflare-mcp",
        transactionName: "/api/nonexistent",
        baselinePeriod: "14d",
        currentPeriod: "7d",
        focusOnUserCode: true,
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
      "# Profile Comparison: /api/nonexistent

      ## No Profile Data Found

      No profiling data found for transaction **/api/nonexistent** in either time period.

      **Possible reasons:**
      - Transaction name doesn't match exactly (names are case-sensitive)
      - No profiles collected for this transaction
      - Profiling may not be enabled for this project

      **Suggestions:**
      - Verify the exact transaction name using search_events
      - Check if profiling is enabled for this project"
    `);
  });

  it("works with numeric project ID", async () => {
    const result = await compareTransactionProfiles.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectId: 4509062593708032,
        transactionName: "/api/users",
        baselinePeriod: "14d",
        currentPeriod: "7d",
        focusOnUserCode: true,
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

    // Verify it works with numeric project ID
    expect(result).toContain("# Profile Comparison: /api/users");
    expect(result).toContain("## Summary");
  });

  it("shows no significant changes when comparing identical periods", async () => {
    const result = await compareTransactionProfiles.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectId: "cloudflare-mcp",
        transactionName: "/api/users",
        baselinePeriod: "7d",
        currentPeriod: "7d",
        focusOnUserCode: false,
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
      "# Profile Comparison: /api/users

      ## Summary
      - **Status**: ✅ No Significant Changes

      ## Key Changes

      | Function | File:Line | Baseline | Current | Change | Status |
      |----------|-----------|----------|---------|--------|--------|
      | \`handle_request\` | main.py:10 | 160ms | 160ms | 0.00% | ➖ |
      | \`fetch_data\` | utils.py:25 | 160ms | 160ms | 0.00% | ➖ |
      | \`execute\` | psycopg2/pool.py:100 | 100ms | 100ms | 0.00% | ➖ |
      "
    `);
  });
});
