import { describeToolPredictionEval, FIXTURES } from "./utils";

describeToolPredictionEval("list-dsns", [
  {
    input: `What is the SENTRY_DSN for ${FIXTURES.organizationSlug}/${FIXTURES.projectSlug}?`,
    expectedTools: [
      {
        name: "find_dsns",
        arguments: {
          organizationSlug: FIXTURES.organizationSlug,
          projectSlug: FIXTURES.projectSlug,
        },
      },
    ],
  },
]);
