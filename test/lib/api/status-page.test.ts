import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { fetchSentryStatus } from "../../../src/lib/api/status-page.js";

const { customFetchMock } = vi.hoisted(() => ({ customFetchMock: vi.fn() }));
vi.mock("../../../src/lib/custom-ca.js", () => ({
  customFetch: customFetchMock,
}));

beforeEach(() => {
  customFetchMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("self-hosted URL probes /_health/ and returns operational (none) on 200", async () => {
  customFetchMock.mockResolvedValue(
    new Response("", { status: 200, statusText: "OK" })
  );

  const status = await fetchSentryStatus("https://example.com");

  expect(status.indicator).toBe("none");
  expect(status.url).toBe("https://example.com");

  const [calledUrl, calledInit] = customFetchMock.mock.calls[0] ?? [];
  expect(calledUrl).toBe("https://example.com/_health/?full=1");
  expect(calledInit).toHaveProperty("signal");
});

test("self-hosted URL reports major on non-2xx", async () => {
  customFetchMock.mockResolvedValue(
    new Response("", { status: 503, statusText: "Service Unavailable" })
  );

  const status = await fetchSentryStatus("https://self.sentry.local");

  expect(status.indicator).toBe("major");
  expect(status.description).toContain("Service Unavailable");
});

test("default status.sentry.io uses the Statuspage summary endpoint", async () => {
  customFetchMock.mockResolvedValue(
    Response.json({
      page: { url: "https://status.sentry.io" },
      status: { indicator: "none", description: "All Systems Operational" },
      components: [],
      incidents: [],
    })
  );

  const status = await fetchSentryStatus();

  expect(status.description).toBe("All Systems Operational");
  const [calledUrl] = customFetchMock.mock.calls[0] ?? [];
  expect(calledUrl).toBe("https://status.sentry.io/api/v2/summary.json");
});

test("custom Statuspage CNAME uses the summary endpoint", async () => {
  customFetchMock.mockResolvedValue(
    Response.json({
      page: { url: "https://status.acme.com" },
      status: { indicator: "minor", description: "Minor Service Outage" },
      components: [],
      incidents: [],
    })
  );

  const status = await fetchSentryStatus("https://status.acme.com");

  expect(status.indicator).toBe("minor");
  const [calledUrl] = customFetchMock.mock.calls[0] ?? [];
  expect(calledUrl).toBe("https://status.acme.com/api/v2/summary.json");
});
