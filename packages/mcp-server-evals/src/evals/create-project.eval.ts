import { FIXTURES, defineToolPredictionEval } from "./utils";

defineToolPredictionEval("create-project", [
  {
    input: `Create a new project in Sentry for '${FIXTURES.organizationSlug}' called '${FIXTURES.projectSlug}' with the '${FIXTURES.teamSlug}' team. Output **only** the project slug and the SENTRY_DSN in the format of:\n<PROJECT_SLUG>\n<SENTRY_DSN>`,
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
]);
