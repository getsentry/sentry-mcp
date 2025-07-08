import { describe, it, expect } from "vitest";
import analyzeIssueWithSeer from "./analyze-issue-with-seer.js";

describe("analyze_issue_with_seer", () => {
  it("handles combined workflow", async () => {
    // This test validates the tool works correctly
    // In a real scenario, it would poll multiple times, but for testing
    // we'll validate the key outputs are present
    const result = await analyzeIssueWithSeer.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-45",
        issueUrl: undefined,
        regionUrl: undefined,
        instruction: undefined,
      },
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
    );

    expect(result).toContain("# Seer AI Analysis for Issue CLOUDFLARE-MCP-45");
    expect(result).toContain("Found existing analysis (Run ID: 13)");
    expect(result).toContain("## Analysis Complete");
    expect(result).toContain("## 1. **Root Cause Analysis**");
    expect(result).toContain("The analysis has completed successfully.");
  });
});
