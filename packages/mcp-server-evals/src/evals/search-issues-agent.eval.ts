import { describeEval } from "vitest-evals";
import { ToolCallScorer } from "vitest-evals";
import { searchIssuesAgent } from "@sentry/mcp-server/tools/search-issues";
import { createMockApiService } from "@sentry/mcp-server-mocks";
import { SentryApiService } from "@sentry/mcp-server/api-client";
import "../setup-env";

// Set up MSW mock server
const mockApi = createMockApiService();

// Start the mock server before tests
mockApi.start();

describeEval("search-issues-agent", {
  data: async () => {
    return [
      {
        input: "Show me unresolved issues",
        expectedTools: [
          {
            name: "issueFields",
            arguments: {
              organizationSlug: "sentry-mcp-evals",
            },
          },
        ],
      },
      {
        input: "Show me issues assigned to me",
        expectedTools: [
          {
            name: "whoami",
            arguments: {},
          },
          {
            name: "issueFields",
            arguments: {
              organizationSlug: "sentry-mcp-evals",
            },
          },
        ],
      },
      {
        input: "Show me critical unhandled errors from the last 24 hours",
        expectedTools: [
          {
            name: "issueFields",
            arguments: {
              organizationSlug: "sentry-mcp-evals",
            },
          },
        ],
      },
    ];
  },
  task: async (input) => {
    // Create a real API service that will use MSW mocks
    const apiService = new SentryApiService({
      accessToken: "test-token",
    });

    const agentResult = await searchIssuesAgent(
      input,
      "sentry-mcp-evals",
      apiService,
    );

    // Return in the format expected by ToolCallScorer
    return {
      result: JSON.stringify(agentResult.result),
      toolCalls: agentResult.toolCalls.map((call: any) => ({
        name: call.toolName,
        arguments: call.args,
      })),
    };
  },
  scorers: [ToolCallScorer()],
});
