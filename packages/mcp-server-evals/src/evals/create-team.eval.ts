import { describeToolPredictionEval, FIXTURES } from "./utils";

describeToolPredictionEval("create-team", [
  {
    input: `Create a new team in Sentry for '${FIXTURES.organizationSlug}' called 'the-goats' response with **only** the team slug and no other text.`,
    expectedTools: [
      {
        name: "find_organizations",
        arguments: {},
      },
      {
        name: "create_team",
        arguments: {
          organizationSlug: FIXTURES.organizationSlug,
          name: "the-goats",
          regionUrl: "https://us.sentry.io",
        },
      },
    ],
  },
]);
