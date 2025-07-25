import { describeEval } from "vitest-evals";
import { ToolCallScorer } from "vitest-evals";
import { testSearchIssuesAgent } from "./utils/testAgents";

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
    const result = await testSearchIssuesAgent(input);

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
