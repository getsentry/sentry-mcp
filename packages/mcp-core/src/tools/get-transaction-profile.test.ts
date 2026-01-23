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

    // Verify output structure
    expect(result).toContain("# Profile Analysis: /api/users");
    expect(result).toContain("**Transaction**: /api/users");
    expect(result).toContain("## Performance Summary");
    expect(result).toContain("### Top Slow Functions");
    expect(result).toContain("## Top Hot Paths");
    expect(result).toContain("## Actionable Next Steps");
  });

  it("includes user code functions in output", async () => {
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

    // User code functions from fixture
    expect(result).toContain("handle_request");
    expect(result).toContain("fetch_data");
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

    expect(result).toContain("No Profile Data Found");
    expect(result).toContain("/api/nonexistent");
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

    expect(result).toContain("# Profile Analysis: /api/users");
  });
});
