import { describeEval } from "vitest-evals";
import { ToolCallScorer } from "vitest-evals";
import { searchEventsAgent } from "@sentry/mcp-server/tools/search-events";
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
        // Simple query with common fields - should NOT require tool calls
        input: "Show me all errors from today",
        expectedTools: [],
      },
      {
        // Query with "me" reference - should only require whoami
        input: "Show me my errors from last week",
        expectedTools: [
          {
            name: "whoami",
            arguments: {},
          },
        ],
      },
      {
        // Common performance query - should NOT require tool calls
        input: "Show me slow API calls taking more than 1 second",
        expectedTools: [],
      },
      {
        // Query with OpenTelemetry attributes that need discovery
        input:
          "Show me LLM calls where gen_ai.usage.prompt_tokens is over 1000",
        expectedTools: [
          {
            name: "datasetAttributes",
            arguments: {
              dataset: "spans",
            },
          },
          {
            name: "otelSemantics",
            arguments: {
              namespace: "gen_ai",
              searchTerm: "prompt_tokens",
              dataset: "spans",
            },
          },
        ],
      },
      {
        // Query with custom field requiring discovery
        input: "Find errors with custom.payment.processor field",
        expectedTools: [
          {
            name: "datasetAttributes",
            arguments: {
              dataset: "errors",
            },
          },
        ],
      },
      {
        // Complex query needing both user resolution and field discovery
        input:
          "Show me my database queries with custom.db.pool_size greater than 10",
        expectedTools: [
          {
            name: "whoami",
            arguments: {},
          },
          {
            name: "datasetAttributes",
            arguments: {
              dataset: "spans",
            },
          },
        ],
      },
      {
        // Query requiring equation field calculation
        input: "How many total tokens did we consume yesterday",
        expectedTools: [
          {
            name: "datasetAttributes",
            arguments: {
              dataset: "spans",
            },
          },
          // Agent may find gen_ai.usage.total_tokens in datasetAttributes and not need otelSemantics
        ],
      },
    ];
  },
  task: async (input) => {
    // Create a real API service that will use MSW mocks
    const apiService = new SentryApiService({
      accessToken: "test-token",
    });

    const agentResult = await searchEventsAgent(
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
