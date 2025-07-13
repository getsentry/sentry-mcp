import { describeEval } from "vitest-evals";
import { FIXTURES, SimpleTaskRunner, ToolPredictionScorer } from "./utils";

describeEval("list-releases", {
  data: async () => {
    return [
      {
        input: `Show me the releases in ${FIXTURES.organizationSlug}`,
        expected: [
          {
            name: "find_organizations",
            arguments: {},
          },
          {
            name: "find_releases",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              regionUrl: "https://us.sentry.io",
            },
          },
        ],
      },
      {
        input: `Show me a list of versions in ${FIXTURES.organizationSlug}/${FIXTURES.projectSlug}`,
        expected: [
          {
            name: "find_organizations",
            arguments: {},
          },
          {
            name: "find_projects",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              regionUrl: "https://us.sentry.io",
            },
          },
          {
            name: "find_releases",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              projectSlug: FIXTURES.projectSlug,
              regionUrl: "https://us.sentry.io",
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
