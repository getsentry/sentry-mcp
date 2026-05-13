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

  it("handles the existing-analysis happy path", async () => {
    const result = await analyzeIssueWithSeer.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        instruction: undefined,
        issueId: "CLOUDFLARE-MCP-45",
        issueUrl: undefined,
      },
      {
        constraints: { organizationSlug: undefined },
        accessToken: "access-token",
        userId: "1",
      },
    );

    expect(result).toContain("# Seer Analysis for Issue CLOUDFLARE-MCP-45");
    expect(result).toContain("Found existing analysis (Run ID: 13)");
    expect(result).toContain("## Analysis Complete");
    expect(result).toContain('<seer_analysis run_id="13" step="root_cause">');
    expect(result).toContain("The analysis has completed successfully.");
  });

  it("wraps completed sections with provenance tags", async () => {
    mswServer.use(
      http.get(
        "*/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-TAGS/autofix/",
        () =>
          HttpResponse.json({
            autofix: {
              run_id: 4242,
              status: "completed",
              updated_at: "2025-04-09T22:39:50.778146Z",
              blocks: [
                {
                  id: "block-1",
                  timestamp: "2025-04-09T22:35:00Z",
                  message: {
                    role: "assistant",
                    content: "Investigating.",
                    metadata: { step: "root_cause" },
                  },
                  artifacts: [
                    {
                      key: "root_cause",
                      reason: "Found it.",
                      data: {
                        one_line_description:
                          "The request used the wrong bottle ID.",
                        five_whys: ["Lookup path failed."],
                        reproduction_steps: [],
                      },
                    },
                  ],
                },
                {
                  id: "block-2",
                  timestamp: "2025-04-09T22:38:00Z",
                  message: {
                    role: "assistant",
                    content: "Plan ready.",
                    metadata: { step: "solution" },
                  },
                  artifacts: [
                    {
                      key: "solution",
                      reason: "Drafted.",
                      data: {
                        one_line_summary:
                          "Use the canonical bottle ID for both batched calls.",
                        steps: [
                          {
                            title: "Share canonical ID",
                            description: "Pass the same ID to both procedures.",
                          },
                          {
                            title: "Add regression coverage",
                            description: "Cover the batch case with a test.",
                          },
                        ],
                      },
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
        constraints: { organizationSlug: undefined },
        accessToken: "access-token",
        userId: "1",
      },
    );

    expect(typeof result).toBe("string");
    expect(result).toContain("# Seer Analysis for Issue CLOUDFLARE-MCP-TAGS");
    expect(result).toContain("Found existing analysis (Run ID: 4242)");
    expect(result).toContain("## Analysis Complete");
    expect(result).toContain('<seer_analysis run_id="4242" step="root_cause">');
    expect(result).toContain("The request used the wrong bottle ID.");
    expect(result).toContain('<seer_analysis run_id="4242" step="solution">');
    expect(result).toContain(
      "Use the canonical bottle ID for both batched calls.",
    );
    expect(result).toContain("**Share canonical ID**");
    expect(result).not.toContain("null");
  });

  it("retries the GET on network errors", async () => {
    let attempts = 0;
    mswServer.use(
      http.get(
        "*/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-99/autofix/",
        () => {
          attempts++;
          if (attempts < 3) {
            return HttpResponse.error();
          }
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
        constraints: { organizationSlug: undefined },
        accessToken: "access-token",
        userId: "1",
      },
    );

    await vi.runAllTimersAsync();

    const result = await promise;

    expect(attempts).toBeGreaterThanOrEqual(3);
    expect(result).toContain("# Seer Analysis for Issue CLOUDFLARE-MCP-99");
    expect(result).toContain("Found existing analysis");
  });

  it("retries the GET on 500 errors", async () => {
    let attempts = 0;
    mswServer.use(
      http.get(
        "*/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-500/autofix/",
        () => {
          attempts++;
          if (attempts < 2) {
            return HttpResponse.json(
              { detail: "Internal Server Error" },
              { status: 500 },
            );
          }
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
        constraints: { organizationSlug: undefined },
        accessToken: "access-token",
        userId: "1",
      },
    );

    await vi.runAllTimersAsync();

    const result = await promise;

    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(result).toContain("# Seer Analysis for Issue CLOUDFLARE-MCP-500");
  });

  it("times out when the run stays in processing", async () => {
    mswServer.use(
      http.get(
        "*/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-TIMEOUT/autofix/",
        () =>
          HttpResponse.json({
            autofix: {
              run_id: 999,
              status: "processing",
              updated_at: "2026-04-22T11:55:00Z",
              blocks: [
                {
                  id: "in-flight",
                  timestamp: "2026-04-22T11:55:00Z",
                  message: {
                    role: "assistant",
                    content: "Still working.",
                    metadata: { step: "root_cause" },
                  },
                },
              ],
            },
          }),
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
        constraints: { organizationSlug: undefined },
        accessToken: "access-token",
        userId: "1",
      },
    );

    await vi.advanceTimersByTimeAsync(6 * 60 * 1000);

    const result = await promise;

    expect(result).toContain("## Analysis Timed Out");
    expect(result).toContain(
      "The analysis is taking longer than expected (>300s)",
    );
  });

  it("kicks off root_cause when no run exists yet", async () => {
    let getCallCount = 0;
    const postBodies: unknown[] = [];

    mswServer.use(
      http.get(
        "*/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-NEW/autofix/",
        () => {
          getCallCount++;
          if (getCallCount === 1) {
            return HttpResponse.json({ autofix: null });
          }
          return HttpResponse.json(autofixStateFixture);
        },
      ),
      http.post(
        "*/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-NEW/autofix/",
        async ({ request }) => {
          const body = await request.json();
          postBodies.push(body);
          return HttpResponse.json({ run_id: 123 });
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
        constraints: { organizationSlug: undefined },
        accessToken: "access-token",
        userId: "1",
      },
    );

    await vi.runAllTimersAsync();

    const result = await promise;

    expect(result).toContain("Starting new analysis...");
    expect(result).toContain("Analysis started with Run ID: 123");
    expect(result).toContain("## Analysis Complete");
    expect(postBodies[0]).toMatchObject({
      step: "root_cause",
      user_context: "Focus on memory leaks",
    });
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
