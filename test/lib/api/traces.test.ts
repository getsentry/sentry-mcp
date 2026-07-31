/**
 * Tests for the traces API helpers (listTransactions, listSpans).
 *
 * Verifies URL construction, query parameter encoding, schema validation,
 * pagination cursor extraction, and auto-pagination across multiple pages.
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  fetchMultiSpanDetails,
  getSpanDetails,
  listSpans,
  listTransactions,
} from "../../../src/lib/api/traces.js";
import { mockFetch, useTestConfigDir } from "../../helpers.js";

// ---------------------------------------------------------------------------
// listTransactions
// ---------------------------------------------------------------------------

describe("listTransactions", () => {
  useTestConfigDir("traces-txn-test-");

  let originalFetch: typeof globalThis.fetch;
  let capturedUrl = "";
  let capturedMethod = "";

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    capturedUrl = "";
    capturedMethod = "";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockOk(body: unknown, headers: Record<string, string> = {}) {
    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input!, init);
      capturedUrl = req.url;
      capturedMethod = req.method;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json", ...headers },
      });
    });
  }

  /**
   * Helper to mock sequential fetch responses for multi-page tests.
   * Each call to fetch returns the next response in the queue.
   */
  function mockSequential(
    responses: Array<{ body: unknown; headers?: Record<string, string> }>
  ): { getCapturedUrls: () => string[] } {
    const capturedUrls: string[] = [];
    let callIndex = 0;

    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input!, init);
      capturedUrls.push(req.url);

      const resp = responses[callIndex]!;
      callIndex += 1;

      return new Response(JSON.stringify(resp.body), {
        status: 200,
        headers: { "Content-Type": "application/json", ...resp.headers },
      });
    });

    return { getCapturedUrls: () => capturedUrls };
  }

  const TX_META = {
    fields: {
      trace: "string",
      id: "string",
      transaction: "string",
      timestamp: "date",
      "transaction.duration": "duration",
      project: "string",
    },
  };

  /** Generate N rows of fake transaction data */
  function makeTxnRows(n: number): Record<string, string | number>[] {
    return Array.from({ length: n }, (_, i) => ({
      trace: `trace-${i}`,
      id: `id-${i}`,
      transaction: `/api/endpoint-${i}`,
      timestamp: "2024-01-15T00:00:00Z",
      "transaction.duration": 100 + i,
      project: "my-project",
    }));
  }

  test("hits /organizations/{org}/events/ with GET", async () => {
    mockOk({ data: [], meta: TX_META });

    await listTransactions("my-org", "my-project");

    expect(capturedMethod).toBe("GET");
    expect(capturedUrl).toContain("/api/0/organizations/my-org/events/");
  });

  test("sends dataset=transactions", async () => {
    mockOk({ data: [], meta: TX_META });

    await listTransactions("my-org", "my-project");

    expect(capturedUrl).toContain("dataset=transactions");
  });

  test("passes per_page capped at 100 even when limit is higher", async () => {
    // With limit > 100, the first page should still request per_page=100
    mockSequential([
      {
        body: { data: makeTxnRows(100), meta: TX_META },
        headers: {
          Link: `<https://us.sentry.io/api/0/next/>; rel="next"; results="true"; cursor="0:100:0"`,
        },
      },
      {
        body: { data: makeTxnRows(50), meta: TX_META },
        headers: {
          Link: `<https://us.sentry.io/api/0/next/>; rel="next"; results="false"; cursor=""`,
        },
      },
    ]);

    await listTransactions("my-org", "my-project", { limit: 150 });

    // Both pages should use per_page=100
    // (the second page still uses API_MAX_PER_PAGE since limit > 100)
  });

  test("sends sort=-timestamp by default", async () => {
    mockOk({ data: [], meta: TX_META });

    await listTransactions("my-org", "my-project");

    expect(capturedUrl).toContain(`sort=${encodeURIComponent("-timestamp")}`);
  });

  test('sends sort=-transaction.duration for sort="duration"', async () => {
    mockOk({ data: [], meta: TX_META });

    await listTransactions("my-org", "my-project", { sort: "duration" });

    expect(decodeURIComponent(capturedUrl)).toContain(
      "sort=-transaction.duration"
    );
  });

  test("passes cursor when provided", async () => {
    mockOk({ data: [], meta: TX_META });

    await listTransactions("my-org", "my-project", { cursor: "0:50:0" });

    expect(capturedUrl).toContain(`cursor=${encodeURIComponent("0:50:0")}`);
  });

  test("uses statsPeriod when no absolute range provided", async () => {
    mockOk({ data: [], meta: TX_META });

    await listTransactions("my-org", "my-project", { statsPeriod: "1h" });

    expect(capturedUrl).toContain("statsPeriod=1h");
    expect(capturedUrl).not.toContain("start=");
    expect(capturedUrl).not.toContain("end=");
  });

  test("defaults statsPeriod to 7d when not provided", async () => {
    mockOk({ data: [], meta: TX_META });

    await listTransactions("my-org", "my-project");

    expect(capturedUrl).toContain("statsPeriod=7d");
  });

  test("suppresses statsPeriod when start/end are present", async () => {
    mockOk({ data: [], meta: TX_META });

    await listTransactions("my-org", "my-project", {
      start: "2024-01-15T00:00:00Z",
      end: "2024-01-16T00:00:00Z",
      statsPeriod: "7d",
    });

    expect(capturedUrl).toContain(
      `start=${encodeURIComponent("2024-01-15T00:00:00Z")}`
    );
    expect(capturedUrl).toContain(
      `end=${encodeURIComponent("2024-01-16T00:00:00Z")}`
    );
    expect(capturedUrl).not.toContain("statsPeriod=");
  });

  test("auto-paginates when limit > 100", async () => {
    const { getCapturedUrls } = mockSequential([
      {
        body: { data: makeTxnRows(100), meta: TX_META },
        headers: {
          Link: `<https://us.sentry.io/api/0/next/>; rel="next"; results="true"; cursor="0:100:0"`,
        },
      },
      {
        body: { data: makeTxnRows(50), meta: TX_META },
        headers: {
          Link: `<https://us.sentry.io/api/0/next/>; rel="next"; results="false"; cursor=""`,
        },
      },
    ]);

    const result = await listTransactions("my-org", "my-project", {
      limit: 150,
    });

    expect(result.data).toHaveLength(150);
    expect(result.nextCursor).toBeUndefined();
    expect(getCapturedUrls()).toHaveLength(2);
  });

  test("trims results and drops nextCursor when overshoot", async () => {
    mockSequential([
      {
        body: { data: makeTxnRows(100), meta: TX_META },
        headers: {
          Link: `<https://us.sentry.io/api/0/next/>; rel="next"; results="true"; cursor="0:100:0"`,
        },
      },
      {
        body: { data: makeTxnRows(100), meta: TX_META },
        headers: {
          Link: `<https://us.sentry.io/api/0/next/>; rel="next"; results="true"; cursor="0:200:0"`,
        },
      },
    ]);

    const result = await listTransactions("my-org", "my-project", {
      limit: 120,
    });

    expect(result.data).toHaveLength(120);
    expect(result.nextCursor).toBeUndefined();
  });

  test("single-page fast path for limit <= 100", async () => {
    const { getCapturedUrls } = mockSequential([
      {
        body: { data: makeTxnRows(50), meta: TX_META },
        headers: {
          Link: `<https://us.sentry.io/api/0/next/>; rel="next"; results="false"; cursor=""`,
        },
      },
    ]);

    const result = await listTransactions("my-org", "my-project", {
      limit: 50,
    });

    expect(result.data).toHaveLength(50);
    expect(getCapturedUrls()).toHaveLength(1);
    expect(getCapturedUrls()[0]).toContain("per_page=50");
  });

  test("non-numeric project slug goes in query as project:slug", async () => {
    mockOk({ data: [], meta: TX_META });

    await listTransactions("my-org", "my-project");

    expect(decodeURIComponent(capturedUrl)).toContain(
      "query=project:my-project"
    );
    // Should NOT appear as a separate project= param
    expect(capturedUrl).not.toMatch(/[?&]project=my-project/);
  });

  test("numeric project ID goes as project param", async () => {
    mockOk({ data: [], meta: TX_META });

    await listTransactions("my-org", "12345");

    expect(capturedUrl).toContain("project=12345");
    // Should NOT appear as project:12345 in the query string
    expect(decodeURIComponent(capturedUrl)).not.toContain("project:12345");
  });

  test("returns nextCursor from Link header", async () => {
    const cursor = "0:10:0";
    mockOk(
      { data: makeTxnRows(10), meta: TX_META },
      {
        Link: `<https://us.sentry.io/api/0/next/>; rel="next"; results="true"; cursor="${cursor}"`,
      }
    );

    const result = await listTransactions("my-org", "my-project", {
      limit: 10,
    });

    expect(result.nextCursor).toBe(cursor);
  });

  test("returns undefined nextCursor when results=false", async () => {
    mockOk(
      { data: [], meta: TX_META },
      {
        Link: `<https://us.sentry.io/api/0/next/>; rel="next"; results="false"; cursor=""`,
      }
    );

    const result = await listTransactions("my-org", "my-project");

    expect(result.nextCursor).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// listSpans
// ---------------------------------------------------------------------------

describe("listSpans", () => {
  useTestConfigDir("traces-span-test-");

  let originalFetch: typeof globalThis.fetch;
  let capturedUrl = "";
  let capturedMethod = "";

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    capturedUrl = "";
    capturedMethod = "";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockOk(body: unknown, headers: Record<string, string> = {}) {
    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input!, init);
      capturedUrl = req.url;
      capturedMethod = req.method;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json", ...headers },
      });
    });
  }

  function mockSequential(
    responses: Array<{ body: unknown; headers?: Record<string, string> }>
  ): { getCapturedUrls: () => string[] } {
    const capturedUrls: string[] = [];
    let callIndex = 0;

    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input!, init);
      capturedUrls.push(req.url);

      const resp = responses[callIndex]!;
      callIndex += 1;

      return new Response(JSON.stringify(resp.body), {
        status: 200,
        headers: { "Content-Type": "application/json", ...resp.headers },
      });
    });

    return { getCapturedUrls: () => capturedUrls };
  }

  const SPAN_META = {
    fields: {
      id: "string",
      parent_span: "string",
      "span.op": "string",
      description: "string",
      "span.duration": "duration",
      timestamp: "date",
      project: "string",
      transaction: "string",
      trace: "string",
    },
  };

  /** Generate N rows of fake span data */
  function makeSpanRows(n: number): Record<string, string | number>[] {
    return Array.from({ length: n }, (_, i) => ({
      id: `span-${i}`,
      parent_span: `parent-${i}`,
      "span.op": "http.client",
      description: `GET /api/endpoint-${i}`,
      "span.duration": 50 + i,
      timestamp: "2024-01-15T00:00:00Z",
      project: "my-project",
      transaction: "/api/foo",
      trace: `trace-${i}`,
    }));
  }

  test("hits /organizations/{org}/events/ with GET", async () => {
    mockOk({ data: [], meta: SPAN_META });

    await listSpans("my-org", "my-project");

    expect(capturedMethod).toBe("GET");
    expect(capturedUrl).toContain("/api/0/organizations/my-org/events/");
  });

  test("sends dataset=spans", async () => {
    mockOk({ data: [], meta: SPAN_META });

    await listSpans("my-org", "my-project");

    expect(capturedUrl).toContain("dataset=spans");
  });

  test("passes per_page capped at 100 when limit is higher", async () => {
    const { getCapturedUrls } = mockSequential([
      {
        body: { data: makeSpanRows(100), meta: SPAN_META },
        headers: {
          Link: `<https://us.sentry.io/api/0/next/>; rel="next"; results="true"; cursor="0:100:0"`,
        },
      },
      {
        body: { data: makeSpanRows(50), meta: SPAN_META },
        headers: {
          Link: `<https://us.sentry.io/api/0/next/>; rel="next"; results="false"; cursor=""`,
        },
      },
    ]);

    await listSpans("my-org", "my-project", { limit: 150 });

    // Both pages should use per_page=100
    expect(getCapturedUrls()[0]).toContain("per_page=100");
    expect(getCapturedUrls()[1]).toContain("per_page=100");
  });

  test("sends sort=-timestamp by default", async () => {
    mockOk({ data: [], meta: SPAN_META });

    await listSpans("my-org", "my-project");

    expect(capturedUrl).toContain(`sort=${encodeURIComponent("-timestamp")}`);
  });

  test('sends sort=-span.duration for sort="duration"', async () => {
    mockOk({ data: [], meta: SPAN_META });

    await listSpans("my-org", "my-project", { sort: "duration" });

    expect(decodeURIComponent(capturedUrl)).toContain("sort=-span.duration");
  });

  test("allProjects sends project=-1", async () => {
    mockOk({ data: [], meta: SPAN_META });

    await listSpans("my-org", "my-project", { allProjects: true });

    expect(capturedUrl).toContain("project=-1");
    // Should NOT have project:my-project in query
    expect(decodeURIComponent(capturedUrl)).not.toContain(
      "project%3Amy-project"
    );
  });

  test("auto-paginates when limit > 100", async () => {
    const { getCapturedUrls } = mockSequential([
      {
        body: { data: makeSpanRows(100), meta: SPAN_META },
        headers: {
          Link: `<https://us.sentry.io/api/0/next/>; rel="next"; results="true"; cursor="0:100:0"`,
        },
      },
      {
        body: { data: makeSpanRows(50), meta: SPAN_META },
        headers: {
          Link: `<https://us.sentry.io/api/0/next/>; rel="next"; results="false"; cursor=""`,
        },
      },
    ]);

    const result = await listSpans("my-org", "my-project", { limit: 150 });

    expect(result.data).toHaveLength(150);
    expect(result.nextCursor).toBeUndefined();
    expect(getCapturedUrls()).toHaveLength(2);
  });

  test("trims results when overshoot", async () => {
    mockSequential([
      {
        body: { data: makeSpanRows(100), meta: SPAN_META },
        headers: {
          Link: `<https://us.sentry.io/api/0/next/>; rel="next"; results="true"; cursor="0:100:0"`,
        },
      },
      {
        body: { data: makeSpanRows(100), meta: SPAN_META },
        headers: {
          Link: `<https://us.sentry.io/api/0/next/>; rel="next"; results="true"; cursor="0:200:0"`,
        },
      },
    ]);

    const result = await listSpans("my-org", "my-project", { limit: 120 });

    expect(result.data).toHaveLength(120);
    expect(result.nextCursor).toBeUndefined();
  });

  test("single-page fast path for limit <= 100", async () => {
    const { getCapturedUrls } = mockSequential([
      {
        body: { data: makeSpanRows(30), meta: SPAN_META },
        headers: {
          Link: `<https://us.sentry.io/api/0/next/>; rel="next"; results="false"; cursor=""`,
        },
      },
    ]);

    const result = await listSpans("my-org", "my-project", { limit: 30 });

    expect(result.data).toHaveLength(30);
    expect(getCapturedUrls()).toHaveLength(1);
    expect(getCapturedUrls()[0]).toContain("per_page=30");
  });

  test("passes extraFields when provided", async () => {
    mockOk({ data: [], meta: SPAN_META });

    await listSpans("my-org", "my-project", {
      extraFields: ["span.self_time", "span.category"],
    });

    const decoded = decodeURIComponent(capturedUrl);
    expect(decoded).toContain("field=span.self_time");
    expect(decoded).toContain("field=span.category");
    // Standard fields should still be present
    expect(decoded).toContain("field=id");
    expect(decoded).toContain("field=span.op");
  });

  test("non-numeric project slug goes in query as project:slug", async () => {
    mockOk({ data: [], meta: SPAN_META });

    await listSpans("my-org", "my-project");

    expect(capturedUrl).toContain(
      `query=${encodeURIComponent("project:my-project")}`
    );
    // Should NOT appear as a separate project= param with the slug value
    expect(capturedUrl).not.toMatch(/[?&]project=my-project/);
  });

  test("numeric project ID goes as project param", async () => {
    mockOk({ data: [], meta: SPAN_META });

    await listSpans("my-org", "12345");

    expect(capturedUrl).toContain("project=12345");
    expect(decodeURIComponent(capturedUrl)).not.toContain("project:12345");
  });

  test("uses statsPeriod when no absolute range provided", async () => {
    mockOk({ data: [], meta: SPAN_META });

    await listSpans("my-org", "my-project", { statsPeriod: "1h" });

    expect(capturedUrl).toContain("statsPeriod=1h");
    expect(capturedUrl).not.toContain("start=");
    expect(capturedUrl).not.toContain("end=");
  });

  test("defaults statsPeriod to 7d when not provided", async () => {
    mockOk({ data: [], meta: SPAN_META });

    await listSpans("my-org", "my-project");

    expect(capturedUrl).toContain("statsPeriod=7d");
  });

  test("suppresses statsPeriod when start/end are present", async () => {
    mockOk({ data: [], meta: SPAN_META });

    await listSpans("my-org", "my-project", {
      start: "2024-01-15T00:00:00Z",
      end: "2024-01-16T00:00:00Z",
      statsPeriod: "7d",
    });

    expect(capturedUrl).toContain(
      `start=${encodeURIComponent("2024-01-15T00:00:00Z")}`
    );
    expect(capturedUrl).toContain(
      `end=${encodeURIComponent("2024-01-16T00:00:00Z")}`
    );
    expect(capturedUrl).not.toContain("statsPeriod=");
  });

  test("passes cursor when provided", async () => {
    mockOk({ data: [], meta: SPAN_META });

    await listSpans("my-org", "my-project", { cursor: "0:50:0" });

    expect(capturedUrl).toContain(`cursor=${encodeURIComponent("0:50:0")}`);
  });

  test("returns nextCursor from Link header", async () => {
    const cursor = "0:10:0";
    mockOk(
      { data: makeSpanRows(10), meta: SPAN_META },
      {
        Link: `<https://us.sentry.io/api/0/next/>; rel="next"; results="true"; cursor="${cursor}"`,
      }
    );

    const result = await listSpans("my-org", "my-project", { limit: 10 });

    expect(result.nextCursor).toBe(cursor);
  });

  test("returns undefined nextCursor when results=false", async () => {
    mockOk(
      { data: [], meta: SPAN_META },
      {
        Link: `<https://us.sentry.io/api/0/next/>; rel="next"; results="false"; cursor=""`,
      }
    );

    const result = await listSpans("my-org", "my-project");

    expect(result.nextCursor).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getSpanDetails
// ---------------------------------------------------------------------------

describe("getSpanDetails", () => {
  useTestConfigDir("traces-span-details-test-");

  let originalFetch: typeof globalThis.fetch;
  let capturedUrl = "";
  let capturedParams: Record<string, string> = {};

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    capturedUrl = "";
    capturedParams = {};
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockOk(body: unknown) {
    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input!, init);
      capturedUrl = req.url;
      const url = new URL(capturedUrl);
      url.searchParams.forEach((v, k) => {
        capturedParams[k] = v;
      });
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
  }

  const DETAIL_RESPONSE = {
    itemId: "abc123",
    timestamp: "2026-01-01T00:00:00Z",
    attributes: [
      { name: "span.op", type: "str", value: "db.query" },
      { name: "user.id", type: "str", value: "u_42" },
    ],
  };

  test("calls trace-items endpoint with item_type=spans", async () => {
    mockOk(DETAIL_RESPONSE);

    await getSpanDetails("my-org", "my-project", "span-id-abc", "trace-id-xyz");

    expect(capturedUrl).toContain(
      "/projects/my-org/my-project/trace-items/span-id-abc/"
    );
    expect(capturedParams.item_type).toBe("spans");
    expect(capturedParams.trace_id).toBe("trace-id-xyz");
  });

  test("returns parsed attributes", async () => {
    mockOk(DETAIL_RESPONSE);

    const result = await getSpanDetails(
      "my-org",
      "my-project",
      "span-id-abc",
      "trace-id-xyz"
    );

    expect(result.itemId).toBe("abc123");
    expect(result.attributes).toHaveLength(2);
    expect(result.attributes[0]).toEqual({
      name: "span.op",
      type: "str",
      value: "db.query",
    });
  });
});

// ---------------------------------------------------------------------------
// fetchMultiSpanDetails
// ---------------------------------------------------------------------------

describe("fetchMultiSpanDetails", () => {
  useTestConfigDir("traces-multi-span-details-test-");

  let originalFetch: typeof globalThis.fetch;
  let requestedUrls: string[] = [];

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    requestedUrls = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockOk() {
    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input!, init);
      requestedUrls.push(req.url);
      return new Response(
        JSON.stringify({
          itemId: "x",
          timestamp: "2026-01-01T00:00:00Z",
          attributes: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
  }

  test("skips spans with no project slug instead of issuing a malformed request", async () => {
    mockOk();

    // fallbackProject is empty (org-scoped target) and the span has no
    // project_slug — a request here would produce /projects/my-org//trace-items/…
    const details = await fetchMultiSpanDetails(
      [{ span_id: "span-no-project" }],
      { org: "my-org", fallbackProject: "", traceId: "trace-xyz" }
    );

    expect(details.size).toBe(0);
    expect(requestedUrls).toHaveLength(0);
  });

  test("uses fallback project when a span has no project_slug", async () => {
    mockOk();

    await fetchMultiSpanDetails([{ span_id: "span-a" }], {
      org: "my-org",
      fallbackProject: "fallback-proj",
      traceId: "trace-xyz",
    });

    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]).toContain(
      "/projects/my-org/fallback-proj/trace-items/span-a/"
    );
  });

  test("does not skip other spans when one lacks a project slug", async () => {
    mockOk();

    const details = await fetchMultiSpanDetails(
      [
        { span_id: "span-no-project" },
        { span_id: "span-b", project_slug: "proj-b" },
      ],
      { org: "my-org", fallbackProject: "", traceId: "trace-xyz" }
    );

    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]).toContain(
      "/projects/my-org/proj-b/trace-items/span-b/"
    );
    expect(details.has("span-b")).toBe(true);
  });
});
