import { describe, it, expect, vi } from "vitest";
import "urlpattern-polyfill";
import {
  verifyConstraintsAccess,
  type CachedConstraints,
  type CacheOptions,
} from "./constraint-utils";

/**
 * Create a mock KVNamespace for testing cache behavior.
 */
function createMockKV(options?: {
  getResult?: CachedConstraints | null;
  getError?: Error;
  putError?: Error;
}): KVNamespace {
  return {
    get: vi.fn().mockImplementation(async () => {
      if (options?.getError) throw options.getError;
      return options?.getResult ?? null;
    }),
    put: vi.fn().mockImplementation(async () => {
      if (options?.putError) throw options.putError;
    }),
    delete: vi.fn(),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
}

describe("verifyConstraintsAccess", () => {
  const token = "test-token";
  const host = "sentry.io";

  it("returns ok with empty constraints when no org constraint provided", async () => {
    const result = await verifyConstraintsAccess(
      { organizationSlug: null, projectSlug: null },
      { accessToken: token, sentryHost: host },
    );
    expect(result).toEqual({
      ok: true,
      constraints: {
        organizationSlug: null,
        projectSlug: null,
        regionUrl: null,
      },
    });
  });

  it("fails when access token is missing, null, undefined, or empty", async () => {
    const testCases = [
      { accessToken: "", label: "empty" },
      { accessToken: null, label: "null" },
      { accessToken: undefined, label: "undefined" },
    ];

    for (const { accessToken, label } of testCases) {
      const result = await verifyConstraintsAccess(
        { organizationSlug: "org", projectSlug: null },
        { accessToken, sentryHost: host },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(401);
        expect(result.message).toBe(
          "Missing access token for constraint verification",
        );
      }
    }
  });

  it("successfully verifies org access and returns constraints with regionUrl", async () => {
    const result = await verifyConstraintsAccess(
      { organizationSlug: "sentry-mcp-evals", projectSlug: null },
      { accessToken: token, sentryHost: host },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.constraints).toEqual({
        organizationSlug: "sentry-mcp-evals",
        projectSlug: null,
        regionUrl: "https://us.sentry.io",
        projectCapabilities: null,
      });
    }
  });

  it("successfully verifies org and project access", async () => {
    const result = await verifyConstraintsAccess(
      { organizationSlug: "sentry-mcp-evals", projectSlug: "cloudflare-mcp" },
      { accessToken: token, sentryHost: host },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.constraints).toEqual({
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "cloudflare-mcp",
        regionUrl: "https://us.sentry.io",
        projectCapabilities: {
          profiles: false,
          replays: false,
          logs: false,
          traces: false,
        },
      });
    }
  });

  it("fails when org does not exist", async () => {
    const result = await verifyConstraintsAccess(
      { organizationSlug: "nonexistent-org", projectSlug: null },
      { accessToken: token, sentryHost: host },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.message).toBe("Organization 'nonexistent-org' not found");
    }
  });

  it("fails when project does not exist", async () => {
    const result = await verifyConstraintsAccess(
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "nonexistent-project",
      },
      { accessToken: token, sentryHost: host },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.message).toBe(
        "Project 'nonexistent-project' not found in organization 'sentry-mcp-evals'",
      );
    }
  });

  describe("caching", () => {
    const cachedData: CachedConstraints = {
      regionUrl: "https://us.sentry.io",
      projectCapabilities: {
        profiles: true,
        replays: false,
        logs: true,
        traces: false,
      },
      cachedAt: Date.now(),
    };

    it("returns cached data without making API calls on cache hit", async () => {
      const mockKV = createMockKV({ getResult: cachedData });
      const cache: CacheOptions = {
        kv: mockKV,
        userId: "user-123",
      };

      const result = await verifyConstraintsAccess(
        { organizationSlug: "sentry-mcp-evals", projectSlug: "cloudflare-mcp" },
        { accessToken: token, sentryHost: host, cache },
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.constraints).toEqual({
          organizationSlug: "sentry-mcp-evals",
          projectSlug: "cloudflare-mcp",
          regionUrl: "https://us.sentry.io",
          projectCapabilities: {
            profiles: true,
            replays: false,
            logs: true,
            traces: false,
          },
        });
      }

      // Verify cache was checked
      expect(mockKV.get).toHaveBeenCalledOnce();
      expect(mockKV.get).toHaveBeenCalledWith(
        "caps:v1:user-123:sentry.io:sentry-mcp-evals:cloudflare-mcp",
        "json",
      );

      // Verify no cache write on hit (data already cached)
      expect(mockKV.put).not.toHaveBeenCalled();
    });

    it("fetches from API and populates cache on cache miss", async () => {
      const mockKV = createMockKV({ getResult: null });
      const cache: CacheOptions = {
        kv: mockKV,
        userId: "user-456",
      };

      const result = await verifyConstraintsAccess(
        { organizationSlug: "sentry-mcp-evals", projectSlug: "cloudflare-mcp" },
        { accessToken: token, sentryHost: host, cache },
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Should have fetched from API
        expect(result.constraints).toEqual({
          organizationSlug: "sentry-mcp-evals",
          projectSlug: "cloudflare-mcp",
          regionUrl: "https://us.sentry.io",
          projectCapabilities: {
            profiles: false,
            replays: false,
            logs: false,
            traces: false,
          },
        });
      }

      // Verify cache was checked
      expect(mockKV.get).toHaveBeenCalledOnce();

      // Wait for fire-and-forget cache write
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify cache was written with correct key and TTL
      expect(mockKV.put).toHaveBeenCalledOnce();
      expect(mockKV.put).toHaveBeenCalledWith(
        "caps:v1:user-456:sentry.io:sentry-mcp-evals:cloudflare-mcp",
        expect.any(String),
        { expirationTtl: 900 },
      );

      // Verify cached data structure
      const cachedJson = vi.mocked(mockKV.put).mock.calls[0][1] as string;
      const parsed = JSON.parse(cachedJson);
      expect(parsed).toMatchObject({
        regionUrl: "https://us.sentry.io",
        projectCapabilities: {
          profiles: false,
          replays: false,
          logs: false,
          traces: false,
        },
        cachedAt: expect.any(Number),
      });
    });

    it("proceeds without cache when cache read fails", async () => {
      const mockKV = createMockKV({ getError: new Error("KV unavailable") });
      const cache: CacheOptions = {
        kv: mockKV,
        userId: "user-789",
      };

      const result = await verifyConstraintsAccess(
        { organizationSlug: "sentry-mcp-evals", projectSlug: "cloudflare-mcp" },
        { accessToken: token, sentryHost: host, cache },
      );

      // Should still succeed by fetching from API
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.constraints.organizationSlug).toBe("sentry-mcp-evals");
        expect(result.constraints.projectSlug).toBe("cloudflare-mcp");
      }

      // Verify cache read was attempted
      expect(mockKV.get).toHaveBeenCalledOnce();
    });

    it("succeeds even when cache write fails", async () => {
      const mockKV = createMockKV({
        getResult: null,
        putError: new Error("KV write failed"),
      });
      const cache: CacheOptions = {
        kv: mockKV,
        userId: "user-write-fail",
      };

      const result = await verifyConstraintsAccess(
        { organizationSlug: "sentry-mcp-evals", projectSlug: "cloudflare-mcp" },
        { accessToken: token, sentryHost: host, cache },
      );

      // Should still succeed despite cache write failure
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.constraints.organizationSlug).toBe("sentry-mcp-evals");
        expect(result.constraints.projectSlug).toBe("cloudflare-mcp");
      }

      // Wait for fire-and-forget cache write attempt
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify cache write was attempted
      expect(mockKV.put).toHaveBeenCalledOnce();
    });

    it("does not use cache for org-only verification", async () => {
      const mockKV = createMockKV({ getResult: cachedData });
      const cache: CacheOptions = {
        kv: mockKV,
        userId: "user-org-only",
      };

      const result = await verifyConstraintsAccess(
        { organizationSlug: "sentry-mcp-evals", projectSlug: null },
        { accessToken: token, sentryHost: host, cache },
      );

      expect(result.ok).toBe(true);

      // Cache should not be checked for org-only verification
      expect(mockKV.get).not.toHaveBeenCalled();
      expect(mockKV.put).not.toHaveBeenCalled();
    });
  });
});
