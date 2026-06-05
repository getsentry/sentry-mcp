import { describeToolPredictionEval, FIXTURES } from "./utils";

describeToolPredictionEval("update-project", [
  {
    input: `Update the project '${FIXTURES.projectSlug}' in organization '${FIXTURES.organizationSlug}' to change its name to 'Updated Project Name' and slug to 'updated-project-slug'. Output only the new project slug as plain text without any formatting:\nupdated-project-slug`,
    expectedTools: [
      {
        name: "update_project",
        arguments: {
          organizationSlug: FIXTURES.organizationSlug,
          projectSlug: FIXTURES.projectSlug,
          name: "Updated Project Name",
          slug: "updated-project-slug",
        },
      },
    ],
  },
  {
    input: `Assign the project '${FIXTURES.projectSlug}' in organization '${FIXTURES.organizationSlug}' to the team '${FIXTURES.teamSlug}'. Output only the team slug as plain text without any formatting:\nthe-goats`,
    expectedTools: [
      {
        name: "update_project",
        arguments: {
          organizationSlug: FIXTURES.organizationSlug,
          projectSlug: FIXTURES.projectSlug,
          teamSlug: FIXTURES.teamSlug,
        },
      },
    ],
  },
]);
