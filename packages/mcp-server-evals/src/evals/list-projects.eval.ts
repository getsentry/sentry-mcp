import { describeToolPredictionEval, FIXTURES } from "./utils";

describeToolPredictionEval("list-projects", [
  {
    input: `What projects do I have access to in Sentry for '${FIXTURES.organizationSlug}'`,
    expectedTools: [
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
    ],
  },
]);
