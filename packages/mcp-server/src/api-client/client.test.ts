import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { SentryApiService } from "./client";
import { ConfigurationError } from "../errors";

describe("getIssueUrl", () => {
  it("should work with sentry.io", () => {
    const apiService = new SentryApiService({ host: "sentry.io" });
    const result = apiService.getIssueUrl("sentry-mcp", "123456");
    expect(result).toMatchInlineSnapshot(
      `"https://sentry-mcp.sentry.io/issues/123456"`,
    );
  });
  it("should work with self-hosted", () => {
    const apiService = new SentryApiService({ host: "sentry.example.com" });
    const result = apiService.getIssueUrl("sentry-mcp", "123456");
    expect(result).toMatchInlineSnapshot(
      `"https://sentry.example.com/organizations/sentry-mcp/issues/123456"`,
    );
  });
  it("should work with full URL including protocol", () => {
    const apiService = new SentryApiService({
      host: "sentry.example.com",
    });
    const result = apiService.getIssueUrl("sentry-mcp", "123456");
    expect(result).toMatchInlineSnapshot(
      `"https://sentry.example.com/organizations/sentry-mcp/issues/123456"`,
    );
  });
  it("should always use HTTPS protocol", () => {
    const apiService = new SentryApiService({
      host: "localhost:8000",
    });
    const result = apiService.getIssueUrl("sentry-mcp", "123456");
    expect(result).toMatchInlineSnapshot(
      `"https://localhost:8000/organizations/sentry-mcp/issues/123456"`,
    );
  });
});

describe("getTraceUrl", () => {
  it("should work with sentry.io", () => {
    const apiService = new SentryApiService({ host: "sentry.io" });
    const result = apiService.getTraceUrl(
      "sentry-mcp",
      "6a477f5b0f31ef7b6b9b5e1dea66c91d",
    );
    expect(result).toMatchInlineSnapshot(
      `"https://sentry-mcp.sentry.io/explore/traces/trace/6a477f5b0f31ef7b6b9b5e1dea66c91d"`,
    );
  });
  it("should work with self-hosted", () => {
    const apiService = new SentryApiService({ host: "sentry.example.com" });
    const result = apiService.getTraceUrl(
      "sentry-mcp",
      "6a477f5b0f31ef7b6b9b5e1dea66c91d",
    );
    expect(result).toMatchInlineSnapshot(
      `"https://sentry.example.com/organizations/sentry-mcp/explore/traces/trace/6a477f5b0f31ef7b6b9b5e1dea66c91d"`,
    );
  });
  it("should always use HTTPS protocol", () => {
    const apiService = new SentryApiService({
      host: "localhost:8000",
    });
    const result = apiService.getTraceUrl(
      "sentry-mcp",
      "6a477f5b0f31ef7b6b9b5e1dea66c91d",
    );
    expect(result).toMatchInlineSnapshot(
      `"https://localhost:8000/organizations/sentry-mcp/explore/traces/trace/6a477f5b0f31ef7b6b9b5e1dea66c91d"`,
    );
  });
});

describe("getEventsExplorerUrl", () => {
  it("should work with sentry.io", () => {
    const apiService = new SentryApiService({ host: "sentry.io" });
    const result = apiService.getEventsExplorerUrl(
      "sentry-mcp",
      "level:error AND message:timeout",
    );
    expect(result).toMatchInlineSnapshot(
      `"https://sentry-mcp.sentry.io/explore/traces/?query=level%3Aerror+AND+message%3Atimeout&statsPeriod=24h"`,
    );
  });
  it("should work with self-hosted", () => {
    const apiService = new SentryApiService({ host: "sentry.example.com" });
    const result = apiService.getEventsExplorerUrl(
      "sentry-mcp",
      "level:error AND message:timeout",
    );
    expect(result).toMatchInlineSnapshot(
      `"https://sentry.example.com/organizations/sentry-mcp/explore/traces/?query=level%3Aerror+AND+message%3Atimeout&statsPeriod=24h"`,
    );
  });
  it("should include project parameter when provided", () => {
    const apiService = new SentryApiService({ host: "sentry.io" });
    const result = apiService.getEventsExplorerUrl(
      "sentry-mcp",
      "level:error",
      "backend",
    );
    expect(result).toMatchInlineSnapshot(
      `"https://sentry-mcp.sentry.io/explore/traces/?query=level%3Aerror&project=backend&statsPeriod=24h"`,
    );
  });
  it("should properly encode special characters in query", () => {
    const apiService = new SentryApiService({ host: "sentry.io" });
    const result = apiService.getEventsExplorerUrl(
      "sentry-mcp",
      'message:"database timeout" AND level:error',
    );
    expect(result).toMatchInlineSnapshot(
      `"https://sentry-mcp.sentry.io/explore/traces/?query=message%3A%22database+timeout%22+AND+level%3Aerror&statsPeriod=24h"`,
    );
  });
  it("should always use HTTPS protocol", () => {
    const apiService = new SentryApiService({
      host: "localhost:8000",
    });
    const result = apiService.getEventsExplorerUrl("sentry-mcp", "level:error");
    expect(result).toMatchInlineSnapshot(
      `"https://localhost:8000/organizations/sentry-mcp/explore/traces/?query=level%3Aerror&statsPeriod=24h"`,
    );
  });
});

describe("network error handling", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should handle DNS errors with EAI_AGAIN", async () => {
    const dnsError = new Error("fetch failed");
    dnsError.cause = new Error("getaddrinfo EAI_AGAIN https");

    globalThis.fetch = vi.fn().mockRejectedValue(dnsError);

    const apiService = new SentryApiService({
      host: "sentry.io",
      accessToken: "test-token",
    });

    await expect(apiService.getAuthenticatedUser()).rejects.toThrow(
      /DNS temporarily unavailable/,
    );
  });

  it("should handle ENOTFOUND errors", async () => {
    const notFoundError = new Error("fetch failed");
    notFoundError.cause = new Error("getaddrinfo ENOTFOUND invalid.host");

    globalThis.fetch = vi.fn().mockRejectedValue(notFoundError);

    const apiService = new SentryApiService({
      host: "invalid.host",
      accessToken: "test-token",
    });

    await expect(apiService.getAuthenticatedUser()).rejects.toThrow(
      /Hostname not found/,
    );
  });

  it("should handle ECONNREFUSED errors", async () => {
    const refusedError = new Error("fetch failed");
    refusedError.cause = new Error("connect ECONNREFUSED 127.0.0.1:443");

    globalThis.fetch = vi.fn().mockRejectedValue(refusedError);

    const apiService = new SentryApiService({
      host: "localhost",
      accessToken: "test-token",
    });

    await expect(apiService.getAuthenticatedUser()).rejects.toThrow(
      /Connection refused/,
    );
  });

  it("should handle ETIMEDOUT errors", async () => {
    const timeoutError = new Error("fetch failed");
    timeoutError.cause = new Error("connect ETIMEDOUT 192.168.1.1:443");

    globalThis.fetch = vi.fn().mockRejectedValue(timeoutError);

    const apiService = new SentryApiService({
      host: "192.168.1.1",
      accessToken: "test-token",
    });

    await expect(apiService.getAuthenticatedUser()).rejects.toThrow(
      /Connection timed out/,
    );
  });

  it("should handle ECONNRESET errors", async () => {
    const resetError = new Error("fetch failed");
    resetError.cause = new Error("read ECONNRESET");

    globalThis.fetch = vi.fn().mockRejectedValue(resetError);

    const apiService = new SentryApiService({
      host: "sentry.io",
      accessToken: "test-token",
    });

    await expect(apiService.getAuthenticatedUser()).rejects.toThrow(
      /Connection reset/,
    );
  });

  it("should handle generic network errors", async () => {
    const genericError = new Error("Network request failed");

    globalThis.fetch = vi.fn().mockRejectedValue(genericError);

    const apiService = new SentryApiService({
      host: "sentry.io",
      accessToken: "test-token",
    });

    await expect(apiService.getAuthenticatedUser()).rejects.toThrow(
      /Unable to connect to .* - Network request failed/,
    );
  });

  it("should preserve the original error in the cause chain", async () => {
    const originalError = new Error("getaddrinfo EAI_AGAIN");
    const fetchError = new Error("fetch failed");
    fetchError.cause = originalError;

    globalThis.fetch = vi.fn().mockRejectedValue(fetchError);

    const apiService = new SentryApiService({
      host: "sentry.io",
      accessToken: "test-token",
    });

    try {
      await apiService.getAuthenticatedUser();
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).cause).toBe(fetchError);
      expect(((error as Error).cause as Error).cause).toBe(originalError);
    }
  });

  it("should throw ConfigurationError for DNS errors", async () => {
    const dnsError = new Error("fetch failed");
    dnsError.cause = new Error("getaddrinfo ENOTFOUND invalid.host");

    globalThis.fetch = vi.fn().mockRejectedValue(dnsError);

    const apiService = new SentryApiService({
      host: "invalid.host",
      accessToken: "test-token",
    });

    await expect(apiService.getAuthenticatedUser()).rejects.toThrow(
      ConfigurationError,
    );
  });

  it("should throw ConfigurationError for connection timeout errors", async () => {
    const timeoutError = new Error("fetch failed");
    timeoutError.cause = new Error("connect ETIMEDOUT 192.168.1.1:443");

    globalThis.fetch = vi.fn().mockRejectedValue(timeoutError);

    const apiService = new SentryApiService({
      host: "192.168.1.1",
      accessToken: "test-token",
    });

    await expect(apiService.getAuthenticatedUser()).rejects.toThrow(
      ConfigurationError,
    );
  });
});

describe("listOrganizations", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should fetch from regions endpoint for SaaS", async () => {
    const mockRegionsResponse = {
      regions: [
        { name: "US", url: "https://us.sentry.io" },
        { name: "EU", url: "https://eu.sentry.io" },
      ],
    };

    const mockOrgsUs = [{ id: "1", slug: "org-us", name: "Org US" }];
    const mockOrgsEu = [{ id: "2", slug: "org-eu", name: "Org EU" }];

    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      callCount++;
      if (url.includes("/users/me/regions/")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockRegionsResponse),
        });
      }
      if (url.includes("us.sentry.io")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockOrgsUs),
        });
      }
      if (url.includes("eu.sentry.io")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockOrgsEu),
        });
      }
      return Promise.reject(new Error("Unexpected URL"));
    });

    const apiService = new SentryApiService({
      host: "sentry.io",
      accessToken: "test-token",
    });

    const result = await apiService.listOrganizations();

    expect(callCount).toBe(3); // 1 regions call + 2 org calls
    expect(result).toHaveLength(2);
    expect(result).toContainEqual(expect.objectContaining({ slug: "org-us" }));
    expect(result).toContainEqual(expect.objectContaining({ slug: "org-eu" }));
  });

  it("should fetch directly from organizations endpoint for self-hosted", async () => {
    const mockOrgs = [
      { id: "1", slug: "org-1", name: "Organization 1" },
      { id: "2", slug: "org-2", name: "Organization 2" },
    ];

    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      callCount++;
      if (url.includes("/organizations/")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockOrgs),
        });
      }
      return Promise.reject(new Error("Unexpected URL"));
    });

    const apiService = new SentryApiService({
      host: "sentry.example.com",
      accessToken: "test-token",
    });

    const result = await apiService.listOrganizations();

    expect(callCount).toBe(1); // Only 1 org call, no regions call
    expect(result).toHaveLength(2);
    expect(result).toEqual(mockOrgs);
    // Verify that regions endpoint was not called
    expect(globalThis.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/users/me/regions/"),
      expect.any(Object),
    );
  });

  it("should fall back to direct organizations endpoint when regions endpoint returns 404 on SaaS", async () => {
    const mockOrgs = [
      { id: "1", slug: "org-1", name: "Organization 1" },
      { id: "2", slug: "org-2", name: "Organization 2" },
    ];

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/users/me/regions/")) {
        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: "Not Found",
          text: () => Promise.resolve(JSON.stringify({ detail: "Not found" })),
        });
      }
      if (url.includes("/organizations/")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockOrgs),
        });
      }
      return Promise.reject(new Error("Unexpected URL"));
    });

    const apiService = new SentryApiService({
      host: "sentry.io",
      accessToken: "test-token",
    });

    const result = await apiService.listOrganizations();

    expect(result).toHaveLength(2);
    expect(result).toEqual(mockOrgs);

    // Verify it tried regions first, then fell back to organizations
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/users/me/regions/"),
      expect.any(Object),
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/organizations/"),
      expect.any(Object),
    );
  });
});

describe("host configuration", () => {
  it("should handle hostname without protocol", () => {
    const apiService = new SentryApiService({ host: "sentry.io" });
    // @ts-expect-error - accessing private property for testing
    expect(apiService.host).toBe("sentry.io");
    // @ts-expect-error - accessing private property for testing
    expect(apiService.apiPrefix).toBe("https://sentry.io/api/0");
  });

  it("should handle hostname with port", () => {
    const apiService = new SentryApiService({ host: "localhost:8000" });
    // @ts-expect-error - accessing private property for testing
    expect(apiService.host).toBe("localhost:8000");
    // @ts-expect-error - accessing private property for testing
    expect(apiService.apiPrefix).toBe("https://localhost:8000/api/0");
  });

  it("should always use HTTPS protocol", () => {
    const apiService = new SentryApiService({
      host: "sentry.example.com",
    });
    // @ts-expect-error - accessing private property for testing
    expect(apiService.host).toBe("sentry.example.com");
    // @ts-expect-error - accessing private property for testing
    expect(apiService.apiPrefix).toBe("https://sentry.example.com/api/0");
  });

  it("should always use HTTPS even for localhost", () => {
    const apiService = new SentryApiService({
      host: "localhost:8000",
    });
    // @ts-expect-error - accessing private property for testing
    expect(apiService.host).toBe("localhost:8000");
    // @ts-expect-error - accessing private property for testing
    expect(apiService.apiPrefix).toBe("https://localhost:8000/api/0");
  });

  it("should update host and API prefix with setHost", () => {
    const apiService = new SentryApiService({ host: "sentry.io" });

    apiService.setHost("eu.sentry.io");
    // @ts-expect-error - accessing private property for testing
    expect(apiService.host).toBe("eu.sentry.io");
    // @ts-expect-error - accessing private property for testing
    expect(apiService.apiPrefix).toBe("https://eu.sentry.io/api/0");

    apiService.setHost("localhost:9000");
    // @ts-expect-error - accessing private property for testing
    expect(apiService.host).toBe("localhost:9000");
    // @ts-expect-error - accessing private property for testing
    expect(apiService.apiPrefix).toBe("https://localhost:9000/api/0");
  });
});

describe("Content-Type validation", () => {
  it("should throw error when receiving HTML instead of JSON", async () => {
    const htmlContent = `<!DOCTYPE html>
<html>
<head><title>Login Required</title></head>
<body><h1>Please log in</h1></body>
</html>`;

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: {
        get: (key: string) =>
          key === "content-type" ? "text/html; charset=utf-8" : null,
      },
      text: () => Promise.resolve(htmlContent),
    });

    const apiService = new SentryApiService({
      host: "sentry.io",
      accessToken: "test-token",
    });

    await expect(apiService.getAuthenticatedUser()).rejects.toThrow(
      "Expected JSON response but received HTML (200 OK). This may indicate you're not authenticated, the URL is incorrect, or there's a server issue.",
    );
  });

  it("should throw error when receiving non-JSON content type", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: {
        get: (key: string) => (key === "content-type" ? "text/plain" : null),
      },
      text: () => Promise.resolve("Error: Something went wrong"),
    });

    const apiService = new SentryApiService({
      host: "sentry.io",
      accessToken: "test-token",
    });

    await expect(apiService.getAuthenticatedUser()).rejects.toThrow(
      "Expected JSON response but received text/plain (200 OK)",
    );
  });

  it("should throw error when no content-type header is present", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: {
        get: () => null,
      },
      text: () => Promise.resolve("Some non-JSON response"),
    });

    const apiService = new SentryApiService({
      host: "sentry.io",
      accessToken: "test-token",
    });

    await expect(apiService.getAuthenticatedUser()).rejects.toThrow(
      "Expected JSON response but received unknown content type (200 OK)",
    );
  });

  it("should parse JSON successfully when content-type is application/json", async () => {
    const mockUser = {
      id: "123",
      name: "Test User",
      email: "test@example.com",
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: {
        get: (key: string) =>
          key === "content-type" ? "application/json; charset=utf-8" : null,
      },
      json: () => Promise.resolve(mockUser),
    });

    const apiService = new SentryApiService({
      host: "sentry.io",
      accessToken: "test-token",
    });

    const result = await apiService.getAuthenticatedUser();
    expect(result).toEqual(mockUser);
  });

  it("should detect HTML content even without content-type header", async () => {
    const htmlContent = "<!DOCTYPE html><html><body>Error page</body></html>";

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: {
        get: () => null,
      },
      text: () => Promise.resolve(htmlContent),
    });

    const apiService = new SentryApiService({
      host: "sentry.io",
      accessToken: "test-token",
    });

    await expect(apiService.getAuthenticatedUser()).rejects.toThrow(
      "Expected JSON response but received HTML (200 OK). This may indicate you're not authenticated, the URL is incorrect, or there's a server issue.",
    );
  });

  it("should handle HTML response from regions endpoint", async () => {
    const htmlContent = `<!DOCTYPE html>
<html>
<head><title>Login Required</title></head>
<body><h1>Please log in</h1></body>
</html>`;

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: {
        get: (key: string) =>
          key === "content-type" ? "text/html; charset=utf-8" : null,
      },
      text: () => Promise.resolve(htmlContent),
    });

    const apiService = new SentryApiService({
      host: "sentry.io",
      accessToken: "test-token",
    });

    await expect(apiService.listOrganizations()).rejects.toThrow(
      "Expected JSON response but received HTML (200 OK). This may indicate you're not authenticated, the URL is incorrect, or there's a server issue.",
    );
  });
});

describe("API query builders", () => {
  describe("buildDiscoverApiQuery", () => {
    it("should build correct query for errors dataset", () => {
      const apiService = new SentryApiService({ host: "sentry.io" });

      // @ts-expect-error - accessing private method for testing
      const params = apiService.buildDiscoverApiQuery({
        query: "level:error",
        fields: ["title", "project", "count()"],
        limit: 50,
        projectSlug: "backend",
        statsPeriod: "24h",
        sort: "-count()",
      });

      expect(params.toString()).toMatchInlineSnapshot(
        `"per_page=50&query=level%3Aerror&dataset=errors&statsPeriod=24h&project=backend&sort=-count&field=title&field=project&field=count%28%29"`,
      );
    });

    it("should transform aggregate sort parameters correctly", () => {
      const apiService = new SentryApiService({ host: "sentry.io" });

      // @ts-expect-error - accessing private method for testing
      const params = apiService.buildDiscoverApiQuery({
        query: "",
        fields: ["error.type", "count()", "count_unique(user)"],
        limit: 10,
        sort: "-count(span.duration)",
      });

      expect(params.get("sort")).toBe("-count_span_duration");
    });

    it("should handle empty aggregate functions in sort", () => {
      const apiService = new SentryApiService({ host: "sentry.io" });

      // @ts-expect-error - accessing private method for testing
      const params = apiService.buildDiscoverApiQuery({
        query: "",
        fields: ["title", "count()"],
        limit: 10,
        sort: "-count()",
      });

      expect(params.get("sort")).toBe("-count");
    });

    it("should safely handle malformed sort parameters", () => {
      const apiService = new SentryApiService({ host: "sentry.io" });

      // @ts-expect-error - accessing private method for testing
      const params = apiService.buildDiscoverApiQuery({
        query: "",
        fields: ["title"],
        limit: 10,
        sort: "-count(((",
      });

      // Should not crash and should return the original sort if malformed
      expect(params.get("sort")).toBe("-count(((");
    });
  });

  describe("buildEapApiQuery", () => {
    it("should build correct query for spans dataset with sampling", () => {
      const apiService = new SentryApiService({ host: "sentry.io" });

      // @ts-expect-error - accessing private method for testing
      const params = apiService.buildEapApiQuery({
        query: "span.op:db",
        fields: ["span.op", "span.description", "span.duration"],
        limit: 20,
        projectSlug: "frontend",
        dataset: "spans",
        statsPeriod: "1h",
        sort: "-span.duration",
      });

      expect(params.toString()).toMatchInlineSnapshot(
        `"per_page=20&query=span.op%3Adb&dataset=spans&statsPeriod=1h&project=frontend&sampling=NORMAL&sort=-span.duration&field=span.op&field=span.description&field=span.duration"`,
      );
    });

    it("should build correct query for logs dataset without sampling", () => {
      const apiService = new SentryApiService({ host: "sentry.io" });

      // @ts-expect-error - accessing private method for testing
      const params = apiService.buildEapApiQuery({
        query: "severity:error",
        fields: ["timestamp", "message", "severity"],
        limit: 30,
        dataset: "ourlogs",
        sort: "-timestamp",
      });

      expect(params.toString()).toMatchInlineSnapshot(
        `"per_page=30&query=severity%3Aerror&dataset=ourlogs&sort=-timestamp&field=timestamp&field=message&field=severity"`,
      );

      // Verify sampling is not added for logs
      expect(params.has("sampling")).toBe(false);
    });

    it("should transform complex aggregate sorts with dots", () => {
      const apiService = new SentryApiService({ host: "sentry.io" });

      // @ts-expect-error - accessing private method for testing
      const params = apiService.buildEapApiQuery({
        query: "",
        fields: ["span.op", "avg(span.self_time)"],
        limit: 10,
        dataset: "spans",
        sort: "-avg(span.self_time)",
      });

      expect(params.get("sort")).toBe("-avg_span_self_time");
    });
  });

  describe("searchEvents integration", () => {
    it("should route errors dataset to Discover API builder", async () => {
      const apiService = new SentryApiService({
        host: "sentry.io",
        accessToken: "test-token",
      });

      // Mock the API response
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: (key: string) =>
            key === "content-type" ? "application/json" : null,
        },
        json: () => Promise.resolve({ data: [] }),
      });

      await apiService.searchEvents({
        organizationSlug: "test-org",
        query: "level:error",
        fields: ["title", "count()"],
        dataset: "errors",
        sort: "-count()",
      });

      // Verify the URL contains correct parameters
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("dataset=errors"),
        expect.any(Object),
      );
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("sort=-count"),
        expect.any(Object),
      );
    });

    it("should route spans dataset to EAP API builder with sampling", async () => {
      const apiService = new SentryApiService({
        host: "sentry.io",
        accessToken: "test-token",
      });

      // Mock the API response
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: (key: string) =>
            key === "content-type" ? "application/json" : null,
        },
        json: () => Promise.resolve({ data: [] }),
      });

      await apiService.searchEvents({
        organizationSlug: "test-org",
        query: "span.op:http",
        fields: ["span.op", "span.duration"],
        dataset: "spans",
      });

      // Verify the URL contains correct parameters
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("dataset=spans"),
        expect.any(Object),
      );
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("sampling=NORMAL"),
        expect.any(Object),
      );
    });
  });

  describe("Web URL builders", () => {
    describe("buildDiscoverUrl", () => {
      it("should build correct URL for errors dataset on SaaS", () => {
        const apiService = new SentryApiService({ host: "sentry.io" });

        // @ts-expect-error - accessing private method for testing
        const url = apiService.buildDiscoverUrl({
          organizationSlug: "my-org",
          query: "level:error",
          projectSlug: "backend",
          fields: ["title", "project", "timestamp"],
          sort: "-timestamp",
        });

        expect(url).toMatchInlineSnapshot(
          `"https://my-org.sentry.io/explore/discover/homepage/?dataset=errors&queryDataset=error-events&query=level%3Aerror&project=backend&field=title&field=project&field=timestamp&sort=-timestamp&statsPeriod=24h&yAxis=count%28%29"`,
        );
      });

      it("should include aggregate mode and yAxis for aggregate queries", () => {
        const apiService = new SentryApiService({ host: "sentry.io" });

        // @ts-expect-error - accessing private method for testing
        const url = apiService.buildDiscoverUrl({
          organizationSlug: "my-org",
          query: "is:unresolved",
          fields: ["title", "count()"],
          sort: "-count()",
          aggregateFunctions: ["count()"],
          groupByFields: ["title"],
        });

        expect(url).toContain("mode=aggregate");
        expect(url).toContain("yAxis=count%28%29");
        expect(url).toContain("field=title");
        expect(url).toContain("field=count%28%29");
      });

      it("should build correct URL for self-hosted", () => {
        const apiService = new SentryApiService({ host: "sentry.example.com" });

        // @ts-expect-error - accessing private method for testing
        const url = apiService.buildDiscoverUrl({
          organizationSlug: "my-org",
          query: "level:error",
          fields: ["title", "project"],
        });

        expect(url).toMatchInlineSnapshot(
          `"https://sentry.example.com/organizations/my-org/explore/discover/homepage/?dataset=errors&queryDataset=error-events&query=level%3Aerror&field=title&field=project&sort=-timestamp&statsPeriod=24h&yAxis=count%28%29"`,
        );
      });
    });

    describe("buildEapUrl", () => {
      it("should build correct URL for spans dataset with aggregate fields", () => {
        const apiService = new SentryApiService({ host: "sentry.io" });

        // @ts-expect-error - accessing private method for testing
        const url = apiService.buildEapUrl({
          organizationSlug: "my-org",
          query: "is_transaction:True",
          dataset: "spans",
          projectSlug: "123456",
          fields: ["span.description", "count()"],
          sort: "-count()",
          aggregateFunctions: ["count()"],
          groupByFields: ["span.description"],
        });

        expect(url).toContain("https://my-org.sentry.io/explore/traces/");
        expect(url).toContain("mode=aggregate");
        expect(url).toContain(
          `aggregateField=%7B%22groupBy%22%3A%22span.description%22%7D`,
        );
        expect(url).toContain(
          `aggregateField=%7B%22yAxes%22%3A%5B%22count%28%29%22%5D%7D`,
        );
        expect(url).toContain("project=123456");
        expect(url).toContain("query=is_transaction%3ATrue");
        expect(url).toContain("statsPeriod=24h");
      });

      it("should not include empty groupBy in aggregateField", () => {
        const apiService = new SentryApiService({ host: "sentry.io" });

        // @ts-expect-error - accessing private method for testing
        const url = apiService.buildEapUrl({
          organizationSlug: "my-org",
          query: "span.op:db",
          dataset: "spans",
          fields: ["count()"],
          sort: "-count()",
          aggregateFunctions: ["count()"],
          groupByFields: [],
        });

        expect(url).toContain("mode=aggregate");
        expect(url).toContain(
          `aggregateField=%7B%22yAxes%22%3A%5B%22count%28%29%22%5D%7D`,
        );
        expect(url).not.toContain("groupBy");
      });

      it("should handle multiple groupBy fields", () => {
        const apiService = new SentryApiService({ host: "sentry.io" });

        // @ts-expect-error - accessing private method for testing
        const url = apiService.buildEapUrl({
          organizationSlug: "my-org",
          query: "",
          dataset: "spans",
          fields: ["span.op", "span.description", "count()"],
          sort: "-count()",
          aggregateFunctions: ["count()"],
          groupByFields: ["span.op", "span.description"],
        });

        expect(url).toContain(
          `aggregateField=%7B%22groupBy%22%3A%22span.op%22%7D`,
        );
        expect(url).toContain(
          `aggregateField=%7B%22groupBy%22%3A%22span.description%22%7D`,
        );
        expect(url).toContain(
          `aggregateField=%7B%22yAxes%22%3A%5B%22count%28%29%22%5D%7D`,
        );
      });

      it("should handle non-aggregate queries", () => {
        const apiService = new SentryApiService({ host: "sentry.io" });

        // @ts-expect-error - accessing private method for testing
        const url = apiService.buildEapUrl({
          organizationSlug: "my-org",
          query: "span.op:http",
          dataset: "spans",
          fields: ["span.op", "span.description", "span.duration"],
          sort: "-span.duration",
        });

        expect(url).not.toContain("mode=aggregate");
        expect(url).not.toContain("aggregateField");
        expect(url).toContain("field=span.op");
        expect(url).toContain("field=span.description");
        expect(url).toContain("field=span.duration");
        expect(url).toContain("sort=-span.duration");
      });

      it("should use correct path for logs dataset", () => {
        const apiService = new SentryApiService({ host: "sentry.io" });

        // @ts-expect-error - accessing private method for testing
        const url = apiService.buildEapUrl({
          organizationSlug: "my-org",
          query: "severity:error",
          dataset: "logs",
          fields: ["timestamp", "message"],
        });

        expect(url).toContain("/explore/logs/");
        expect(url).not.toContain("/explore/traces/");
      });

      it("should handle self-hosted URLs correctly", () => {
        const apiService = new SentryApiService({ host: "sentry.example.com" });

        // @ts-expect-error - accessing private method for testing
        const url = apiService.buildEapUrl({
          organizationSlug: "my-org",
          query: "",
          dataset: "spans",
          fields: ["span.op"],
        });

        expect(url).toMatchInlineSnapshot(
          `"https://sentry.example.com/organizations/my-org/explore/traces/?query=&field=span.op&statsPeriod=24h"`,
        );
      });
    });
  });
});
