import { FIXTURES, defineToolPredictionEval } from "./utils";

defineToolPredictionEval("create-dsn", [
  {
    input: `Create a new DSN named "Production" for '${FIXTURES.organizationSlug}/${FIXTURES.projectSlug}'`,
    expectedTools: [
      {
        name: "create_dsn",
        arguments: {
          organizationSlug: FIXTURES.organizationSlug,
          projectSlug: FIXTURES.projectSlug,
          name: "Production",
        },
      },
    ],
  },
]);
