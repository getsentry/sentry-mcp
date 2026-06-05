import { describeToolPredictionEval, FIXTURES } from "./utils";

describeToolPredictionEval("list-releases", [
  {
    input: `Show me the releases in ${FIXTURES.organizationSlug}`,
    expectedTools: [
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
]);
