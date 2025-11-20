import { describeEval } from "vitest-evals";
import { ToolCallScorer } from "vitest-evals";
import { searchEventsAgent } from "@sentry/mcp-core/tools/search-events/agent";
import { SentryApiService } from "@sentry/mcp-core/api-client";
import { StructuredOutputScorer } from "./utils/structuredOutputScorer";
import "../setup-env";

// The shared MSW server is already started in setup-env.ts

describeEval("search-events-agent", {
  data: async () => {
    return [
      {
        // Simple query with common fields - should NOT require tool calls
        input: "Show me all errors from today",
        expectedTools: [],
        expected: {
          dataset: "errors",
          query: "", // No filters, just time range
          sort: "-timestamp",
          timeRange: { statsPeriod: "24h" },
        },
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
        expected: {
          dataset: "errors",
          query: /user\.email:test@example\.com|user\.id:123456/, // Can be either
          sort: "-timestamp",
          timeRange: { statsPeriod: "7d" },
        },
      },
      {
        // Common performance query - should NOT require tool calls
        input: "Show me slow API calls taking more than 1 second",
        expectedTools: [],
        expected: {
          dataset: "spans",
          query: /span\.duration:>1000|span\.duration:>1s/, // Can express as ms or seconds
          sort: "-span.duration",
        },
      },
      {
        // Query with OpenTelemetry attributes that need discovery
        input: "Show me LLM calls where temperature setting is above 0.7",
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
              dataset: "spans",
            },
          },
        ],
        expected: {
          dataset: "spans",
          query: "gen_ai.request.temperature:>0.7",
          sort: "-span.duration",
        },
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
        expected: {
          dataset: "errors",
          query: "has:custom.payment.processor",
          sort: "-timestamp",
        },
      },
      {
        // Query with custom field requiring discovery
        input: "Show me spans where custom.db.pool_size is greater than 10",
        expectedTools: [
          {
            name: "datasetAttributes",
            arguments: {
              dataset: "spans",
            },
          },
        ],
        expected: {
          dataset: "spans",
          query: "custom.db.pool_size:>10",
          sort: "-span.duration",
        },
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
          // Agent may find gen_ai fields and use them for calculation
        ],
        expected: {
          dataset: "spans",
          // For aggregations, query filter is optional - empty query gets all spans
          query: /^$|has:gen_ai\.usage\.(input_tokens|output_tokens)/,
          // Equation to sum both token types
          fields: [
            "equation|sum(gen_ai.usage.input_tokens) + sum(gen_ai.usage.output_tokens)",
          ],
          // Sort by the equation result in descending order
          sort: "-equation|sum(gen_ai.usage.input_tokens) + sum(gen_ai.usage.output_tokens)",
          timeRange: { statsPeriod: "24h" },
        },
      },
      {
        // Query that tests sort field self-correction
        // Agent should self-correct by adding count() to fields when sorting by it
        input: "Show me the top 10 most frequent error types",
        expectedTools: [],
        expected: {
          dataset: "errors",
          query: "", // No specific filter, just aggregate all errors
          // Agent should include count() in fields since we're sorting by it
          fields: ["error.type", "count()"],
          // Sort by count in descending order to get "most frequent"
          sort: "-count()",
          // timeRange can be null or have a default period
        },
      },
      {
        // Complex aggregate query that tests sort field self-correction
        // Agent should self-correct by including avg(span.duration) in fields
        input:
          "Show me database operations grouped by type, sorted by average duration",
        expectedTools: [
          {
            name: "datasetAttributes",
            arguments: {
              dataset: "spans",
            },
          },
        ],
        expected: {
          dataset: "spans",
          query: "has:db.operation",
          // Agent must include avg(span.duration) since we're sorting by it
          // Use db.operation as the grouping field (span.op is deprecated)
          fields: ["db.operation", "avg(span.duration)"],
          // Sort by average duration
          sort: "-avg(span.duration)",
          // timeRange is optional
        },
      },
    ];
  },
  task: async (input) => {
    // Create a real API service that will use MSW mocks
    const apiService = new SentryApiService({
      accessToken: "test-token",
    });

    const agentResult = await searchEventsAgent({
      query: input,
      organizationSlug: "sentry-mcp-evals",
      apiService,
    });

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
