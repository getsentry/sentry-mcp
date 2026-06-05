import { describeToolPredictionEval, FIXTURES } from "./utils";

describeToolPredictionEval("get-sentry-resource", [
  {
    input: `What's happening in this Sentry issue? ${FIXTURES.issueUrl}`,
    expectedTools: [
      {
        name: "get_sentry_resource",
        arguments: {
          url: FIXTURES.issueUrl,
        },
      },
    ],
  },
  {
    input: `Show me the breadcrumbs for ${FIXTURES.issueUrl}`,
    expectedTools: [
      {
        name: "get_sentry_resource",
        arguments: {
          url: FIXTURES.issueUrl,
          resourceType: "breadcrumbs",
        },
      },
    ],
  },
  {
    input: `Fetch the breadcrumbs for issue ${FIXTURES.issueId} in ${FIXTURES.organizationSlug}.`,
    expectedTools: [
      {
        name: "get_sentry_resource",
        arguments: {
          resourceType: "breadcrumbs",
          organizationSlug: FIXTURES.organizationSlug,
          resourceId: FIXTURES.issueId,
        },
      },
    ],
  },
  {
    input: `Show me what happened in this trace: ${FIXTURES.traceUrl}`,
    expectedTools: [
      {
        name: "get_sentry_resource",
        arguments: {
          url: FIXTURES.traceUrl,
        },
      },
    ],
  },
]);
