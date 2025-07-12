import { describeEval } from "vitest-evals";
import { Factuality, FIXTURES, TaskRunner, ToolUsage } from "./utils";

// Note: This eval requires OPENAI_API_KEY to be set in the environment
// The search_events tool uses the AI SDK to translate natural language queries
// Basic test to ensure the search_events tool is called correctly
describeEval("search-events", {
  data: async () => {
    return [
      {
        input: `Use search_events to find error events in ${FIXTURES.organizationSlug}`,
        expected: [
          // Should call the search_events tool
          "search_events",
          "dataset='errors'",
          "/explore/errors/",
        ].join("\n"),
      },
    ];
  },
  task: TaskRunner({ logToolCalls: true }),
  scorers: [ToolUsage("search_events"), Factuality()],
  threshold: 0.7,
  timeout: 60000,
});
