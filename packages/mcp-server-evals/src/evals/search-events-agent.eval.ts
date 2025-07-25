import { describeEval } from "vitest-evals";
import { FIXTURES, NoOpTaskRunner, ToolPredictionScorer } from "./utils";

// This eval documents expected behavior for the search-events agent when
// handling equation-based queries. It helps identify the correct query
// structure the embedded agent should generate.
//
// The search_events tool contains an embedded AI agent that translates
// natural language queries to Sentry's query syntax. For token calculations
// and other derived metrics, it should use the "equation|" field prefix.
//
// Example: "sum of tokens used today" should generate:
// fields: ["equation|sum(gen_ai.usage.input_tokens) + sum(gen_ai.usage.output_tokens)"]
describeEval("search-events-equations", {
  data: async () => {
    return [
      // Test 1: Total tokens calculation should use equation field
      {
        input: `Show me the sum of tokens used today in ${FIXTURES.organizationSlug}`,
        expectedTools: [
          {
            name: "search_events",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              naturalLanguageQuery: "sum of tokens used today",
              // Expected agent output:
              // dataset: "spans"
              // fields: ["equation|sum(gen_ai.usage.input_tokens) + sum(gen_ai.usage.output_tokens)"]
              // sort: "-equation|sum(gen_ai.usage.input_tokens) + sum(gen_ai.usage.output_tokens)"
            },
          },
        ],
      },
      // Test 2: Simple sum should NOT use equation
      {
        input: `Show me total input tokens used in ${FIXTURES.organizationSlug}`,
        expectedTools: [
          {
            name: "search_events",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              naturalLanguageQuery: "total input tokens used",
              // Expected: fields: ["sum(gen_ai.usage.input_tokens)"]
              // NOT: fields: ["equation|sum(gen_ai.usage.input_tokens)"]
            },
          },
        ],
      },
      // Test 3: Grouped aggregation with equation
      {
        input: `Calculate total tokens by tool name in ${FIXTURES.organizationSlug}`,
        expectedTools: [
          {
            name: "search_events",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              naturalLanguageQuery: "total tokens by tool name",
              // Expected:
              // fields: ["mcp.tool.name", "equation|sum(gen_ai.usage.input_tokens) + sum(gen_ai.usage.output_tokens)"]
              // sort: "-equation|sum(gen_ai.usage.input_tokens) + sum(gen_ai.usage.output_tokens)"
            },
          },
        ],
      },
      // Test 4: Duration conversion to milliseconds
      {
        input: `What's the average duration in milliseconds for spans in ${FIXTURES.organizationSlug}?`,
        expectedTools: [
          {
            name: "search_events",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              naturalLanguageQuery: "average duration in milliseconds",
              // Expected: fields: ["equation|avg(span.duration) * 1000"]
            },
          },
        ],
      },
      // Test 5: Error rate percentage
      {
        input: `Show me the error rate percentage in ${FIXTURES.organizationSlug}`,
        expectedTools: [
          {
            name: "search_events",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              naturalLanguageQuery: "error rate percentage",
              // Expected: fields: ["equation|failure_rate() * 100"]
            },
          },
        ],
      },
      // Test 6: Complex calculation with parentheses
      {
        input: `Calculate total AI cost as input tokens plus output tokens times 2 in ${FIXTURES.organizationSlug}`,
        expectedTools: [
          {
            name: "search_events",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              naturalLanguageQuery:
                "total AI cost as input tokens plus output tokens times 2",
              // Expected: fields: ["equation|sum(gen_ai.usage.input_tokens) + (sum(gen_ai.usage.output_tokens) * 2)"]
            },
          },
        ],
      },
      // Test 7: Requests per second calculation
      {
        input: `What's the requests per second rate for the last hour in ${FIXTURES.organizationSlug}?`,
        expectedTools: [
          {
            name: "search_events",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              naturalLanguageQuery: "requests per second for the last hour",
              // Expected: fields: ["equation|count() / 3600"]
              // timeRange: { statsPeriod: "1h" }
            },
          },
        ],
      },
    ];
  },
  task: NoOpTaskRunner(),
  scorers: [ToolPredictionScorer()],
  threshold: 0.8,
  timeout: 30000,
});
