import { describeEval } from "vitest-evals";
import { FIXTURES, SimpleTaskRunner, ToolPredictionScorer } from "./utils";

describeEval("create-dsn", {
  data: async () => {
    return [
      {
        input: `Create a new DSN named "Production" for '${FIXTURES.organizationSlug}/${FIXTURES.projectSlug}'`,
        expected: [
          {
            name: "create_dsn",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              projectSlug: FIXTURES.projectSlug,
              name: "Production",
            },
          },
        ],
      },
    ];
  },
  task: SimpleTaskRunner(),
  scorers: [ToolPredictionScorer()],
  threshold: 0.6,
  timeout: 30000,
});
