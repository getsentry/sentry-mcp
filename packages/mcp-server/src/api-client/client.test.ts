import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { SentryApiService } from "./client";

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
