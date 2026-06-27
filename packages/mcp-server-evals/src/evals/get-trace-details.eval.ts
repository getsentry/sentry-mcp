import { FIXTURES, defineMcpToolCallEval } from "./utils";

defineMcpToolCallEval(
  "get-trace-details",
  [
    {
      input: `Show me trace ${FIXTURES.traceId} from Sentry in ${FIXTURES.organizationSlug}.`,
      expectedTools: [
        {
          name: "get_sentry_resource",
          arguments: {
            resourceType: "trace",
            organizationSlug: FIXTURES.organizationSlug,
            resourceId: FIXTURES.traceId,
          },
        },
      ],
    },
    {
      input: `Explain trace ${FIXTURES.traceId} in ${FIXTURES.organizationSlug}.`,
      expectedTools: [
        {
          name: "get_sentry_resource",
          arguments: {
            resourceType: "trace",
            organizationSlug: FIXTURES.organizationSlug,
            resourceId: FIXTURES.traceId,
          },
        },
      ],
    },
  ],
  {
    toolCall: { ordered: true, params: "fuzzy" },
  },
);
