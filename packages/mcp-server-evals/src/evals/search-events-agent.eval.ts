import { describeEval } from "vitest-evals";
import { ToolCallScorer } from "vitest-evals";
import { testableSearchEventsAgent } from "@sentry/mcp-server/tools/search-events/testable-agent";
import { createMockApiService } from "@sentry/mcp-server-mocks";
import { SentryApiService } from "@sentry/mcp-server/api-client";
import "../setup-env";

// Set up MSW mock server
const mockApi = createMockApiService();

// Start the mock server before tests
mockApi.start();

describeEval("search-events-agent", {
  data: async () => {
    return [
      {
        input: "Show me all errors from today",
        expectedTools: [
          {
            name: "datasetAttributes",
            arguments: {
              organizationSlug: "sentry-mcp-evals",
              dataset: "errors",
            },
          },
        ],
      },
      {
        input: "Show me my errors from last week",
        expectedTools: [
          {
            name: "whoami",
            arguments: {},
          },
          {
            name: "datasetAttributes",
            arguments: {
              organizationSlug: "sentry-mcp-evals",
              dataset: "errors",
            },
          },
        ],
      },
      {
        input: "Show me slow API calls taking more than 1 second",
        expectedTools: [
          {
            name: "datasetAttributes",
            arguments: {
              organizationSlug: "sentry-mcp-evals",
              dataset: "spans",
            },
          },
        ],
      },
    ];
  },
  task: async (input) => {
    // Create a real API service that will use MSW mocks
    const apiService = new SentryApiService({
      baseUrl: "https://us.sentry.io",
      accessToken: "test-token",
    });

    const result = await testableSearchEventsAgent(
      input,
      "sentry-mcp-evals",
      apiService,
    );

    // Return in the format expected by ToolCallScorer
    return {
      result: JSON.stringify(result.result),
      toolCalls: result.toolCalls.map((call) => ({
        name: call.toolName,
        arguments: call.args,
      })),
    };
  },
  scorers: [ToolCallScorer()],
});
