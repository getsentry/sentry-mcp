import { describeEval } from "vitest-evals";
import { Factuality, FIXTURES, TaskRunner, ToolUsage } from "./utils";

describeEval("list-projects", {
  data: async () => {
    return [
      {
        input: `What projects do I have access to in Sentry for '${FIXTURES.organizationSlug}'`,
        expected: FIXTURES.projectSlug,
      },
    ];
  },
  task: TaskRunner(),
  scorers: [ToolUsage("find_projects"), Factuality()],
  threshold: 0.6,
  timeout: 30000,
});
