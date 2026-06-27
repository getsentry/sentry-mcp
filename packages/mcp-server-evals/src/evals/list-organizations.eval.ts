import { defineToolPredictionEval } from "./utils";

defineToolPredictionEval("list-organizations", [
  {
    input: `What organizations do I have access to in Sentry`,
    expectedTools: [
      {
        name: "find_organizations",
        arguments: {},
      },
    ],
  },
]);
