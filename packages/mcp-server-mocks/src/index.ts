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
import { docsHandlers, restHandlers, searchHandlers } from "./handlers.js";

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

// Export fixture factories
export {
  createCspEvent,
  createCspIssue,
  createDefaultEvent,
  createFeedbackIssue,
  createGenericEvent,
  createPerformanceEvent,
  createPerformanceIssue,
  createRegressedIssue,
  createUnknownEvent,
  createUnsupportedIssue,
} from "./fixtures";
// Export handlers for non-Node environments (e.g. Cloudflare Workers tests)
// Export fixtures for use in tests
export {
  autofixStateExplorerFixture,
  autofixStateFixture,
  clientKeyFixture,
  dashboardDetailsFixture,
  dashboardListFixture,
  docsHandlers,
  eventAttachmentsFixture,
  eventsErrorsEmptyFixture,
  eventsErrorsFixture,
  eventsFixture as eventFixture,
  eventsFixture,
  eventsSpansEmptyFixture,
  eventsSpansFixture,
  flamegraphFixture,
  issueFixture,
  issueNullCulpritFixture,
  organizationFixture,
  performanceEventFixture,
  profileChunkFixture,
  projectFixture,
  releaseFixture,
  replayDetailsFixture,
  replayRecordingSegmentsFixture,
  restHandlers,
  searchHandlers,
  tagsFixture,
  teamFixture,
  traceEventFixture,
  traceFixture,
  traceItemsAttributesLogsNumberFixture,
  traceItemsAttributesLogsStringFixture,
  traceItemsAttributesSpansNumberFixture,
  traceItemsAttributesSpansStringFixture,
  traceMetaFixture,
  traceMetaWithNullsFixture,
  traceMixedFixture,
  transactionProfileV1Fixture,
  transactionProfileV1MissingFunctionFixture,
  userFixture,
} from "./handlers.js";
// Export utilities for creating mock servers
export { setupMockServer, startMockServer } from "./utils";
