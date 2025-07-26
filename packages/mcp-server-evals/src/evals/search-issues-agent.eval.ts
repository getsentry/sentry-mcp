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
        // Simple query with common fields - should NOT require tool calls
        input: "Show me unresolved issues",
        expectedTools: [],
      },
      {
        // Query with "me" reference - should only require whoami
        input: "Show me issues assigned to me",
        expectedTools: [
          {
            name: "whoami",
            arguments: {},
          },
        ],
      },
      {
        // Complex query but with common fields - should NOT require tool calls
        input: "Show me critical unhandled errors from the last 24 hours",
        expectedTools: [],
      },
      {
        // Query with custom/uncommon field that would require discovery
        input: "Show me issues with custom.payment.failed tag",
        expectedTools: [
          {
            name: "issueFields",
            arguments: {
              includeExamples: false, // Agent typically uses false for performance
            },
          },
        ],
      },
      {
        // Another query requiring field discovery
        input: "Find issues where the kafka.consumer.group is orders-processor",
        expectedTools: [
          {
            name: "issueFields",
            arguments: {
              includeExamples: true, // Agent uses true when looking for specific fields
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
  scorers: [ToolCallScorer()], // Default: strict parameter checking
});
