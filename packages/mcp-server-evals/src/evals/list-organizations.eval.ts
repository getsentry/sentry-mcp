import { describeToolPredictionEval } from "./utils";

describeToolPredictionEval("list-organizations", [
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
