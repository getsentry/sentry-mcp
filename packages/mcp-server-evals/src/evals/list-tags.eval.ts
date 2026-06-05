import { describeToolPredictionEval, FIXTURES } from "./utils";

describeToolPredictionEval("list-tags", [
  {
    input: `What are common tags in ${FIXTURES.organizationSlug}`,
    expectedTools: [
      {
        name: "find_organizations",
        arguments: {},
      },
      {
        name: "find_tags",
        arguments: {
          organizationSlug: FIXTURES.organizationSlug,
          regionUrl: "https://us.sentry.io",
        },
      },
    ],
  },
]);
