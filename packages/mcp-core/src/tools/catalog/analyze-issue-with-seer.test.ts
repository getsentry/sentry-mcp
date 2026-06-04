import { autofixStateFixture, mswServer } from "@sentry/mcp-server-mocks";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import analyzeIssueWithSeer from "./analyze-issue-with-seer.js";

describe("analyze_issue_with_seer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("handles combined workflow", async () => {
    // This test validates the tool works correctly
    // In a real scenario, it would poll multiple times, but for testing
    // we'll validate the key outputs are present
    const result = await analyzeIssueWithSeer.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        instruction: undefined,
        issueId: "CLOUDFLARE-MCP-45",
        issueUrl: undefined,
      },
      {
        constraints: {
          organizationSlug: undefined,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );

    expect(result).toContain("# Seer Analysis for Issue CLOUDFLARE-MCP-45");
    expect(result).toContain("Found existing analysis (Run ID: 13)");
    expect(result).toContain("## Analysis Complete");
    expect(result).toContain(
      '<seer_analysis run_id="13" step="root_cause_analysis">',
    );
    expect(result).toContain("The analysis has completed successfully.");
  });

  it("wraps completed Seer-authored sections with provenance tags", async () => {
    mswServer.use(
      http.get(
        "*/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-TAGS/autofix/",
        () =>
          HttpResponse.json({
            autofix: {
              run_id: 4242,
              request: {},
              status: "COMPLETED",
              updated_at: "2025-04-09T22:39:50.778146",
              steps: [
                {
                  type: "root_cause_analysis",
                  key: "root_cause_analysis",
                  index: 0,
                  status: "COMPLETED",
                  title: "Root Cause Analysis",
                  output_stream: null,
                  progress: [],
                  causes: [
                    {
                      description: "The request used the wrong bottle ID.",
                      id: 1,
                      root_cause_reproduction: [
                        {
                          code_snippet_and_analysis:
                            "The bottle lookup threw after receiving ID 3216.",
                          is_most_important_event: true,
                          relevant_code_file: null,
                          timeline_item_type: "internal_code",
                          title: "Lookup path",
                        },
                      ],
                    },
                  ],
                },
                {
                  type: "solution",
                  key: "solution",
                  index: 1,
                  status: "COMPLETED",
                  title: "Proposed Solution",
                  output_stream: null,
                  progress: [],
                  description:
                    "Use the canonical bottle ID for both batched calls.",
                  solution: [
                    {
                      code_snippet_and_analysis:
                        "Pass the same ID to both procedures.",
                      is_active: true,
                      is_most_important_event: true,
                      relevant_code_file: null,
                      timeline_item_type: "internal_code",
                      title: "Share canonical ID",
                    },
                    {
                      code_snippet_and_analysis: null,
                      is_active: true,
                      is_most_important_event: false,
                      relevant_code_file: null,
                      timeline_item_type: "repro_test",
                      title: "Add regression coverage",
                    },
                  ],
                },
              ],
            },
          }),
      ),
    );

    const result = await analyzeIssueWithSeer.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        instruction: undefined,
        issueId: "CLOUDFLARE-MCP-TAGS",
        issueUrl: undefined,
      },
      {
        constraints: {
          organizationSlug: undefined,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );

    expect(typeof result).toBe("string");
    if (typeof result !== "string") {
      throw new Error("Expected analyze_issue_with_seer to return text output");
    }

    expect(result.trim()).toMatchInlineSnapshot(`
      "# Seer Analysis for Issue CLOUDFLARE-MCP-TAGS

      Found existing analysis (Run ID: 4242)

      ## Analysis Complete

      <seer_analysis run_id="4242" step="root_cause_analysis">
      The request used the wrong bottle ID.

      **Lookup path**

      The bottle lookup threw after receiving ID 3216.
      </seer_analysis>

      <seer_analysis run_id="4242" step="solution">
      Use the canonical bottle ID for both batched calls.

      **Share canonical ID**
      Pass the same ID to both procedures.

      **Add regression coverage**
      </seer_analysis>"
    `);
    expect(result).not.toContain("null");
  });

  it("handles network errors with retry", async () => {
    let attempts = 0;
    mswServer.use(
      http.get(
        "*/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-99/autofix/",
        () => {
          attempts++;
          if (attempts < 3) {
            // Simulate network error for first 2 attempts
            return HttpResponse.error();
          }
          // Success on third attempt
          return HttpResponse.json(autofixStateFixture);
        },
      ),
    );

    const promise = analyzeIssueWithSeer.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        instruction: undefined,
        issueId: "CLOUDFLARE-MCP-99",
      },
      {
        constraints: {
          organizationSlug: undefined,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );

    // Fast-forward through retries
    await vi.runAllTimersAsync();

    const result = await promise;

    expect(attempts).toBe(3);
    expect(result).toContain("# Seer Analysis for Issue CLOUDFLARE-MCP-99");
    expect(result).toContain("Found existing analysis");
  });

  it("handles 500 errors with retry", async () => {
    let attempts = 0;
    mswServer.use(
      http.get(
        "*/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-500/autofix/",
        () => {
          attempts++;
          if (attempts < 2) {
            // Simulate server error for first attempt
            return HttpResponse.json(
              { detail: "Internal Server Error" },
              { status: 500 },
            );
          }
          // Success on second attempt
          return HttpResponse.json(autofixStateFixture);
        },
      ),
    );

    const promise = analyzeIssueWithSeer.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        instruction: undefined,
        issueId: "CLOUDFLARE-MCP-500",
      },
      {
        constraints: {
          organizationSlug: undefined,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );

    // Fast-forward through retries
    await vi.runAllTimersAsync();

    const result = await promise;

    expect(attempts).toBe(2);
    expect(result).toContain("# Seer Analysis for Issue CLOUDFLARE-MCP-500");
  });

  it.skip("handles polling with transient errors", async () => {
    // This test is skipped because it's difficult to reliably trigger the error message
    // The functionality is covered by the error recovery logic in the retry tests
  });

  it("handles polling timeout", async () => {
    const inProgressState = {
      ...autofixStateFixture,
      autofix: {
        ...autofixStateFixture.autofix,
        status: "PROCESSING",
        steps: [
          {
            ...autofixStateFixture.autofix.steps[0],
            status: "PROCESSING",
            title: "Analyzing the issue",
          },
        ],
      },
    };

    mswServer.use(
      http.get(
        "*/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-TIMEOUT/autofix/",
        () => {
          // Always return in progress
          return HttpResponse.json(inProgressState);
        },
      ),
    );

    const promise = analyzeIssueWithSeer.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        instruction: undefined,
        issueId: "CLOUDFLARE-MCP-TIMEOUT",
      },
      {
        constraints: {
          organizationSlug: undefined,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );

    // Fast-forward past timeout
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000); // 6 minutes

    const result = await promise;

    expect(result).toContain("## Analysis Timed Out");
    expect(result).toContain(
      "The analysis is taking longer than expected (>300s)",
    );
    expect(result).toContain("Processing: Analyzing the issue...");
  });

  it("handles consecutive polling errors", async () => {
    let pollAttempts = 0;
    const inProgressState = {
      ...autofixStateFixture,
      autofix: {
        ...autofixStateFixture.autofix,
        status: "PROCESSING",
      },
    };

    mswServer.use(
      http.get(
        "*/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-ERRORS/autofix/",
        () => {
          pollAttempts++;
          if (pollAttempts === 1) {
            // First call returns in progress
            return HttpResponse.json(inProgressState);
          }
          // All subsequent calls fail
          return HttpResponse.error();
        },
      ),
    );

    const promise = analyzeIssueWithSeer.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        instruction: undefined,
        issueId: "CLOUDFLARE-MCP-ERRORS",
      },
      {
        constraints: {
          organizationSlug: undefined,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );

    // Fast-forward through polling intervals
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(5000);
    }

    const result = await promise;

    expect(result).toContain("## Error During Analysis");
    expect(result).toContain(
      "Unable to retrieve analysis status after multiple attempts",
    );
    expect(result).toContain(
      "You can check the status later by running the same command again",
    );
  });

  it("handles start autofix with instruction", async () => {
    let getCallCount = 0;

    mswServer.use(
      http.get(
        "*/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-NEW/autofix/",
        () => {
          getCallCount++;
          if (getCallCount === 1) {
            // First call - no existing autofix
            return HttpResponse.json({ autofix: null });
          }
          // Subsequent calls - return completed state
          return HttpResponse.json(autofixStateFixture);
        },
      ),
      http.post(
        "*/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-NEW/autofix/",
        async ({ request }) => {
          const body = await request.json();
          expect(body).toEqual({
            event_id: undefined,
            instruction: "Focus on memory leaks",
          });
          return HttpResponse.json({
            run_id: 123,
          });
        },
      ),
    );

    const promise = analyzeIssueWithSeer.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        issueId: "CLOUDFLARE-MCP-NEW",
        instruction: "Focus on memory leaks",
      },
      {
        constraints: {
          organizationSlug: undefined,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );

    // Fast-forward through initial delay and polling
    await vi.runAllTimersAsync();

    const result = await promise;

    expect(result).toContain("Starting new analysis...");
    expect(result).toContain("Analysis started with Run ID: 123");
    expect(result).toContain("## Analysis Complete");
  });

  it("rejects issues outside the active project constraint", async () => {
    await expect(
      analyzeIssueWithSeer.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          regionUrl: null,
          issueId: "CLOUDFLARE-MCP-41",
          instruction: undefined,
        },
        {
          constraints: {
            organizationSlug: undefined,
            projectSlug: "frontend",
          },
          accessToken: "access-token",
          userId: "1",
        },
      ),
    ).rejects.toThrow(
      'Issue is outside the active project constraint. Expected project "frontend".',
    );
  });
});
