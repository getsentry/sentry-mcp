/**
 * Tests for the authenticated fetch retry + timeout behavior — CLI-1D6
 * regression coverage.
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { setAuthToken } from "../../src/lib/db/auth.js";
import { TimeoutError } from "../../src/lib/errors.js";
import {
  getCachedResponse,
  storeCachedResponse,
} from "../../src/lib/response-cache.js";
import {
  __injectTimeoutOverrideForTests,
  __resolveRequestTimeoutMsForTests,
  getSdkConfig,
  resetAuthenticatedFetch,
} from "../../src/lib/sentry-client.js";
import {
  extractFetchUrl,
  mockFetch,
  useEnvSandbox,
  useTestConfigDir,
} from "../helpers.js";

useTestConfigDir("sentry-client-");

let originalFetch: typeof globalThis.fetch;
const REGION_URL = "https://us.sentry.io";

beforeEach(async () => {
  originalFetch = globalThis.fetch;
  // Non-expiring token — refreshToken() becomes a no-op.
  await setAuthToken("test-token");
  resetAuthenticatedFetch();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetAuthenticatedFetch();
});

function getAuthenticatedFetch(): typeof fetch {
  return getSdkConfig(REGION_URL).fetch as typeof fetch;
}

describe("401 replay", () => {
  useEnvSandbox(["SENTRY_CLIENT_ID"]);

  /** Answer resource requests with `statuses` in order while OAuth refresh succeeds. */
  async function mockRefreshableSession(statuses: number[]): Promise<string[]> {
    process.env.SENTRY_CLIENT_ID = "synthetic-client-id";
    await setAuthToken("stored-token", 3600, "synthetic-refresh-token");
    const urls: string[] = [];
    globalThis.fetch = mockFetch(async (input) => {
      const url = extractFetchUrl(input);
      urls.push(url);
      if (url.endsWith("/oauth/token/")) {
        return Response.json({
          access_token: "refreshed-token",
          token_type: "bearer",
          expires_in: 3600,
        });
      }
      return new Response("{}", { status: statuses.shift() ?? 200 });
    });
    return urls;
  }

  test("returns a 401 from the final attempt instead of replaying it", async () => {
    const urls = await mockRefreshableSession([503, 503, 401]);
    const response = await getAuthenticatedFetch()(
      `${REGION_URL}/api/0/organizations/`
    );
    expect(response.status).toBe(401);
    expect(urls.filter((url) => url.endsWith("/oauth/token/"))).toEqual([]);
  });

  test("retry false returns a 401 without refreshing the token", async () => {
    const urls = await mockRefreshableSession([401]);
    const url = `${REGION_URL}/api/0/issue-link/`;
    const fetchOnce = getSdkConfig(REGION_URL, { retry: false }).fetch;
    const response = await fetchOnce(url, { method: "POST" });
    expect(response.status).toBe(401);
    expect(urls).toEqual([url]);
  });
});

describe("per-request transport controls", () => {
  test("retry false sends a mutation once for transient HTTP and network failures", async () => {
    let callCount = 0;
    globalThis.fetch = mockFetch(async () => {
      callCount += 1;
      return new Response("provider unavailable", { status: 503 });
    });
    const fetchOnce = getSdkConfig(REGION_URL, { retry: false }).fetch;
    expect(
      (await fetchOnce(`${REGION_URL}/api/0/issue-link/`, { method: "POST" }))
        .status
    ).toBe(503);
    expect(callCount).toBe(1);

    const networkError = new TypeError(
      "connection reset after request body sent"
    );
    globalThis.fetch = mockFetch(async () => {
      callCount += 1;
      throw networkError;
    });
    await expect(
      fetchOnce(`${REGION_URL}/api/0/issue-link/`, { method: "POST" })
    ).rejects.toBe(networkError);
    expect(callCount).toBe(2);
  });

  test("no-store preflight bypasses both cache lookup and cache storage", async () => {
    const url = `${REGION_URL}/api/0/organizations/example/issues/1/external-issues/`;
    const headers = { Authorization: "Bearer test-token" };
    await storeCachedResponse(
      "GET",
      url,
      headers,
      Response.json(
        { source: "cached" },
        {
          headers: {
            "Cache-Control": "max-age=600",
            Date: new Date().toUTCString(),
          },
        }
      )
    );
    expect(
      await (await getCachedResponse("GET", url, headers))?.json()
    ).toEqual({ source: "cached" });
    let callCount = 0;
    globalThis.fetch = mockFetch(async (_input, init) => {
      callCount += 1;
      expect(init?.cache).toBe("no-store");
      return Response.json(
        { source: "fresh" },
        {
          headers: {
            "Cache-Control": "max-age=600",
            Date: new Date().toUTCString(),
          },
        }
      );
    });
    const freshFetch = getSdkConfig(REGION_URL, { cache: "no-store" }).fetch;
    expect(await (await freshFetch(url)).json()).toEqual({ source: "fresh" });
    expect(await (await freshFetch(url)).json()).toEqual({ source: "fresh" });
    expect(callCount).toBe(2);
    expect(
      await (await getCachedResponse("GET", url, headers))?.json()
    ).toEqual({ source: "cached" });
  });
});

describe("fetchWithRetry / buildAttemptFactory", () => {
  test("retries a POST with a string body without re-consuming the body", async () => {
    const marker = "__test_string_body__";
    const seen: string[] = [];
    let callCount = 0;

    globalThis.fetch = mockFetch(async (_input, init) => {
      callCount += 1;
      const body = init?.body;
      if (typeof body === "string") {
        seen.push(body);
      } else if (body) {
        seen.push(await new Response(body as BodyInit).text());
      } else {
        seen.push("<empty>");
      }
      if (callCount === 1) {
        return new Response("busy", { status: 503 });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const authFetch = getAuthenticatedFetch();
    const res = await authFetch(
      `${REGION_URL}/api/0/${marker}/organizations/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: "acme" }),
      }
    );

    expect(res.status).toBe(200);
    expect(callCount).toBe(2);
    expect(seen).toEqual([
      JSON.stringify({ slug: "acme" }),
      JSON.stringify({ slug: "acme" }),
    ]);
  });

  test("retries a POST built from a Request object without consuming its body", async () => {
    // SDK path: @sentry/api hands us a Request as the sole argument.
    // Pre-fix: attempt 2 saw a consumed body stream.
    const marker = "__test_request_body__";
    let callCount = 0;
    const seen: string[] = [];

    globalThis.fetch = mockFetch(async (input) => {
      callCount += 1;
      if (input instanceof Request) {
        seen.push(await input.clone().text());
      } else {
        seen.push("<non-request>");
      }
      if (callCount === 1) {
        return new Response("gateway", { status: 502 });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const payload = JSON.stringify({ stopping_point: "root_cause" });
    const request = new Request(`${REGION_URL}/api/0/${marker}/autofix/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });

    const authFetch = getAuthenticatedFetch();
    const res = await authFetch(request);

    expect(res.status).toBe(200);
    expect(callCount).toBe(2);
    expect(seen).toEqual([payload, payload]);
  });

  test("retries with a ReadableStream body by materializing once", async () => {
    // Streams are consumed on first read; without up-front materialization
    // attempt 2 would see an undefined body.
    const marker = "__test_stream_body__";
    let callCount = 0;
    const seen: string[] = [];

    globalThis.fetch = mockFetch(async (_input, init) => {
      callCount += 1;
      const body = init?.body;
      if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
        seen.push(new TextDecoder().decode(body as ArrayBuffer));
      } else if (typeof body === "string") {
        seen.push(body);
      } else if (body) {
        seen.push(await new Response(body as BodyInit).text());
      } else {
        seen.push("<empty>");
      }
      if (callCount === 1) {
        return new Response("", { status: 500 });
      }
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("streamed-body"));
        controller.close();
      },
    });

    const authFetch = getAuthenticatedFetch();
    // Node's fetch requires duplex: "half" for streamed bodies; Bun accepts
    // it as a no-op.
    const res = await authFetch(`${REGION_URL}/api/0/${marker}/streamed/`, {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex?: string });

    expect(res.status).toBe(200);
    expect(callCount).toBe(2);
    expect(seen).toEqual(["streamed-body", "streamed-body"]);
  });

  test("retries a FormData body without losing the multipart boundary", async () => {
    // Regression for a Cursor Bugbot finding: materializing FormData to
    // an ArrayBuffer drops the auto-negotiated
    // `Content-Type: multipart/form-data; boundary=...` header that
    // `fetch` derives from the FormData body. Sourcemap chunk upload
    // (src/lib/api/sourcemaps.ts) sends FormData through this path;
    // without correct handling even the first upload attempt fails.
    const marker = "__test_formdata_body__";
    let callCount = 0;
    const contentTypes: (string | null)[] = [];
    const bodies: string[] = [];

    globalThis.fetch = mockFetch(async (input, init) => {
      callCount += 1;
      const req = new Request(input as string, init);
      contentTypes.push(req.headers.get("content-type"));
      bodies.push(await req.text());
      if (callCount === 1) {
        return new Response("retry me", { status: 503 });
      }
      return new Response("", { status: 200 });
    });

    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array([1, 2, 3, 4])], {
        type: "application/octet-stream",
      }),
      "chunk.bin"
    );

    const authFetch = getAuthenticatedFetch();
    const res = await authFetch(`${REGION_URL}/api/0/${marker}/chunks/`, {
      method: "POST",
      body: form,
    });

    expect(res.status).toBe(200);
    expect(callCount).toBe(2);
    // Both attempts must carry a well-formed multipart Content-Type.
    // Bun picks a fresh boundary per serialization, so the two
    // headers differ — the invariant is that each attempt's
    // header+body is internally consistent, and that
    // Content-Type is never lost to a raw `application/octet-stream`
    // or missing header (the pre-fix failure mode).
    for (const ct of contentTypes) {
      expect(ct).toMatch(/^multipart\/form-data; boundary=.+/u);
    }
    // And both attempts carried the same FormData contents.
    for (const body of bodies) {
      expect(body).toContain('name="file"');
      expect(body).toContain("chunk.bin");
    }
  });
});

describe("fetchWithTimeout internal timeout classification", () => {
  test("surfaces TimeoutError on the last attempt when our own timeout fires", async () => {
    // Inject a tiny timeout so we don't wait 30 s for the default to fire.
    const marker = "___timeout-test___";
    const restore = __injectTimeoutOverrideForTests({
      pattern: new RegExp(`/${marker}/`),
      timeoutMs: 50,
    });

    try {
      let calls = 0;
      globalThis.fetch = mockFetch(async (_input, init) => {
        calls += 1;
        return await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error("no signal provided — test bug"));
            return;
          }
          if (signal.aborted) {
            reject(new DOMException("aborted", "AbortError"));
            return;
          }
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true }
          );
        });
      });

      const authFetch = getAuthenticatedFetch();
      let thrown: unknown;
      try {
        await authFetch(`${REGION_URL}/${marker}/`);
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(TimeoutError);
      expect((thrown as TimeoutError).message).toContain(
        "Request timed out after"
      );
      // MAX_RETRIES = 2 → attempts 0, 1, 2.
      expect(calls).toBe(3);
    } finally {
      restore();
    }
  });
});

describe("user abort passthrough", () => {
  test("external AbortSignal.abort() propagates the original AbortError", async () => {
    const marker = "__test_user_abort__";
    let fetchCalled = false;
    globalThis.fetch = mockFetch(async (_input, init) => {
      fetchCalled = true;
      return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(new DOMException("aborted", "AbortError"));
          return;
        }
        signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true }
        );
      });
    });

    const controller = new AbortController();
    const authFetch = getAuthenticatedFetch();
    const promise = authFetch(`${REGION_URL}/api/0/${marker}/organizations/`, {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 10);

    let thrown: unknown;
    try {
      await promise;
    } catch (err) {
      thrown = err;
    }

    expect(fetchCalled).toBe(true);
    // User aborts must propagate unchanged — neither a TimeoutError nor an
    // ApiError wrapper. The central error handler in app.ts depends on it.
    expect(thrown).toBeInstanceOf(DOMException);
    expect((thrown as DOMException).name).toBe("AbortError");
  });
});

describe("resolveTimeoutMs", () => {
  test("returns 120 000 ms for Seer /autofix/ POST paths", () => {
    expect(
      __resolveRequestTimeoutMsForTests(
        "https://us.sentry.io/api/0/organizations/acme/issues/1/autofix/"
      )
    ).toBe(120_000);
    expect(
      __resolveRequestTimeoutMsForTests(
        "https://us.sentry.io/api/0/organizations/acme/issues/1/autofix/?run_id=42"
      )
    ).toBe(120_000);
    expect(
      __resolveRequestTimeoutMsForTests(
        "https://us.sentry.io/api/0/organizations/acme/issues/1/autofix"
      )
    ).toBe(120_000);
  });

  test("returns the 30 000 ms default for non-overridden paths", () => {
    expect(
      __resolveRequestTimeoutMsForTests(
        "https://us.sentry.io/api/0/organizations/"
      )
    ).toBe(30_000);
    expect(
      __resolveRequestTimeoutMsForTests(
        "https://us.sentry.io/api/0/issues/1/events/"
      )
    ).toBe(30_000);
    // Substring-only matches must not inherit the override.
    expect(
      __resolveRequestTimeoutMsForTests(
        "https://us.sentry.io/api/0/autofixation-report/"
      )
    ).toBe(30_000);
  });
});
