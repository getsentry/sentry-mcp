import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

import autofixStateFixture from "./fixtures/autofix-state.json";
import issueFixture from "./fixtures/issue.json";
import eventsFixture from "./fixtures/event.json";
import tagsFixture from "./fixtures/tags.json";
import projectFixture from "./fixtures/project.json";
import teamFixture from "./fixtures/team.json";

const OrganizationPayload = {
  id: "4509106740723712",
  slug: "sentry-mcp-evals",
  name: "sentry-mcp-evals",
  links: {
    regionUrl: "https://us.sentry.io",
    organizationUrl: "https://sentry.io/sentry-mcp-evals",
  },
};

const ReleasePayload = {
  id: 1402755016,
  version: "8ce89484-0fec-4913-a2cd-e8e2d41dee36",
  status: "open",
  shortVersion: "8ce89484-0fec-4913-a2cd-e8e2d41dee36",
  versionInfo: {
    package: null,
    version: { raw: "8ce89484-0fec-4913-a2cd-e8e2d41dee36" },
    description: "8ce89484-0fec-4913-a2cd-e8e2d41dee36",
    buildHash: null,
  },
  ref: null,
  url: null,
  dateReleased: null,
  dateCreated: "2025-04-13T19:54:21.764000Z",
  data: {},
  newGroups: 0,
  owner: null,
  commitCount: 0,
  lastCommit: null,
  deployCount: 0,
  lastDeploy: null,
  authors: [],
  projects: [
    {
      id: 4509062593708032,
      slug: "cloudflare-mcp",
      name: "cloudflare-mcp",
      newGroups: 0,
      platform: "bun",
      platforms: ["javascript"],
      hasHealthData: false,
    },
  ],
  firstEvent: "2025-04-13T19:54:21Z",
  lastEvent: "2025-04-13T20:28:23Z",
  currentProjectMeta: {},
  userAgent: null,
};

const ClientKeyPayload = {
  id: "d20df0a1ab5031c7f3c7edca9c02814d",
  name: "Default",
  label: "Default",
  public: "d20df0a1ab5031c7f3c7edca9c02814d",
  secret: "154001fd3dfe38130e1c7948a323fad8",
  projectId: 4509109104082945,
  isActive: true,
  rateLimit: null,
  dsn: {
    secret:
      "https://d20df0a1ab5031c7f3c7edca9c02814d:154001fd3dfe38130e1c7948a323fad8@o4509106732793856.ingest.us.sentry.io/4509109104082945",
    public:
      "https://d20df0a1ab5031c7f3c7edca9c02814d@o4509106732793856.ingest.us.sentry.io/4509109104082945",
    csp: "https://o4509106732793856.ingest.us.sentry.io/api/4509109104082945/csp-report/?sentry_key=d20df0a1ab5031c7f3c7edca9c02814d",
    security:
      "https://o4509106732793856.ingest.us.sentry.io/api/4509109104082945/security/?sentry_key=d20df0a1ab5031c7f3c7edca9c02814d",
    minidump:
      "https://o4509106732793856.ingest.us.sentry.io/api/4509109104082945/minidump/?sentry_key=d20df0a1ab5031c7f3c7edca9c02814d",
    nel: "https://o4509106732793856.ingest.us.sentry.io/api/4509109104082945/nel/?sentry_key=d20df0a1ab5031c7f3c7edca9c02814d",
    unreal:
      "https://o4509106732793856.ingest.us.sentry.io/api/4509109104082945/unreal/d20df0a1ab5031c7f3c7edca9c02814d/",
    crons:
      "https://o4509106732793856.ingest.us.sentry.io/api/4509109104082945/cron/___MONITOR_SLUG___/d20df0a1ab5031c7f3c7edca9c02814d/",
    cdn: "https://js.sentry-cdn.com/d20df0a1ab5031c7f3c7edca9c02814d.min.js",
  },
  browserSdkVersion: "8.x",
  browserSdk: {
    choices: [
      ["9.x", "9.x"],
      ["8.x", "8.x"],
      ["7.x", "7.x"],
    ],
  },
  dateCreated: "2025-04-07T00:12:25.139394Z",
  dynamicSdkLoaderOptions: {
    hasReplay: true,
    hasPerformance: true,
    hasDebug: false,
  },
};

// a newer issue, seen less recently
const issueFixture2 = {
  ...issueFixture,
  id: 6507376926,
  shortId: "CLOUDFLARE-MCP-42",
  count: 1,
  title: "Error: Tool list_issues is already registered",
  firstSeen: "2025-04-11T22:51:19.403000Z",
  lastSeen: "2025-04-12T11:34:11Z",
};

const EventsErrorsMeta = {
  fields: {
    "issue.id": "integer",
    title: "string",
    project: "string",
    "count()": "integer",
    "last_seen()": "date",
  },
  units: {
    "issue.id": null,
    title: null,
    project: null,
    "count()": null,
    "last_seen()": null,
  },
  isMetricsData: false,
  isMetricsExtractedData: false,
  tips: { query: null, columns: null },
  datasetReason: "unchanged",
  dataset: "errors",
};

const EmptyEventsErrorsPayload = {
  data: [],
  meta: EventsErrorsMeta,
};

const EventsErrorsPayload = {
  data: [
    {
      "issue.id": 6114575469,
      title: "Error: Tool list_organizations is already registered",
      project: "test-suite",
      "count()": 2,
      "last_seen()": "2025-04-07T12:23:39+00:00",
      issue: "CLOUDFLARE-MCP-41",
    },
  ],
  meta: EventsErrorsMeta,
};

const EventsSpansMeta = {
  fields: {
    id: "string",
    "span.op": "string",
    "span.description": "string",
    "span.duration": "duration",
    transaction: "string",
    timestamp: "string",
    is_transaction: "boolean",
    project: "string",
    trace: "string",
    "transaction.span_id": "string",
    "project.name": "string",
  },
  units: {
    id: null,
    "span.op": null,
    "span.description": null,
    "span.duration": "millisecond",
    transaction: null,
    timestamp: null,
    is_transaction: null,
    project: null,
    trace: null,
    "transaction.span_id": null,
    "project.name": null,
  },
  isMetricsData: false,
  isMetricsExtractedData: false,
  tips: {},
  datasetReason: "unchanged",
  dataset: "spans",
  dataScanned: "full",
  accuracy: {
    confidence: [
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
    ],
  },
};

const EmptyEventsSpansPayload = {
  data: [],
  meta: EventsSpansMeta,
};

const EventsSpansPayload = {
  data: [
    {
      id: "07752c6aeb027c8f",
      "span.op": "http.server",
      "span.description": "GET /trpc/bottleList",
      "span.duration": 12.0,
      transaction: "GET /trpc/bottleList",
      timestamp: "2025-04-13T14:19:18+00:00",
      is_transaction: true,
      project: "peated",
      trace: "6a477f5b0f31ef7b6b9b5e1dea66c91d",
      "transaction.span_id": "07752c6aeb027c8f",
      "project.name": "peated",
    },
    {
      id: "7ab5edf5b3ba42c9",
      "span.op": "http.server",
      "span.description": "GET /trpc/bottleList",
      "span.duration": 18.0,
      transaction: "GET /trpc/bottleList",
      timestamp: "2025-04-13T14:19:17+00:00",
      is_transaction: true,
      project: "peated",
      trace: "54177131c7b192a446124daba3136045",
      "transaction.span_id": "7ab5edf5b3ba42c9",
      "project.name": "peated",
    },
  ],
  meta: EventsSpansMeta,
  confidence: [
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
  ],
};

function buildHandlers(
  handlers: {
    method: keyof typeof http;
    path: string;
    fetch: Parameters<(typeof http)[keyof typeof http]>[1];
  }[],
) {
  return [
    ...handlers.map((handler) =>
      http[handler.method](
        `https://us.sentry.io${handler.path}`,
        handler.fetch,
      ),
    ),
    ...handlers.map((handler) =>
      http[handler.method](`https://sentry.io${handler.path}`, handler.fetch),
    ),
  ];
}

export const restHandlers = buildHandlers([
  {
    method: "get",
    path: "/api/0/auth/",
    fetch: () => {
      return HttpResponse.json({
        id: "1",
        name: "John Doe",
        email: "john.doe@example.com",
      });
    },
  },
  {
    method: "get",
    path: "/api/0/users/me/regions/",
    fetch: () => {
      return HttpResponse.json({
        regions: [{ name: "us", url: "https://us.sentry.io" }],
      });
    },
  },
  {
    method: "get",
    path: "/api/0/organizations/",
    fetch: () => {
      return HttpResponse.json([OrganizationPayload]);
    },
  },
  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/",
    fetch: () => {
      return HttpResponse.json(OrganizationPayload);
    },
  },
  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/teams/",
    fetch: () => {
      return HttpResponse.json([teamFixture]);
    },
  },
  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/projects/",
    fetch: () => {
      return HttpResponse.json([
        {
          ...projectFixture,
          id: "4509106749636608", // Different ID for GET endpoint
        },
      ]);
    },
  },
  {
    method: "post",
    path: "/api/0/organizations/sentry-mcp-evals/teams/",
    fetch: () => {
      // TODO: validate payload (only accept 'the-goats' for team name)
      return HttpResponse.json(
        {
          ...teamFixture,
          id: "4509109078196224",
          dateCreated: "2025-04-07T00:05:48.196710Z",
          access: [
            "event:read",
            "org:integrations",
            "org:read",
            "member:read",
            "alerts:write",
            "event:admin",
            "team:admin",
            "project:releases",
            "team:read",
            "project:write",
            "event:write",
            "team:write",
            "project:read",
            "project:admin",
            "alerts:read",
          ],
        },
        { status: 201 },
      );
    },
  },
  {
    method: "post",
    path: "/api/0/teams/sentry-mcp-evals/the-goats/projects/",
    fetch: async ({ request }) => {
      // TODO: validate payload (only accept 'cloudflare-mcp' for project name)
      const body = (await request.json()) as any;
      return HttpResponse.json({
        ...projectFixture,
        name: body?.name || "cloudflare-mcp",
        slug: body?.slug || "cloudflare-mcp",
        platform: body?.platform || "node",
      });
    },
  },
  {
    method: "put",
    path: "/api/0/projects/sentry-mcp-evals/cloudflare-mcp/",
    fetch: async ({ request }) => {
      const body = (await request.json()) as any;
      return HttpResponse.json({
        ...projectFixture,
        slug: body?.slug || "cloudflare-mcp",
        name: body?.name || "cloudflare-mcp",
        platform: body?.platform || "node",
      });
    },
  },
  {
    method: "post",
    path: "/api/0/projects/sentry-mcp-evals/cloudflare-mcp/keys/",
    fetch: () => {
      // TODO: validate payload (only accept 'Default' for key name)
      return HttpResponse.json(ClientKeyPayload);
    },
  },
  {
    method: "get",
    path: "/api/0/projects/sentry-mcp-evals/cloudflare-mcp/keys/",
    fetch: () => {
      return HttpResponse.json([ClientKeyPayload]);
    },
  },
  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/events/",
    fetch: async ({ request }) => {
      const url = new URL(request.url);
      const dataset = url.searchParams.get("dataset");
      const query = url.searchParams.get("query");
      const fields = url.searchParams.getAll("field");

      if (dataset === "spans") {
        //[sentryApi] GET https://sentry.io/api/0/organizations/sentry-mcp-evals/events/?dataset=spans&per_page=10&referrer=sentry-mcp&sort=-span.duration&allowAggregateConditions=0&useRpc=1&field=id&field=trace&field=span.op&field=span.description&field=span.duration&field=transaction&field=project&field=timestamp&query=is_transaction%3Atrue
        if (query !== "is_transaction:true") {
          return HttpResponse.json(EmptyEventsSpansPayload);
        }

        if (url.searchParams.get("useRpc") !== "1") {
          return HttpResponse.json("Invalid useRpc", { status: 400 });
        }

        if (
          !fields.includes("id") ||
          !fields.includes("trace") ||
          !fields.includes("span.op") ||
          !fields.includes("span.description") ||
          !fields.includes("span.duration")
        ) {
          return HttpResponse.json("Invalid fields", { status: 400 });
        }
        return HttpResponse.json(EventsSpansPayload);
      }
      if (dataset === "errors") {
        //https://sentry.io/api/0/organizations/sentry-mcp-evals/events/?dataset=errors&per_page=10&referrer=sentry-mcp&sort=-count&statsPeriod=1w&field=issue&field=title&field=project&field=last_seen%28%29&field=count%28%29&query=

        if (
          !fields.includes("issue") ||
          !fields.includes("title") ||
          !fields.includes("project") ||
          !fields.includes("last_seen()") ||
          !fields.includes("count()")
        ) {
          return HttpResponse.json("Invalid fields", { status: 400 });
        }

        if (
          !["-count", "-last_seen"].includes(
            url.searchParams.get("sort") as string,
          )
        ) {
          return HttpResponse.json("Invalid sort", { status: 400 });
        }

        // TODO: this is not correct, but itll fix test flakiness for now
        const sortedQuery = query ? query?.split(" ").sort().join(" ") : null;
        if (
          ![
            null,
            "",
            "error.handled:false",
            "error.unhandled:true",
            "error.handled:false is:unresolved",
            "error.unhandled:true is:unresolved",
            "is:unresolved project:cloudflare-mcp",
            "project:cloudflare-mcp",
            "user.email:david@sentry.io",
          ].includes(sortedQuery)
        ) {
          return HttpResponse.json(EmptyEventsErrorsPayload);
        }

        return HttpResponse.json(EventsErrorsPayload);
      }

      return HttpResponse.json("Invalid dataset", { status: 400 });
    },
  },
  {
    method: "get",
    path: "/api/0/projects/sentry-mcp-evals/foobar/issues/",
    fetch: () => HttpResponse.json([]),
  },
  {
    method: "get",
    path: "/api/0/projects/sentry-mcp-evals/cloudflare-mcp/issues/",
    fetch: ({ request }) => {
      const url = new URL(request.url);
      const sort = url.searchParams.get("sort");

      if (![null, "user", "freq", "date", "new", null].includes(sort)) {
        return HttpResponse.json(
          `Invalid sort: ${url.searchParams.get("sort")}`,
          {
            status: 400,
          },
        );
      }

      const collapse = url.searchParams.getAll("collapse");
      if (collapse.includes("stats")) {
        return HttpResponse.json(`Invalid collapse: ${collapse.join(",")}`, {
          status: 400,
        });
      }

      const query = url.searchParams.get("query");
      const queryTokens = query?.split(" ").sort() ?? [];
      const sortedQuery = queryTokens ? queryTokens.join(" ") : null;
      if (
        ![
          null,
          "",
          "is:unresolved",
          "error.handled:false is:unresolved",
          "error.unhandled:true is:unresolved",
          "user.email:david@sentry.io",
        ].includes(sortedQuery)
      ) {
        return HttpResponse.json([]);
      }

      if (queryTokens.includes("user.email:david@sentry.io")) {
        return HttpResponse.json([issueFixture]);
      }

      if (sort === "date") {
        return HttpResponse.json([issueFixture, issueFixture2]);
      }
      return HttpResponse.json([issueFixture2, issueFixture]);
    },
  },

  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/issues/",
    fetch: ({ request }) => {
      const url = new URL(request.url);
      const sort = url.searchParams.get("sort");

      if (![null, "user", "freq", "date", "new", null].includes(sort)) {
        return HttpResponse.json(
          `Invalid sort: ${url.searchParams.get("sort")}`,
          {
            status: 400,
          },
        );
      }

      const collapse = url.searchParams.getAll("collapse");
      if (collapse.includes("stats")) {
        return HttpResponse.json(`Invalid collapse: ${collapse.join(",")}`, {
          status: 400,
        });
      }

      const query = url.searchParams.get("query");
      const queryTokens = query?.split(" ").sort() ?? [];
      const sortedQuery = queryTokens ? queryTokens.join(" ") : null;
      if (query === "7ca573c0f4814912aaa9bdc77d1a7d51") {
        return HttpResponse.json([issueFixture]);
      }
      if (
        ![
          null,
          "",
          "is:unresolved",
          "error.handled:false is:unresolved",
          "error.unhandled:true is:unresolved",
          "project:cloudflare-mcp",
          "is:unresolved project:cloudflare-mcp",
          "user.email:david@sentry.io",
        ].includes(sortedQuery)
      ) {
        if (queryTokens.includes("project:remote-mcp")) {
          return HttpResponse.json(
            {
              detail:
                "Invalid query. Project(s) remote-mcp do not exist or are not actively selected.",
            },
            { status: 400 },
          );
        }
        return HttpResponse.json([]);
      }
      if (queryTokens.includes("user.email:david@sentry.io")) {
        return HttpResponse.json([issueFixture]);
      }

      if (sort === "date") {
        return HttpResponse.json([issueFixture, issueFixture2]);
      }
      return HttpResponse.json([issueFixture2, issueFixture]);
    },
  },
  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
    fetch: () => HttpResponse.json(issueFixture),
  },
  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/issues/6507376925/",
    fetch: () => HttpResponse.json(issueFixture),
  },
  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-42/",
    fetch: () => HttpResponse.json(issueFixture2),
  },
  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/issues/6507376926/",
    fetch: () => HttpResponse.json(issueFixture2),
  },
  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/events/7ca573c0f4814912aaa9bdc77d1a7d51/",
    fetch: () => HttpResponse.json(eventsFixture),
  },
  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/events/latest/",
    fetch: () => HttpResponse.json(eventsFixture),
  },
  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/issues/6507376925/events/7ca573c0f4814912aaa9bdc77d1a7d51/",
    fetch: () => HttpResponse.json(eventsFixture),
  },
  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/issues/6507376925/events/latest/",
    fetch: () => HttpResponse.json(eventsFixture),
  },
  // TODO: event payload should be tweaked to match issue
  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-42/events/latest/",
    fetch: () => HttpResponse.json(eventsFixture),
  },
  // TODO: event payload should be tweaked to match issue
  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/issues/6507376926/events/latest/",
    fetch: () => HttpResponse.json(eventsFixture),
  },
  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/releases/",
    fetch: () => HttpResponse.json([ReleasePayload]),
  },
  {
    method: "get",
    path: "/api/0/projects/sentry-mcp-evals/cloudflare-mcp/releases/",
    fetch: () => HttpResponse.json([ReleasePayload]),
  },
  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/tags/",
    fetch: () => HttpResponse.json(tagsFixture),
  },
  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/issues/6507376925/autofix/",
    fetch: () => HttpResponse.json(autofixStateFixture),
  },
  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/issues/PEATED-A8/autofix/",
    fetch: () => HttpResponse.json(autofixStateFixture),
  },
  {
    method: "post",
    path: "/api/0/organizations/sentry-mcp-evals/issues/6507376925/autofix/",
    fetch: () => HttpResponse.json({ run_id: 123 }),
  },
  {
    method: "post",
    path: "/api/0/organizations/sentry-mcp-evals/issues/PEATED-A8/autofix/",
    fetch: () => HttpResponse.json({ run_id: 123 }),
  },
  {
    method: "post",
    path: "/api/0/projects/sentry-mcp-evals/cloudflare-mcp/teams/the-goats/",
    fetch: async ({ request }) => {
      const body = (await request.json()) as any;
      return HttpResponse.json({
        ...teamFixture,
        id: "4509109078196224",
        slug: body?.slug || "the-goats",
        name: body?.name || "the-goats",
        dateCreated: "2025-04-07T00:05:48.196710Z",
      });
    },
  },
]);

export const mswServer = setupServer(...restHandlers);
