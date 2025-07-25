import { describeEval } from "vitest-evals";
import { ToolCallScorer } from "vitest-evals";
import { testSearchEventsAgent } from "./utils/testAgents";

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
    const result = await testSearchEventsAgent(input);

    // Return in the format expected by ToolCallScorer
    return {
      result: result.result,
      toolCalls: result.toolCalls.map((call) => ({
        name: call.toolName,
        arguments: call.args,
      })),
    };
  },
  scorers: [ToolCallScorer()],
});
