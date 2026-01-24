/**
 * MSW-based Mock Server for Sentry MCP Development and Testing.
 *
 * Provides comprehensive mock responses for all Sentry API endpoints used by the
 * MCP server. Built with MSW (Mock Service Worker) for realistic HTTP interception
 * and response handling during development and testing.
 *
 * **Usage in Tests:**
 * ```typescript
 * import { mswServer } from "@sentry/mcp-server-mocks";
 *
 * beforeAll(() => mswServer.listen());
 * afterEach(() => mswServer.resetHandlers());
 * afterAll(() => mswServer.close());
 * ```
 *
 * **Usage in Development:**
 * ```typescript
 * // Start mock server for local development
 * mswServer.listen();
 * // Now all Sentry API calls will be intercepted
 * ```
 */
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

import autofixStateFixture from "./fixtures/autofix-state.json" with {
  type: "json",
};
import issueFixture from "./fixtures/issue.json" with { type: "json" };
import eventsFixture from "./fixtures/event.json" with { type: "json" };
import performanceEventFixture from "./fixtures/performance-event.json" with {
  type: "json",
};
import eventAttachmentsFixture from "./fixtures/event-attachments.json" with {
  type: "json",
};
import tagsFixture from "./fixtures/tags.json" with { type: "json" };
import projectFixture from "./fixtures/project.json" with { type: "json" };
import teamFixture from "./fixtures/team.json" with { type: "json" };
import traceItemsAttributesFixture from "./fixtures/trace-items-attributes.json" with {
  type: "json",
};
import traceItemsAttributesSpansStringFixture from "./fixtures/trace-items-attributes-spans-string.json" with {
  type: "json",
};
import traceItemsAttributesSpansNumberFixture from "./fixtures/trace-items-attributes-spans-number.json" with {
  type: "json",
};
import traceItemsAttributesLogsStringFixture from "./fixtures/trace-items-attributes-logs-string.json" with {
  type: "json",
};
import traceItemsAttributesLogsNumberFixture from "./fixtures/trace-items-attributes-logs-number.json" with {
  type: "json",
};
import traceMetaFixture from "./fixtures/trace-meta.json" with { type: "json" };
import traceMetaWithNullsFixture from "./fixtures/trace-meta-with-nulls.json" with {
  type: "json",
};
import traceFixture from "./fixtures/trace.json" with { type: "json" };
import traceMixedFixture from "./fixtures/trace-mixed.json" with {
  type: "json",
};
import traceEventFixture from "./fixtures/trace-event.json" with {
  type: "json",
};
import issueTagValuesFixture from "./fixtures/issue-tag-values.json" with {
  type: "json",
};
import flamegraphFixture from "./fixtures/flamegraph.json" with {
  type: "json",
};

/**
 * Standard organization payload for mock responses.
 * Used across multiple endpoints for consistency.
 */
const OrganizationPayload = {
  id: "4509106740723712",
  slug: "sentry-mcp-evals",
  name: "sentry-mcp-evals",
  links: {
    regionUrl: "https://us.sentry.io",
    organizationUrl: "https://sentry.io/sentry-mcp-evals",
  },
};

/**
 * Standard release payload for mock responses.
 * Includes typical metadata and project associations.
 */
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

/**
 * Builds MSW handlers for both SaaS and self-hosted Sentry instances.
 *
 * Creates handlers based on the controlOnly flag:
 * - controlOnly: false (default) - Creates handlers for both sentry.io and us.sentry.io
 * - controlOnly: true - Creates handlers only for sentry.io (main host)
 *
 * @param handlers - Array of handler definitions with method, path, fetch function, and optional controlOnly flag
 * @returns Array of MSW http handlers
 *
 * @example Handler Definitions
 * ```typescript
 * buildHandlers([
 *   {
 *     method: "get",
 *     path: "/api/0/auth/",
 *     fetch: () => HttpResponse.json({ user: "data" }),
 *     controlOnly: true  // Only available on sentry.io
 *   },
 *   {
 *     method: "get",
 *     path: "/api/0/organizations/",
 *     fetch: () => HttpResponse.json([OrganizationPayload]),
 *     controlOnly: false  // Available on both sentry.io and us.sentry.io
 *   }
 * ]);
 * ```
 */
function buildHandlers(
  handlers: {
    method: keyof typeof http;
    path: string;
    fetch: Parameters<(typeof http)[keyof typeof http]>[1];
    controlOnly?: boolean;
  }[],
) {
  const result = [];

  for (const handler of handlers) {
    // Always add handler for main host (sentry.io)
    result.push(
      http[handler.method](`https://sentry.io${handler.path}`, handler.fetch),
    );

    // Only add handler for region-specific host if not controlOnly
    if (!handler.controlOnly) {
      result.push(
        http[handler.method](
          `https://us.sentry.io${handler.path}`,
          handler.fetch,
        ),
      );
    }
  }

  return result;
}

/**
 * Complete set of Sentry API mock handlers.
 *
 * Covers all endpoints used by the MCP server with realistic responses,
 * parameter validation, and error scenarios.
 */
export const restHandlers = buildHandlers([
  // User data endpoints - controlOnly: true (only available on sentry.io)
  {
    method: "get",
    path: "/api/0/auth/",
    controlOnly: true,
    fetch: () => {
      return HttpResponse.json({
        id: "123456",
        name: "Test User",
        email: "test@example.com",
        username: "testuser",
        avatarUrl: "https://example.com/avatar.jpg",
        dateJoined: "2024-01-01T00:00:00Z",
        isActive: true,
        isManaged: false,
        isStaff: false,
        isSuperuser: false,
        lastLogin: "2024-12-01T00:00:00Z",
        has2fa: false,
        hasPasswordAuth: true,
        emails: [
          {
            id: "1",
            email: "test@example.com",
            is_verified: true,
          },
        ],
      });
    },
  },
  {
    method: "get",
    path: "/api/0/users/me/regions/",
    controlOnly: true,
    fetch: () => {
      return HttpResponse.json({
        regions: [{ name: "us", url: "https://us.sentry.io" }],
      });
    },
  },
  // All other endpoints - controlOnly: false (default, available on both hosts)
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
  // 404 handlers for test scenarios
  {
    method: "get",
    path: "/api/0/organizations/nonexistent-org/",
    fetch: () => {
      return HttpResponse.json(
        { detail: "The requested resource does not exist" },
        { status: 404 },
      );
    },
  },
  {
    method: "get",
    path: "/api/0/projects/sentry-mcp-evals/nonexistent-project/",
    fetch: () => {
      return HttpResponse.json(
        { detail: "The requested resource does not exist" },
        { status: 404 },
      );
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
    method: "get",
    path: "/api/0/projects/sentry-mcp-evals/cloudflare-mcp/",
    fetch: () => {
      return HttpResponse.json(projectFixture);
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

  // Trace endpoints
  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/trace-meta/a4d1aae7216b47ff8117cf4e09ce9d0a/",
    fetch: () => HttpResponse.json(traceMetaFixture),
  },
  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/trace/a4d1aae7216b47ff8117cf4e09ce9d0a/",
    fetch: () => HttpResponse.json(traceFixture),
  },

  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/events/7ca573c0f4814912aaa9bdc77d1a7d51/",
    fetch: () => HttpResponse.json(eventsFixture),
  },
  // Generic handler for listing events within an issue
  {
    method: "get",
    path: "/api/0/organizations/:org/issues/:issueId/events/",
    fetch: () => {
      // Return an array directly (not wrapped in {data: [...]})
      return HttpResponse.json([
        {
          id: "event1",
          timestamp: "2025-01-15T10:00:00Z",
          title: "Test Error",
          environment: "production",
          release: "v1.0",
        },
      ]);
    },
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

  // Performance issue with N+1 query detection
  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/issues/PERF-N1-001/events/latest/",
    fetch: () => HttpResponse.json(performanceEventFixture),
  },
  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/issues/7890123456/events/latest/",
    fetch: () => HttpResponse.json(performanceEventFixture),
  },
  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/issues/PERF-N1-001/events/a1b2c3d4e5f6789012345678901234567/",
    fetch: () => HttpResponse.json(performanceEventFixture),
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
    path: "/api/0/organizations/sentry-mcp-evals/trace-items/attributes/",
    fetch: ({ request }) => {
      const url = new URL(request.url);
      const itemType = url.searchParams.get("itemType");
      const attributeType = url.searchParams.get("attributeType");

      // Validate required parameters
      if (!itemType) {
        return HttpResponse.json(
          { detail: "itemType parameter is required" },
          { status: 400 },
        );
      }

      if (!attributeType) {
        return HttpResponse.json(
          { detail: "attributeType parameter is required" },
          { status: 400 },
        );
      }

      // Validate itemType values (API accepts both singular and plural forms)
      const normalizedItemType = itemType === "spans" ? "span" : itemType;
      if (!["span", "logs"].includes(normalizedItemType)) {
        return HttpResponse.json(
          {
            detail: `Invalid itemType '${itemType}'. Must be 'span' or 'logs'`,
          },
          { status: 400 },
        );
      }

      // Validate attributeType values
      if (!["string", "number"].includes(attributeType)) {
        return HttpResponse.json(
          {
            detail: `Invalid attributeType '${attributeType}'. Must be 'string' or 'number'`,
          },
          { status: 400 },
        );
      }

      // Return appropriate fixture based on parameters
      if (normalizedItemType === "span") {
        if (attributeType === "string") {
          return HttpResponse.json(traceItemsAttributesSpansStringFixture);
        }
        return HttpResponse.json(traceItemsAttributesSpansNumberFixture);
      }
      if (normalizedItemType === "logs") {
        if (attributeType === "string") {
          return HttpResponse.json(traceItemsAttributesLogsStringFixture);
        }
        return HttpResponse.json(traceItemsAttributesLogsNumberFixture);
      }

      // Fallback (should not reach here with valid inputs)
      return HttpResponse.json(traceItemsAttributesFixture);
    },
  },
  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/issues/PEATED-A8/autofix/",
    fetch: () => HttpResponse.json(autofixStateFixture),
  },
  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/autofix/",
    fetch: () => HttpResponse.json({ autofix: null }),
  },
  {
    method: "post",
    path: "/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-42/autofix/",
    fetch: () => HttpResponse.json({ run_id: 123 }),
  },
  {
    method: "post",
    path: "/api/0/organizations/sentry-mcp-evals/issues/PEATED-A8/autofix/",
    fetch: () => HttpResponse.json({ run_id: 123 }),
  },
  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/issues/PERF-N1-001/autofix/",
    fetch: () => HttpResponse.json({ autofix: null }),
  },
  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/issues/DEFAULT-001/autofix/",
    fetch: () => HttpResponse.json({ autofix: null }),
  },
  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/issues/CONTEXT-001/autofix/",
    fetch: () => HttpResponse.json({ autofix: null }),
  },
  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/issues/MCP-SERVER-EQE/autofix/",
    fetch: () => HttpResponse.json({ autofix: null }),
  },
  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/issues/FUTURE-TYPE-001/autofix/",
    fetch: () => HttpResponse.json({ autofix: null }),
  },
  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/issues/BLOG-CSP-4XC/autofix/",
    fetch: () => HttpResponse.json({ autofix: null }),
  },

  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-45/autofix/",
    fetch: () =>
      HttpResponse.json({
        autofix: {
          run_id: 13,
          request: { project_id: 4505138086019073 },
          status: "COMPLETED",
          updated_at: "2025-04-09T22:39:50.778146",
          steps: [
            {
              type: "root_cause_analysis",
              key: "root_cause_analysis",
              index: 0,
              status: "COMPLETED",
              title: "1. **Root Cause Analysis**",
              output_stream: null,
              progress: [],
              description: "The analysis has completed successfully.",
              causes: [
                {
                  description: "The analysis has completed successfully.",
                  id: 1,
                  root_cause_reproduction: [],
                },
              ],
            },
          ],
        },
      }),
  },
  // Issue tag values endpoints
  {
    method: "get",
    path: "/api/0/organizations/:org/issues/:issueId/tags/:tagKey/",
    fetch: ({ params }) => {
      const tagKey = params.tagKey as string;
      // Return fixture with the requested tag key
      return HttpResponse.json({
        ...issueTagValuesFixture,
        key: tagKey,
        name: tagKey.charAt(0).toUpperCase() + tagKey.slice(1),
      });
    },
  },
  {
    method: "post",
    path: "/api/0/projects/sentry-mcp-evals/cloudflare-mcp/teams/:teamSlug/",
    fetch: async ({ request, params }) => {
      const body = (await request.json()) as any;
      const teamSlug = params.teamSlug as string;
      return HttpResponse.json({
        ...teamFixture,
        id: "4509109078196224",
        slug: teamSlug,
        name: teamSlug,
        dateCreated: "2025-04-07T00:05:48.196710Z",
      });
    },
  },
  {
    method: "put",
    path: "/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
    fetch: async ({ request }) => {
      const body = (await request.json()) as any;
      const updatedIssue = {
        ...issueFixture,
        status: body?.status || issueFixture.status,
        assignedTo: body?.assignedTo || issueFixture.assignedTo,
      };
      return HttpResponse.json(updatedIssue);
    },
  },
  {
    method: "put",
    path: "/api/0/organizations/sentry-mcp-evals/issues/6507376925/",
    fetch: async ({ request }) => {
      const body = (await request.json()) as any;
      const updatedIssue = {
        ...issueFixture,
        status: body?.status || issueFixture.status,
        assignedTo: body?.assignedTo || issueFixture.assignedTo,
      };
      return HttpResponse.json(updatedIssue);
    },
  },
  {
    method: "put",
    path: "/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-42/",
    fetch: async ({ request }) => {
      const body = (await request.json()) as any;
      const updatedIssue = {
        ...issueFixture2,
        status: body?.status || issueFixture2.status,
        assignedTo: body?.assignedTo || issueFixture2.assignedTo,
      };
      return HttpResponse.json(updatedIssue);
    },
  },
  {
    method: "put",
    path: "/api/0/organizations/sentry-mcp-evals/issues/6507376926/",
    fetch: async ({ request }) => {
      const body = (await request.json()) as any;
      const updatedIssue = {
        ...issueFixture2,
        status: body?.status || issueFixture2.status,
        assignedTo: body?.assignedTo || issueFixture2.assignedTo,
      };
      return HttpResponse.json(updatedIssue);
    },
  },
  // Profiling endpoints
  {
    method: "get",
    path: "/api/0/organizations/sentry-mcp-evals/profiling/flamegraph/",
    fetch: ({ request }) => {
      const url = new URL(request.url);
      const project = url.searchParams.get("project");
      const query = url.searchParams.get("query");

      // Return empty but valid flamegraph for unknown transactions
      // Note: Query may have quoted transaction name: transaction:"/api/users"
      if (
        !query?.includes('transaction:"/api/users"') &&
        !query?.includes("transaction:/api/users")
      ) {
        return HttpResponse.json({
          ...flamegraphFixture,
          projectID: Number(project) || flamegraphFixture.projectID,
          transactionName: "unknown",
          profiles: [],
          shared: {
            frames: [],
            frame_infos: [],
            profiles: [],
          },
        });
      }

      return HttpResponse.json(flamegraphFixture);
    },
  },
  // Event attachment endpoints
  {
    method: "get",
    path: "/api/0/projects/sentry-mcp-evals/cloudflare-mcp/events/7ca573c0f4814912aaa9bdc77d1a7d51/attachments/",
    fetch: () => HttpResponse.json(eventAttachmentsFixture),
  },
  {
    method: "get",
    path: "/api/0/projects/sentry-mcp-evals/cloudflare-mcp/events/7ca573c0f4814912aaa9bdc77d1a7d51/attachments/123/",
    fetch: () => {
      // Mock attachment blob response
      const mockBlob = new Blob(["fake image data"], { type: "image/png" });
      return new HttpResponse(mockBlob, {
        headers: {
          "Content-Type": "image/png",
        },
      });
    },
  },
]);

// Add handlers for mcp.sentry.dev and localhost
export const searchHandlers = [
  http.post("https://mcp.sentry.dev/api/search", async ({ request }) => {
    const body = (await request.json()) as any;

    // Mock different results based on guide
    let results = [
      {
        id: "product/rate-limiting.md",
        url: "https://docs.sentry.io/product/rate-limiting",
        snippet:
          "Learn how to configure rate limiting in Sentry to prevent quota exhaustion and control event ingestion.",
        relevance: 0.95,
      },
      {
        id: "product/accounts/quotas/spike-protection.md",
        url: "https://docs.sentry.io/product/accounts/quotas/spike-protection",
        snippet:
          "Spike protection helps prevent unexpected spikes in event volume from consuming your quota.",
        relevance: 0.87,
      },
    ];

    // If guide is specified, return platform-specific results
    if (body?.guide) {
      const guide = body.guide;
      if (guide.includes("/")) {
        const [platformName, guideName] = guide.split("/");
        results = [
          {
            id: `platforms/${platformName}/guides/${guideName}.md`,
            url: `https://docs.sentry.io/platforms/${platformName}/guides/${guideName}`,
            snippet: `Setup guide for ${guideName} on ${platformName}`,
            relevance: 0.95,
          },
        ];
      } else {
        results = [
          {
            id: `platforms/${guide}/index.md`,
            url: `https://docs.sentry.io/platforms/${guide}`,
            snippet: `Documentation for ${guide} platform`,
            relevance: 0.95,
          },
        ];
      }
    }

    // Return mock search results
    return HttpResponse.json({
      query: body?.query || "",
      results,
    });
  }),
];

// Mock handlers for documentation fetching
export const docsHandlers = [
  http.get("https://docs.sentry.io/product/rate-limiting.md", () => {
    return new HttpResponse(
      `# Project Rate Limits and Quotas

Rate limiting allows you to control the volume of events that Sentry accepts from your applications. This helps you manage costs and ensures that a sudden spike in errors doesn't consume your entire quota.

## Why Use Rate Limiting?

- **Cost Control**: Prevent unexpected charges from error spikes
- **Noise Reduction**: Filter out repetitive or low-value events
- **Resource Management**: Ensure critical projects have quota available
- **Performance**: Reduce load on your Sentry organization

## Types of Rate Limits

### 1. Organization Rate Limits

Set a maximum number of events per hour across your entire organization:

\`\`\`python
# In your organization settings
rate_limit = 1000  # events per hour
\`\`\`

### 2. Project Rate Limits

Configure limits for specific projects:

\`\`\`javascript
// Project settings
{
  "rateLimit": {
    "window": 3600,  // 1 hour in seconds
    "limit": 500     // max events
  }
}
\`\`\`

### 3. Key-Based Rate Limiting

Rate limit by specific attributes:

- **By Release**: Limit events from specific releases
- **By User**: Prevent single users from consuming quota
- **By Transaction**: Control high-volume transactions

## Configuration Examples

### SDK Configuration

Configure client-side sampling to reduce events before they're sent:

\`\`\`javascript
Sentry.init({
  dsn: "your-dsn",
  tracesSampleRate: 0.1,  // Sample 10% of transactions
  beforeSend(event) {
    // Custom filtering logic
    if (event.exception?.values?.[0]?.value?.includes("NetworkError")) {
      return null;  // Drop network errors
    }
    return event;
  }
});
\`\`\`

### Inbound Filters

Use Sentry's inbound filters to drop events server-side:

1. Go to **Project Settings** → **Inbound Filters**
2. Enable filters for:
   - Legacy browsers
   - Web crawlers
   - Specific error messages
   - IP addresses

### Spike Protection

Enable spike protection to automatically limit events during traffic spikes:

\`\`\`python
# Project settings
spike_protection = {
  "enabled": True,
  "max_events_per_hour": 10000,
  "detection_window": 300  # 5 minutes
}
\`\`\`

## Best Practices

1. **Start Conservative**: Begin with lower limits and increase as needed
2. **Monitor Usage**: Regularly review your quota consumption
3. **Use Sampling**: Implement transaction sampling for high-volume apps
4. **Filter Noise**: Drop known low-value events at the SDK level
5. **Set Alerts**: Configure notifications for quota thresholds

## Rate Limit Headers

Sentry returns rate limit information in response headers:

\`\`\`
X-Sentry-Rate-Limit: 60
X-Sentry-Rate-Limit-Remaining: 42
X-Sentry-Rate-Limit-Reset: 1634567890
\`\`\`

## Quota Management

### Viewing Quota Usage

1. Navigate to **Settings** → **Subscription**
2. View usage by:
   - Project
   - Event type
   - Time period

### On-Demand Budgets

Purchase additional events when approaching limits:

\`\`\`bash
# Via API
curl -X POST https://sentry.io/api/0/organizations/{org}/quotas/ \\
  -H 'Authorization: Bearer <token>' \\
  -d '{"events": 100000}'
\`\`\`

## Troubleshooting

### Events Being Dropped?

Check:
1. Organization and project rate limits
2. Spike protection status
3. SDK sampling configuration
4. Inbound filter settings

### Rate Limit Errors

If you see 429 errors:
- Review your rate limit configuration
- Implement exponential backoff
- Consider event buffering

## Related Documentation

- [SDK Configuration Guide](/platforms/javascript/configuration)
- [Quotas and Billing](/product/quotas)
- [Filtering Events](/product/data-management/filtering)`,
      {
        headers: {
          "Content-Type": "text/markdown",
        },
      },
    );
  }),
  http.get(
    "https://docs.sentry.io/product/accounts/quotas/spike-protection.md",
    () => {
      return new HttpResponse(
        `# Spike Protection

Spike protection prevents sudden spikes in event volume from consuming your entire quota.

## How it works

When Sentry detects an abnormal spike in events, it automatically activates spike protection...`,
        {
          headers: {
            "Content-Type": "text/markdown",
          },
        },
      );
    },
  ),
  // Catch-all for other doc paths - return 404
  http.get("https://docs.sentry.io/*.md", () => {
    return new HttpResponse(null, { status: 404 });
  }),
];

/**
 * Configured MSW server instance with all Sentry API mock handlers.
 *
 * Ready-to-use mock server for testing and development. Includes all endpoints
 * with realistic data, parameter validation, and error scenarios.
 *
 * @example Test Setup
 * ```typescript
 * import { mswServer } from "@sentry/mcp-server-mocks";
 *
 * beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
 * afterEach(() => mswServer.resetHandlers());
 * afterAll(() => mswServer.close());
 * ```
 *
 * @example Development Usage
 * ```typescript
 * import { mswServer } from "@sentry/mcp-server-mocks";
 *
 * // Start intercepting requests
 * mswServer.listen();
 *
 * // Your MCP server will now use mock responses
 * const apiService = new SentryApiService({ host: "sentry.io" });
 * const orgs = await apiService.listOrganizations();
 * console.log(orgs); // Returns mock organization data
 * ```
 *
 * @note User Data Endpoint Restrictions
 * The following endpoints are configured with `controlOnly: true` to work ONLY
 * with the main host (sentry.io) and will NOT respond to requests from
 * region-specific hosts (us.sentry.io, de.sentry.io):
 * - `/api/0/auth/` (whoami endpoint)
 * - `/api/0/users/me/regions/` (find_organizations endpoint)
 *
 * This matches the real Sentry API behavior where user data must always be queried
 * from the main API server.
 */
export const mswServer = setupServer(
  ...restHandlers,
  ...searchHandlers,
  ...docsHandlers,
);

// Export fixtures for use in tests
export {
  autofixStateFixture,
  traceMetaFixture,
  traceMetaWithNullsFixture,
  performanceEventFixture,
  traceFixture,
  traceMixedFixture,
  traceEventFixture,
  flamegraphFixture,
};

// Export fixture factories
export {
  createDefaultEvent,
  createGenericEvent,
  createUnknownEvent,
  createPerformanceEvent,
  createPerformanceIssue,
  createRegressedIssue,
  createUnsupportedIssue,
  createCspIssue,
  createCspEvent,
  createFeedbackIssue,
} from "./fixtures";

// Export utilities for creating mock servers
export { setupMockServer, startMockServer } from "./utils";
