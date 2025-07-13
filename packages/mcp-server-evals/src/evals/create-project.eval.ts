import { describeEval } from "vitest-evals";
import { FIXTURES, SimpleTaskRunner, ToolPredictionScorer } from "./utils";

describeEval("create-project", {
  data: async () => {
    return [
      {
        input: `Create a new project in Sentry for '${FIXTURES.organizationSlug}' called '${FIXTURES.projectSlug}' with the '${FIXTURES.teamSlug}' team. Output **only** the project slug and the SENTRY_DSN in the format of:\n<PROJECT_SLUG>\n<SENTRY_DSN>`,
        expected: [
          {
            name: "find_organizations",
            arguments: {},
          },
          {
            name: "find_teams",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              regionUrl: "https://us.sentry.io",
            },
          },
          {
            name: "create_project",
            arguments: {
              organizationSlug: FIXTURES.organizationSlug,
              regionUrl: "https://us.sentry.io",
              teamSlug: FIXTURES.teamSlug,
              name: FIXTURES.projectSlug,
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
