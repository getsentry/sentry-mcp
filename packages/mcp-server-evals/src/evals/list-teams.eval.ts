import { FIXTURES, defineToolPredictionEval } from "./utils";

defineToolPredictionEval("list-teams", [
  {
    input: `What teams do I have access to in Sentry for '${FIXTURES.organizationSlug}'`,
    expectedTools: [
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
    ],
  },
  {
    input: `Do I have access to the team '${FIXTURES.teamSlug}' for '${FIXTURES.organizationSlug}'`,
    expectedTools: [
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
    ],
  },
  {
    input: `Do I have access to the team 'an-imaginary-team' for '${FIXTURES.organizationSlug}'`,
    expectedTools: [
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
    ],
  },
]);
