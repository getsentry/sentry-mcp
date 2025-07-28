import { describeEval } from "vitest-evals";
import { ToolCallScorer } from "vitest-evals";
import { searchIssuesAgent } from "@sentry/mcp-server/tools/search-issues/agent";
import { SentryApiService } from "@sentry/mcp-server/api-client";
import { StructuredOutputScorer } from "./utils/structuredOutputScorer";
import "../setup-env";

// The shared MSW server is already started in setup-env.ts

describeEval("search-issues-agent", {
  data: async () => {
    return [
      {
        // Simple query with common fields - should NOT require tool calls
        input: "Show me unresolved issues",
        expectedTools: [],
        expected: {
          query: "is:unresolved",
          sort: "date", // Agent uses "date" as default
        },
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
        expected: {
          query:
            /assignedOrSuggested:test@example\.com|assigned:test@example\.com|assigned:me/, // Various valid forms
          sort: "date",
        },
      },
      {
        // Complex query but with common fields - should NOT require tool calls
        input: "Show me critical unhandled errors from the last 24 hours",
        expectedTools: [],
        expected: {
          query: /level:error.*is:unresolved.*firstSeen:-24h/, // Agent uses firstSeen for "from the last 24 hours"
          sort: "date",
        },
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
        expected: {
          query: /custom\.payment\.failed|tags\[custom\.payment\.failed\]/, // Both syntaxes are valid for tags
          sort: "date", // Agent should always return a sort value
        },
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
        expected: {
          query: "kafka.consumer.group:orders-processor",
          sort: "date", // Agent should always return a sort value
        },
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
  scorers: [
    ToolCallScorer(), // Validates tool calls
    StructuredOutputScorer({ match: "fuzzy" }), // Validates the structured query output with flexible matching
  ],
});
