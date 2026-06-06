import { describe, it, expect, vi } from "vitest";
import "urlpattern-polyfill";
import { SentryApiService } from "@sentry/mcp-core/api-client";
import {
  verifyConstraintsAccess,
  type CachedConstraints,
  type CacheOptions,
} from "./constraint-utils";

/**
 * Create a mock KVNamespace for testing cache behavior.
 */
function createMockKV(options?: {
  getResult?: unknown;
  getResultByKey?: Record<string, unknown>;
  getError?: Error;
  putError?: Error;
}): KVNamespace {
  return {
    get: vi.fn().mockImplementation(async (key: string) => {
      if (options?.getError) throw options.getError;
      if (
        options?.getResultByKey &&
        Object.hasOwn(options.getResultByKey, key)
      ) {
        return options.getResultByKey[key];
      }
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

type TestCacheOptions = CacheOptions & {
  waitUntil: ReturnType<typeof vi.fn>;
};

function createCache(kv: KVNamespace, userId: string): TestCacheOptions {
  return {
    kv,
    userId,
    waitUntil: vi.fn((promise: Promise<void>) => {
      void promise;
    }),
  };
}

async function flushCacheWrites(cache: TestCacheOptions): Promise<void> {
  await Promise.all(
    cache.waitUntil.mock.calls.map(([promise]) => promise as Promise<void>),
  );
}

function getCachePuts(kv: KVNamespace): Array<{
  key: string;
  body: CachedConstraints;
  ttl: number | undefined;
}> {
  return vi.mocked(kv.put).mock.calls.map(([key, value, options]) => ({
    key: key as string,
    body: JSON.parse(value as string) as CachedConstraints,
    ttl: (options as { expirationTtl?: number } | undefined)?.expirationTtl,
  }));
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
      scope: "project",
      status: "verified",
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
      const cache = createCache(mockKV, "user-123");

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
        "caps:v2:user-123:sentry.io:sentry-mcp-evals:project:cloudflare-mcp",
        "json",
      );

      // Verify no cache write on hit (data already cached)
      expect(mockKV.put).not.toHaveBeenCalled();
    });

    it("fetches from API and populates cache on cache miss", async () => {
      const mockKV = createMockKV({ getResult: null });
      const cache = createCache(mockKV, "user-456");

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

      // Verify project cache miss checked the org-only fallback.
      expect(mockKV.get).toHaveBeenCalledTimes(2);
      expect(mockKV.get).toHaveBeenNthCalledWith(
        1,
        "caps:v2:user-456:sentry.io:sentry-mcp-evals:project:cloudflare-mcp",
        "json",
      );
      expect(mockKV.get).toHaveBeenNthCalledWith(
        2,
        "caps:v2:user-456:sentry.io:sentry-mcp-evals:org",
        "json",
      );

      await flushCacheWrites(cache);

      // Verify org and project cache entries were written with correct keys and TTL.
      expect(mockKV.put).toHaveBeenCalledTimes(2);
      expect(getCachePuts(mockKV)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: "caps:v2:user-456:sentry.io:sentry-mcp-evals:org",
            ttl: 900,
            body: expect.objectContaining({
              scope: "org",
              regionUrl: "https://us.sentry.io",
              cachedAt: expect.any(Number),
            }),
          }),
          expect.objectContaining({
            key: "caps:v2:user-456:sentry.io:sentry-mcp-evals:project:cloudflare-mcp",
            ttl: 900,
            body: expect.objectContaining({
              scope: "project",
              status: "verified",
              regionUrl: "https://us.sentry.io",
              projectCapabilities: {
                profiles: false,
                replays: false,
                logs: false,
                traces: false,
              },
              cachedAt: expect.any(Number),
            }),
          }),
        ]),
      );
    });

    it("schedules cache writes with waitUntil", async () => {
      const mockKV = createMockKV({ getResult: null });
      const cache = createCache(mockKV, "user-wait-until");

      const result = await verifyConstraintsAccess(
        { organizationSlug: "sentry-mcp-evals", projectSlug: null },
        { accessToken: token, sentryHost: host, cache },
      );

      expect(result.ok).toBe(true);
      expect(cache.waitUntil).toHaveBeenCalledOnce();
      await flushCacheWrites(cache);
      expect(mockKV.put).toHaveBeenCalledOnce();
      expect(mockKV.put).toHaveBeenCalledWith(
        "caps:v2:user-wait-until:sentry.io:sentry-mcp-evals:org",
        expect.any(String),
        { expirationTtl: 900 },
      );
    });

    it("uses the org-only cache before verifying a project cache miss", async () => {
      const orgOnlyCached: CachedConstraints = {
        scope: "org",
        regionUrl: "https://us.sentry.io",
        cachedAt: Date.now(),
      };
      const mockKV = createMockKV({
        getResultByKey: {
          "caps:v2:user-project-fallback:sentry.io:sentry-mcp-evals:project:cloudflare-mcp":
            null,
          "caps:v2:user-project-fallback:sentry.io:sentry-mcp-evals:org":
            orgOnlyCached,
        },
      });
      const cache = createCache(mockKV, "user-project-fallback");

      const result = await verifyConstraintsAccess(
        { organizationSlug: "sentry-mcp-evals", projectSlug: "cloudflare-mcp" },
        { accessToken: token, sentryHost: host, cache },
      );

      expect(result.ok).toBe(true);
      expect(mockKV.get).toHaveBeenCalledTimes(2);
      expect(mockKV.get).toHaveBeenNthCalledWith(
        1,
        "caps:v2:user-project-fallback:sentry.io:sentry-mcp-evals:project:cloudflare-mcp",
        "json",
      );
      expect(mockKV.get).toHaveBeenNthCalledWith(
        2,
        "caps:v2:user-project-fallback:sentry.io:sentry-mcp-evals:org",
        "json",
      );
    });

    it("briefly caches project verification timeouts", async () => {
      vi.useFakeTimers();
      const mockKV = createMockKV({ getResult: null });
      const cache = createCache(mockKV, "user-project-timeout");
      let markProjectStarted = () => {};
      const projectStarted = new Promise<void>((resolve) => {
        markProjectStarted = resolve;
      });
      const getProjectSpy = vi
        .spyOn(SentryApiService.prototype, "getProject")
        .mockImplementation(() => {
          markProjectStarted();
          return new Promise<never>(() => {}) as ReturnType<
            SentryApiService["getProject"]
          >;
        });

      try {
        const resultPromise = verifyConstraintsAccess(
          {
            organizationSlug: "sentry-mcp-evals",
            projectSlug: "cloudflare-mcp",
          },
          { accessToken: token, sentryHost: host, cache },
        );

        await projectStarted;
        await vi.advanceTimersByTimeAsync(5000);

        const result = await resultPromise;
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.constraints).toEqual({
            organizationSlug: "sentry-mcp-evals",
            projectSlug: "cloudflare-mcp",
            regionUrl: "https://us.sentry.io",
            projectCapabilities: null,
          });
        }

        expect(cache.waitUntil).toHaveBeenCalledTimes(2);
        await flushCacheWrites(cache);
        const cachePuts = getCachePuts(mockKV);
        expect(cachePuts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              key: "caps:v2:user-project-timeout:sentry.io:sentry-mcp-evals:org",
              ttl: 900,
              body: expect.objectContaining({
                scope: "org",
                regionUrl: "https://us.sentry.io",
                cachedAt: expect.any(Number),
              }),
            }),
            expect.objectContaining({
              key: "caps:v2:user-project-timeout:sentry.io:sentry-mcp-evals:project:cloudflare-mcp",
              ttl: 60,
              body: expect.objectContaining({
                scope: "project",
                status: "timeout",
                regionUrl: "https://us.sentry.io",
                cachedAt: expect.any(Number),
              }),
            }),
          ]),
        );
        const projectTimeoutPut = cachePuts.find(
          (put) =>
            put.key ===
            "caps:v2:user-project-timeout:sentry.io:sentry-mcp-evals:project:cloudflare-mcp",
        );
        expect(projectTimeoutPut).toBeDefined();
        if (projectTimeoutPut) {
          expect("projectCapabilities" in projectTimeoutPut.body).toBe(false);
        }
      } finally {
        getProjectSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it("uses cached project timeouts as explicit fail-open entries", async () => {
      const cachedTimeout: CachedConstraints = {
        scope: "project",
        status: "timeout",
        regionUrl: "https://us.sentry.io",
        cachedAt: Date.now(),
      };
      const mockKV = createMockKV({ getResult: cachedTimeout });
      const cache = createCache(mockKV, "user-cached-timeout");

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
          projectCapabilities: null,
        });
      }
      expect(mockKV.get).toHaveBeenCalledOnce();
      expect(mockKV.put).not.toHaveBeenCalled();
    });

    it("proceeds without cache when cache read fails", async () => {
      const mockKV = createMockKV({ getError: new Error("KV unavailable") });
      const cache = createCache(mockKV, "user-789");

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

      // Verify project cache and org fallback reads were attempted.
      expect(mockKV.get).toHaveBeenCalledTimes(2);
    });

    it("succeeds even when cache write fails", async () => {
      const mockKV = createMockKV({
        getResult: null,
        putError: new Error("KV write failed"),
      });
      const cache = createCache(mockKV, "user-write-fail");

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

      await flushCacheWrites(cache);

      // Verify org and project cache writes were attempted.
      expect(mockKV.put).toHaveBeenCalledTimes(2);
    });

    it("uses cache for org-only verification", async () => {
      const orgOnlyCached: CachedConstraints = {
        scope: "org",
        regionUrl: "https://us.sentry.io",
        cachedAt: Date.now(),
      };
      const mockKV = createMockKV({ getResult: orgOnlyCached });
      const cache = createCache(mockKV, "user-org-only");

      const result = await verifyConstraintsAccess(
        { organizationSlug: "sentry-mcp-evals", projectSlug: null },
        { accessToken: token, sentryHost: host, cache },
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

      expect(mockKV.get).toHaveBeenCalledOnce();
      expect(mockKV.get).toHaveBeenCalledWith(
        "caps:v2:user-org-only:sentry.io:sentry-mcp-evals:org",
        "json",
      );
      expect(mockKV.put).not.toHaveBeenCalled();
    });

    it("uses distinct cache keys for org-only and '__org__' project constraints", async () => {
      const orgOnlyCached: CachedConstraints = {
        scope: "org",
        regionUrl: "https://us.sentry.io",
        cachedAt: Date.now(),
      };
      const mockKV = createMockKV({
        getResultByKey: {
          "caps:v2:user-sentinel:sentry.io:sentry-mcp-evals:org": orgOnlyCached,
          "caps:v2:user-sentinel:sentry.io:sentry-mcp-evals:project:__org__":
            cachedData,
        },
      });
      const cache = createCache(mockKV, "user-sentinel");

      const orgOnlyResult = await verifyConstraintsAccess(
        { organizationSlug: "sentry-mcp-evals", projectSlug: null },
        { accessToken: token, sentryHost: host, cache },
      );
      const projectResult = await verifyConstraintsAccess(
        { organizationSlug: "sentry-mcp-evals", projectSlug: "__org__" },
        { accessToken: token, sentryHost: host, cache },
      );

      expect(orgOnlyResult.ok).toBe(true);
      expect(projectResult.ok).toBe(true);
      expect(mockKV.get).toHaveBeenNthCalledWith(
        1,
        "caps:v2:user-sentinel:sentry.io:sentry-mcp-evals:org",
        "json",
      );
      expect(mockKV.get).toHaveBeenNthCalledWith(
        2,
        "caps:v2:user-sentinel:sentry.io:sentry-mcp-evals:project:__org__",
        "json",
      );
    });

    it("does not collapse a project scope into the org cache key during key construction", async () => {
      const orgOnlyCached: CachedConstraints = {
        scope: "org",
        regionUrl: "https://us.sentry.io",
        cachedAt: Date.now(),
      };
      const mockKV = createMockKV({
        getResultByKey: {
          "caps:v2:user-no-collapse:sentry.io:sentry-mcp-evals:org":
            orgOnlyCached,
          "caps:v2:user-no-collapse:sentry.io:sentry-mcp-evals:project:   ":
            cachedData,
        },
      });
      const cache = createCache(mockKV, "user-no-collapse");

      const result = await verifyConstraintsAccess(
        { organizationSlug: "sentry-mcp-evals", projectSlug: "   " },
        { accessToken: token, sentryHost: host, cache },
      );

      expect(result.ok).toBe(true);
      expect(mockKV.get).toHaveBeenCalledOnce();
      expect(mockKV.get).toHaveBeenCalledWith(
        "caps:v2:user-no-collapse:sentry.io:sentry-mcp-evals:project:   ",
        "json",
      );
    });

    it("does not treat an org cache entry as a project cache hit", async () => {
      const orgOnlyCached: CachedConstraints = {
        scope: "org",
        regionUrl: "https://us.sentry.io",
        cachedAt: Date.now(),
      };
      const mockKV = createMockKV({
        getResultByKey: {
          "caps:v2:user-wrong-scope:sentry.io:sentry-mcp-evals:project:cloudflare-mcp":
            orgOnlyCached,
          "caps:v2:user-wrong-scope:sentry.io:sentry-mcp-evals:org": null,
        },
      });
      const cache = createCache(mockKV, "user-wrong-scope");

      const result = await verifyConstraintsAccess(
        { organizationSlug: "sentry-mcp-evals", projectSlug: "cloudflare-mcp" },
        { accessToken: token, sentryHost: host, cache },
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.constraints.projectCapabilities).toEqual({
          profiles: false,
          replays: false,
          logs: false,
          traces: false,
        });
      }
    });

    it("ignores malformed cached entries", async () => {
      const mockKV = createMockKV({
        getResultByKey: {
          "caps:v2:user-malformed:sentry.io:sentry-mcp-evals:project:cloudflare-mcp":
            {
              scope: "project",
              status: "verified",
              regionUrl: "https://us.sentry.io",
              cachedAt: Date.now(),
              projectCapabilities: {
                profiles: "yes",
              },
            },
          "caps:v2:user-malformed:sentry.io:sentry-mcp-evals:org": null,
        },
      });
      const cache = createCache(mockKV, "user-malformed");

      const result = await verifyConstraintsAccess(
        { organizationSlug: "sentry-mcp-evals", projectSlug: "cloudflare-mcp" },
        { accessToken: token, sentryHost: host, cache },
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.constraints.projectCapabilities).toEqual({
          profiles: false,
          replays: false,
          logs: false,
          traces: false,
        });
      }
    });

    it("writes KV cache after org-only verification on miss", async () => {
      const mockKV = createMockKV({ getResult: null });
      const cache = createCache(mockKV, "user-org-cache-write");

      const result = await verifyConstraintsAccess(
        { organizationSlug: "sentry-mcp-evals", projectSlug: null },
        { accessToken: token, sentryHost: host, cache },
      );

      expect(result.ok).toBe(true);
      expect(mockKV.get).toHaveBeenCalledOnce();
      await flushCacheWrites(cache);
      expect(mockKV.put).toHaveBeenCalledOnce();
      expect(mockKV.put).toHaveBeenCalledWith(
        "caps:v2:user-org-cache-write:sentry.io:sentry-mcp-evals:org",
        expect.any(String),
        { expirationTtl: 900 },
      );
      const parsed = JSON.parse(
        vi.mocked(mockKV.put).mock.calls[0][1] as string,
      );
      expect(parsed).toMatchObject({
        scope: "org",
        regionUrl: "https://us.sentry.io",
        cachedAt: expect.any(Number),
      });
    });
  });
});
