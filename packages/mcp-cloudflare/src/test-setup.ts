/**
 * Test setup for Cloudflare Workers tests.
 *
 * Uses fetchMock from cloudflare:test to mock Sentry API responses.
 * This runs in the workerd runtime, not Node.js.
 */
import "urlpattern-polyfill";
import { setupFetchMock, resetFetchMock } from "./test-utils/fetch-mock-setup";
import { afterEach, beforeEach } from "vitest";

beforeEach(() => {
  setupFetchMock();
});

afterEach(() => {
  resetFetchMock();
});
