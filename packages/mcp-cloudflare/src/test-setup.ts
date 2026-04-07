/**
 * Test setup for Cloudflare Workers tests.
 *
 * Uses fetchMock from cloudflare:test to mock Sentry API responses.
 * This runs in the workerd runtime, not Node.js.
 */
import "urlpattern-polyfill";
import { afterEach, beforeEach } from "vitest";

beforeEach(async () => {
  const { setupFetchMock } = await import("./test-utils/fetch-mock-setup");
  setupFetchMock();
});

afterEach(async () => {
  const { resetFetchMock } = await import("./test-utils/fetch-mock-setup");
  resetFetchMock();
});
