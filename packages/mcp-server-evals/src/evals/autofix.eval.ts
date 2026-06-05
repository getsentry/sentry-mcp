import { describeToolPredictionEval, FIXTURES } from "./utils";

describeToolPredictionEval("begin-issue-fix", [
  {
    input: `Whats the status on root causing this issue in Sentry?\n${FIXTURES.testIssueUrl}`,
    expectedTools: [
      {
        name: "analyze_issue_with_seer",
        arguments: {
          issueUrl: FIXTURES.testIssueUrl,
        },
      },
    ],
  },
  {
    input: `Can you root cause this issue and retrieve the analysis?\n${FIXTURES.testIssueUrl}`,
    expectedTools: [
      {
        name: "analyze_issue_with_seer",
        arguments: {
          issueUrl: FIXTURES.testIssueUrl,
        },
      },
    ],
  },
]);
