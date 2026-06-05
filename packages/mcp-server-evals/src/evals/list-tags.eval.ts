import { describeToolPredictionEval, FIXTURES } from "./utils";

describeToolPredictionEval("get-issue-tag-values", [
  {
    input: `What are common values for the url tag on issue CLOUDFLARE-MCP-41 in ${FIXTURES.organizationSlug}?`,
    expectedTools: [
      {
        name: "find_organizations",
        arguments: {},
      },
      {
        name: "get_issue_tag_values",
        arguments: {
          organizationSlug: FIXTURES.organizationSlug,
          regionUrl: "https://us.sentry.io",
          issueId: "CLOUDFLARE-MCP-41",
          tagKey: "url",
        },
      },
    ],
  },
]);
