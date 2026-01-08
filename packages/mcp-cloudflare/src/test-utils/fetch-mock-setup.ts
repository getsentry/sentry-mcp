/**
 * fetchMock setup for Cloudflare Workers tests
 *
 * Uses undici MockAgent via cloudflare:test to mock Sentry API responses.
 * This replaces MSW for tests that need to run in the workerd runtime.
 */
import { fetchMock } from "cloudflare:test";
import {
  organizationFixture,
  releaseFixture,
  clientKeyFixture,
  userFixture,
  eventsErrorsFixture,
  eventsErrorsEmptyFixture,
  eventsSpansFixture,
  eventsSpansEmptyFixture,
  issueFixture,
  issueFixture2,
  eventsFixture,
  projectFixture,
  teamFixture,
  tagsFixture,
  traceMetaFixture,
  traceFixture,
  performanceEventFixture,
  autofixStateFixture,
  traceItemsAttributesSpansStringFixture,
  traceItemsAttributesSpansNumberFixture,
  traceItemsAttributesLogsStringFixture,
  traceItemsAttributesLogsNumberFixture,
} from "@sentry/mcp-server-mocks/payloads";

// Sentry hosts to mock
const SENTRY_HOSTS = ["https://sentry.io", "https://us.sentry.io"];

// Standard JSON response headers
const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * Set up fetchMock for Sentry API mocking in Cloudflare Workers tests.
 *
 * IMPORTANT: undici MockAgent matches interceptors in registration order
 * (first match wins). Always register specific path handlers BEFORE
 * general pattern handlers to ensure correct matching.
 *
 * Usage: Call setupFetchMock() in beforeEach() and resetFetchMock() in afterEach()
 * to ensure clean mock state between tests. Using beforeEach (not beforeAll)
 * prevents test pollution since fetchMock.deactivate() clears all interceptors.
 */
export function setupFetchMock() {
  fetchMock.activate();
  fetchMock.disableNetConnect();

  for (const host of SENTRY_HOSTS) {
    const pool = fetchMock.get(host);

    // ===== Auth Endpoints (control only - sentry.io only) =====
    if (host === "https://sentry.io") {
      pool
        .intercept({ path: "/api/0/auth/" })
        .reply(200, userFixture, { headers: JSON_HEADERS })
        .persist();

      pool
        .intercept({ path: "/api/0/users/me/regions/" })
        .reply(
          200,
          { regions: [{ name: "us", url: "https://us.sentry.io" }] },
          { headers: JSON_HEADERS },
        )
        .persist();
    }

    // ===== Organizations =====
    pool
      .intercept({ path: "/api/0/organizations/" })
      .reply(200, [organizationFixture], { headers: JSON_HEADERS })
      .persist();

    pool
      .intercept({ path: "/api/0/organizations/sentry-mcp-evals/" })
      .reply(200, organizationFixture, { headers: JSON_HEADERS })
      .persist();

    pool
      .intercept({ path: "/api/0/organizations/nonexistent-org/" })
      .reply(
        404,
        { detail: "The requested resource does not exist" },
        { headers: JSON_HEADERS },
      )
      .persist();

    // ===== Teams =====
    pool
      .intercept({ path: "/api/0/organizations/sentry-mcp-evals/teams/" })
      .reply(200, [teamFixture], { headers: JSON_HEADERS })
      .persist();

    pool
      .intercept({
        path: "/api/0/organizations/sentry-mcp-evals/teams/",
        method: "POST",
      })
      .reply(
        201,
        {
          ...teamFixture,
          id: "4509109078196224",
          dateCreated: "2025-04-07T00:05:48.196710Z",
        },
        { headers: JSON_HEADERS },
      )
      .persist();

    // ===== Projects =====
    pool
      .intercept({ path: "/api/0/organizations/sentry-mcp-evals/projects/" })
      .reply(200, [{ ...projectFixture, id: "4509106749636608" }], {
        headers: JSON_HEADERS,
      })
      .persist();

    pool
      .intercept({
        path: "/api/0/teams/sentry-mcp-evals/the-goats/projects/",
        method: "POST",
      })
      .reply(200, projectFixture, { headers: JSON_HEADERS })
      .persist();

    pool
      .intercept({ path: "/api/0/projects/sentry-mcp-evals/cloudflare-mcp/" })
      .reply(200, projectFixture, { headers: JSON_HEADERS })
      .persist();

    pool
      .intercept({
        path: "/api/0/projects/sentry-mcp-evals/cloudflare-mcp/",
        method: "PUT",
      })
      .reply(200, projectFixture, { headers: JSON_HEADERS })
      .persist();

    pool
      .intercept({
        path: "/api/0/projects/sentry-mcp-evals/nonexistent-project/",
      })
      .reply(
        404,
        { detail: "The requested resource does not exist" },
        { headers: JSON_HEADERS },
      )
      .persist();

    // ===== Client Keys =====
    pool
      .intercept({
        path: "/api/0/projects/sentry-mcp-evals/cloudflare-mcp/keys/",
        method: "POST",
      })
      .reply(200, clientKeyFixture, { headers: JSON_HEADERS })
      .persist();

    pool
      .intercept({
        path: "/api/0/projects/sentry-mcp-evals/cloudflare-mcp/keys/",
      })
      .reply(200, [clientKeyFixture], { headers: JSON_HEADERS })
      .persist();

    // ===== Issues =====
    // IMPORTANT: Specific handlers must be registered BEFORE general patterns
    // because undici MockAgent matches in registration order (first match wins).

    // Specific issue details (must come first)
    pool
      .intercept({
        path: "/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
      })
      .reply(200, issueFixture, { headers: JSON_HEADERS })
      .persist();

    pool
      .intercept({
        path: "/api/0/organizations/sentry-mcp-evals/issues/6507376925/",
      })
      .reply(200, issueFixture, { headers: JSON_HEADERS })
      .persist();

    pool
      .intercept({
        path: "/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-42/",
      })
      .reply(200, issueFixture2, { headers: JSON_HEADERS })
      .persist();

    pool
      .intercept({
        path: "/api/0/organizations/sentry-mcp-evals/issues/6507376926/",
      })
      .reply(200, issueFixture2, { headers: JSON_HEADERS })
      .persist();

    // Issue updates (PUT) - specific handlers
    pool
      .intercept({
        path: "/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
        method: "PUT",
      })
      .reply(200, issueFixture, { headers: JSON_HEADERS })
      .persist();

    pool
      .intercept({
        path: "/api/0/organizations/sentry-mcp-evals/issues/6507376925/",
        method: "PUT",
      })
      .reply(200, issueFixture, { headers: JSON_HEADERS })
      .persist();

    // Project-scoped issues
    pool
      .intercept({ path: "/api/0/projects/sentry-mcp-evals/foobar/issues/" })
      .reply(200, [], { headers: JSON_HEADERS })
      .persist();

    pool
      .intercept({
        path: (p: string) =>
          p.startsWith(
            "/api/0/projects/sentry-mcp-evals/cloudflare-mcp/issues/",
          ),
      })
      .reply(200, [issueFixture2, issueFixture], { headers: JSON_HEADERS })
      .persist();

    // Org-scoped issues (general catch-all - must come AFTER specific handlers)
    pool
      .intercept({
        path: (p: string) =>
          p.startsWith("/api/0/organizations/sentry-mcp-evals/issues/"),
      })
      .reply(200, [issueFixture2, issueFixture], { headers: JSON_HEADERS })
      .persist();

    // ===== Issue Events =====
    // IMPORTANT: Specific handlers must come before general patterns

    // Performance issue events - specific handler
    pool
      .intercept({
        path: "/api/0/organizations/sentry-mcp-evals/issues/PERF-N1-001/events/latest/",
      })
      .reply(200, performanceEventFixture, { headers: JSON_HEADERS })
      .persist();

    // General events - catch-all for remaining
    pool
      .intercept({
        path: (p: string) =>
          p.includes("/events/7ca573c0f4814912aaa9bdc77d1a7d51") ||
          p.includes("/events/latest"),
      })
      .reply(200, eventsFixture, { headers: JSON_HEADERS })
      .persist();

    // ===== Traces =====
    pool
      .intercept({
        path: "/api/0/organizations/sentry-mcp-evals/trace-meta/a4d1aae7216b47ff8117cf4e09ce9d0a/",
      })
      .reply(200, traceMetaFixture, { headers: JSON_HEADERS })
      .persist();

    pool
      .intercept({
        path: "/api/0/organizations/sentry-mcp-evals/trace/a4d1aae7216b47ff8117cf4e09ce9d0a/",
      })
      .reply(200, traceFixture, { headers: JSON_HEADERS })
      .persist();

    // ===== Releases =====
    pool
      .intercept({ path: "/api/0/organizations/sentry-mcp-evals/releases/" })
      .reply(200, [releaseFixture], { headers: JSON_HEADERS })
      .persist();

    pool
      .intercept({
        path: "/api/0/projects/sentry-mcp-evals/cloudflare-mcp/releases/",
      })
      .reply(200, [releaseFixture], { headers: JSON_HEADERS })
      .persist();

    // ===== Tags =====
    pool
      .intercept({ path: "/api/0/organizations/sentry-mcp-evals/tags/" })
      .reply(200, tagsFixture, { headers: JSON_HEADERS })
      .persist();

    // ===== Trace Items Attributes =====
    pool
      .intercept({
        path: (p: string) =>
          p.startsWith(
            "/api/0/organizations/sentry-mcp-evals/trace-items/attributes/",
          ),
      })
      .reply((req) => {
        const url = new URL(req.path, "https://sentry.io");
        const itemType = url.searchParams.get("itemType");
        const attributeType = url.searchParams.get("attributeType");

        if (!itemType || !attributeType) {
          return {
            statusCode: 400,
            data: { detail: "Missing parameters" },
            responseOptions: { headers: JSON_HEADERS },
          };
        }

        const normalizedItemType = itemType === "spans" ? "span" : itemType;

        if (normalizedItemType === "span") {
          return {
            statusCode: 200,
            data:
              attributeType === "string"
                ? traceItemsAttributesSpansStringFixture
                : traceItemsAttributesSpansNumberFixture,
            responseOptions: { headers: JSON_HEADERS },
          };
        }

        if (normalizedItemType === "logs") {
          return {
            statusCode: 200,
            data:
              attributeType === "string"
                ? traceItemsAttributesLogsStringFixture
                : traceItemsAttributesLogsNumberFixture,
            responseOptions: { headers: JSON_HEADERS },
          };
        }

        return {
          statusCode: 400,
          data: { detail: "Invalid itemType" },
          responseOptions: { headers: JSON_HEADERS },
        };
      })
      .persist();

    // ===== Events Search (for search_events) =====
    pool
      .intercept({
        path: (p: string) =>
          p.startsWith("/api/0/organizations/sentry-mcp-evals/events/"),
      })
      .reply((req) => {
        const url = new URL(req.path, "https://sentry.io");
        const dataset = url.searchParams.get("dataset");
        const query = url.searchParams.get("query") || "";

        if (dataset === "spans") {
          if (query !== "is_transaction:true") {
            return {
              statusCode: 200,
              data: eventsSpansEmptyFixture,
              responseOptions: { headers: JSON_HEADERS },
            };
          }
          return {
            statusCode: 200,
            data: eventsSpansFixture,
            responseOptions: { headers: JSON_HEADERS },
          };
        }

        if (dataset === "errors") {
          // Return empty for queries that don't match expected patterns
          const validQueries = [
            "",
            "error.handled:false",
            "error.unhandled:true",
            "error.handled:false is:unresolved",
            "error.unhandled:true is:unresolved",
            "is:unresolved project:cloudflare-mcp",
            "project:cloudflare-mcp",
            "user.email:david@sentry.io",
          ];
          const sortedQuery = query.split(" ").sort().join(" ");
          if (!validQueries.includes(sortedQuery)) {
            return {
              statusCode: 200,
              data: eventsErrorsEmptyFixture,
              responseOptions: { headers: JSON_HEADERS },
            };
          }
          return {
            statusCode: 200,
            data: eventsErrorsFixture,
            responseOptions: { headers: JSON_HEADERS },
          };
        }

        return {
          statusCode: 400,
          data: "Invalid dataset",
          responseOptions: { headers: JSON_HEADERS },
        };
      })
      .persist();

    // ===== Autofix =====
    pool
      .intercept({
        path: "/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/autofix/",
      })
      .reply(200, { autofix: null }, { headers: JSON_HEADERS })
      .persist();

    pool
      .intercept({
        path: "/api/0/organizations/sentry-mcp-evals/issues/PEATED-A8/autofix/",
      })
      .reply(200, autofixStateFixture, { headers: JSON_HEADERS })
      .persist();
  }
}

/**
 * Reset fetchMock state between tests
 */
export function resetFetchMock() {
  // assertNoPendingInterceptors can be called but may throw if there are unused mocks
  // We reset silently for flexibility in tests that don't use all endpoints
  fetchMock.deactivate();
}
