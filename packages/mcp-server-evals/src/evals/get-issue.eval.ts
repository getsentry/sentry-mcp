import { FIXTURES, defineMcpToolCallEval } from "./utils";

defineMcpToolCallEval(
  "get-issue",
  [
    {
      input: `Explain CLOUDFLARE-MCP-41 from Sentry in ${FIXTURES.organizationSlug}.`,
      expectedTools: [
        {
          name: "get_sentry_resource",
          arguments: {
            resourceType: "issue",
            organizationSlug: FIXTURES.organizationSlug,
            resourceId: "CLOUDFLARE-MCP-41",
          },
        },
      ],
    },
    {
      input: `Explain the event with ID 7ca573c0f4814912aaa9bdc77d1a7d51 from Sentry in ${FIXTURES.organizationSlug}.`,
      expectedTools: [
        {
          name: "get_sentry_resource",
          arguments: {
            resourceType: "event",
            organizationSlug: FIXTURES.organizationSlug,
            resourceId: "7ca573c0f4814912aaa9bdc77d1a7d51",
          },
        },
      ],
    },
  ],
  {
    toolCall: { ordered: true, params: "fuzzy" },
  },
);
