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

    // Verify output structure
    expect(result).toContain("# Profile Comparison: /api/users");
    expect(result).toContain("## Summary");
    expect(result).toContain("**Status**:");
    expect(result).toContain("## Key Changes");
  });

  it("includes function names in comparison", async () => {
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

    // User code functions from fixture
    expect(result).toContain("handle_request");
    expect(result).toContain("fetch_data");
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

    expect(result).toContain("No Profile Data Found");
    expect(result).toContain("/api/nonexistent");
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

    expect(result).toContain("# Profile Comparison: /api/users");
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

    // When baseline and current are the same, should show no significant changes
    expect(result).toContain("No Significant Changes");
  });
});
