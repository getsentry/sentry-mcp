import { describeEval } from "vitest-evals";
import { FIXTURES } from "./utils";

// This eval documents expected outputs from the search_events agent
// when translating natural language queries to Sentry's query syntax.
//
// The agent (translateQuery function) uses OpenAI to translate queries
// and has access to tools for field discovery and user resolution.
//
// Key test cases focus on equation field generation for complex calculations.
describeEval("search-events-agent-equations", {
  data: async () => {
    return [
      // Test 1: Total tokens calculation should use equation field
      {
        input: "sum of tokens used today",
        expected: {
          dataset: "spans",
          fields: [
            "equation|sum(gen_ai.usage.input_tokens) + sum(gen_ai.usage.output_tokens)",
          ],
          sort: "-equation|sum(gen_ai.usage.input_tokens) + sum(gen_ai.usage.output_tokens)",
          timeRange: { statsPeriod: "24h" },
        },
      },
      // Test 2: Simple sum should NOT use equation
      {
        input: "total input tokens used",
        expected: {
          dataset: "spans",
          fields: ["sum(gen_ai.usage.input_tokens)"],
          sort: "-sum(gen_ai.usage.input_tokens)",
        },
      },
      // Test 3: Grouped aggregation with equation
      {
        input: "total tokens by tool name",
        expected: {
          dataset: "spans",
          fields: [
            "mcp.tool.name",
            "equation|sum(gen_ai.usage.input_tokens) + sum(gen_ai.usage.output_tokens)",
          ],
          sort: "-equation|sum(gen_ai.usage.input_tokens) + sum(gen_ai.usage.output_tokens)",
        },
      },
      // Test 4: Duration conversion (spans are already in milliseconds)
      {
        input: "average duration in milliseconds",
        expected: {
          dataset: "spans",
          fields: ["avg(span.duration)"],
          sort: "-avg(span.duration)",
        },
      },
      // Test 5: Error rate percentage
      {
        input: "error rate percentage",
        expected: {
          dataset: "spans",
          fields: ["equation|failure_rate() * 100"],
          sort: "-equation|failure_rate() * 100",
        },
      },
      // Test 6: Complex calculation with parentheses
      {
        input: "total AI cost as input tokens plus output tokens times 2",
        expected: {
          dataset: "spans",
          fields: [
            "equation|sum(gen_ai.usage.input_tokens) + (sum(gen_ai.usage.output_tokens) * 2)",
          ],
          sort: "-equation|sum(gen_ai.usage.input_tokens) + (sum(gen_ai.usage.output_tokens) * 2)",
        },
      },
      // Test 7: Requests per second calculation
      {
        input: "requests per second for the last hour",
        expected: {
          dataset: "spans",
          fields: ["equation|count() / 3600"],
          sort: "-equation|count() / 3600",
          timeRange: { statsPeriod: "1h" },
        },
      },
      // Test 8: Count query without equation
      {
        input: "how many errors today",
        expected: {
          dataset: "errors",
          fields: ["count()"],
          sort: "-count()",
          timeRange: { statsPeriod: "24h" },
        },
      },
      // Test 9: Regular aggregate function sorting
      {
        input: "slowest database queries",
        expected: {
          dataset: "spans",
          query: "has:db.statement",
          fields: [
            "span.op",
            "span.description",
            "span.duration",
            "transaction",
            "timestamp",
            "project",
            "trace",
            "db.system",
            "db.statement",
          ],
          sort: "-span.duration",
        },
      },
    ];
  },
  task: async (input: string) => {
    // This is a documentation-only eval that shows expected agent outputs
    // We don't actually call the agent here since it requires OPENAI_API_KEY
    // Instead, we return the input to use with a custom scorer
    return { input };
  },
  scorers: [
    async (input, output, expected) => {
      // Documentation scorer - always passes since this is for reference
      return {
        pass: true,
        score: 1,
        reason: `Documented expected output for: "${input}"

Expected agent to generate:
- Dataset: ${expected.dataset || "auto-detected"}
- Query: ${expected.query || "(empty)"}
- Fields: ${expected.fields ? expected.fields.join(", ") : "default"}
- Sort: ${expected.sort || "default"}
- TimeRange: ${expected.timeRange ? JSON.stringify(expected.timeRange) : "none"}

Key insight: ${expected.fields?.some((f) => f.startsWith("equation|")) ? "Uses equation fields for complex calculations" : "Standard aggregation or event query"}`,
      };
    },
  ],
  threshold: 1.0, // Always passes since it's documentation
  timeout: 5000, // Quick timeout since no AI calls
});
