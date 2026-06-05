import { describeMcpToolCallEval, FIXTURES } from "./utils";

describeMcpToolCallEval("get-trace-details", [
  {
    input: `Show me trace ${FIXTURES.traceId} from Sentry in ${FIXTURES.organizationSlug}.`,
    expectedTools: [
      {
        name: "search_tools",
        arguments: {
          query: "trace",
        },
      },
      {
        name: "execute_tool",
        arguments: {
          name: "get_trace_details",
          arguments: {
            organizationSlug: FIXTURES.organizationSlug,
            traceId: FIXTURES.traceId,
          },
        },
      },
    ],
  },
  {
    input: `Explain trace ${FIXTURES.traceId} in ${FIXTURES.organizationSlug}.`,
    expectedTools: [
      {
        name: "search_tools",
        arguments: {
          query: "trace",
        },
      },
      {
        name: "execute_tool",
        arguments: {
          name: "get_trace_details",
          arguments: {
            organizationSlug: FIXTURES.organizationSlug,
            traceId: FIXTURES.traceId,
          },
        },
      },
    ],
  },
]);
