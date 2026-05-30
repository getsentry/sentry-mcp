import type { Constraints, ProjectCapabilities } from "@sentry/mcp-core/types";
import { SentryApiService, ApiError } from "@sentry/mcp-core/api-client";
import { logIssue, logWarn } from "@sentry/mcp-core/telem/logging";

// Timeout for fetching project capabilities (5 seconds)
const CAPABILITIES_TIMEOUT_MS = 5000;

// Cache configuration
const CACHE_TTL_SECONDS = 900; // 15 minutes
const PROJECT_TIMEOUT_CACHE_TTL_SECONDS = 60; // Avoid repeated startup stalls.
const CACHE_KEY_VERSION = "v2";

/**
 * Cached org constraints data stored in KV.
 */
type CachedOrgConstraints = {
  scope: "org";
  regionUrl: string | null;
  cachedAt: number;
};

type CachedProjectConstraints =
  | {
      scope: "project";
      status: "verified";
      regionUrl: string | null;
      projectCapabilities: ProjectCapabilities;
      cachedAt: number;
    }
  | {
      scope: "project";
      status: "timeout";
      regionUrl: string | null;
      cachedAt: number;
    };

/**
 * Cached constraints data stored in KV.
 */
export type CachedConstraints = CachedOrgConstraints | CachedProjectConstraints;

/**
 * Options for caching constraints verification results.
 */
export type CacheOptions = {
  kv: KVNamespace;
  userId: string;
  waitUntil: (promise: Promise<void>) => void;
};

/**
 * Build a cache key for constraints verification.
 * Format: caps:v2:{userId}:{sentryHost}:{organizationSlug}:{scopeKey}
 * scopeKey is "org" for org-only entries or "project:{slug}" for project-scoped entries.
 */
function buildCacheKey(
  userId: string,
  sentryHost: string,
  organizationSlug: string,
  projectSlug: string | null | undefined,
): string {
  const normalizedProjectSlug = projectSlug?.trim();
  const scopeKey = normalizedProjectSlug
    ? `project:${normalizedProjectSlug}`
    : "org";
  return `caps:${CACHE_KEY_VERSION}:${userId}:${sentryHost}:${organizationSlug}:${scopeKey}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isProjectCapabilities(value: unknown): value is ProjectCapabilities {
  return (
    isRecord(value) &&
    (value.profiles === undefined || typeof value.profiles === "boolean") &&
    (value.replays === undefined || typeof value.replays === "boolean") &&
    (value.logs === undefined || typeof value.logs === "boolean") &&
    (value.traces === undefined || typeof value.traces === "boolean")
  );
}

function isCachedConstraints(value: unknown): value is CachedConstraints {
  if (
    !isRecord(value) ||
    !isNullableString(value.regionUrl) ||
    typeof value.cachedAt !== "number"
  ) {
    return false;
  }

  if (value.scope === "org") {
    return true;
  }

  if (value.scope !== "project") {
    return false;
  }

  if (value.status === "timeout") {
    return true;
  }

  return (
    value.status === "verified" &&
    isProjectCapabilities(value.projectCapabilities)
  );
}

/**
 * Attempt to retrieve cached constraints from KV.
 * Returns null on cache miss or any error (fail-open).
 */
async function getCachedConstraints(
  kv: KVNamespace,
  key: string,
): Promise<CachedConstraints | null> {
  try {
    const cached = await kv.get(key, "json");
    return isCachedConstraints(cached) ? cached : null;
  } catch (error) {
    logWarn("Failed to read constraints cache", {
      loggerScope: ["cloudflare", "constraint-utils"],
      extra: { key, error: String(error) },
    });
    return null;
  }
}

type ConstraintCache = {
  readOrg(): Promise<CachedOrgConstraints | null>;
  readProject(): Promise<CachedProjectConstraints | null>;
  writeOrg(regionUrl: string | null): void;
  writeProjectVerified(
    regionUrl: string | null,
    projectCapabilities: ProjectCapabilities,
  ): void;
  writeProjectTimeout(regionUrl: string | null): void;
};

/**
 * Store constraints in KV cache.
 * Scheduled with waitUntil so errors are logged without blocking the response.
 */
async function setCachedConstraints(
  kv: KVNamespace,
  key: string,
  data: CachedConstraints,
  ttlSeconds = CACHE_TTL_SECONDS,
): Promise<void> {
  try {
    await kv.put(key, JSON.stringify(data), {
      expirationTtl: ttlSeconds,
    });
  } catch (error) {
    logWarn("Failed to write constraints cache", {
      loggerScope: ["cloudflare", "constraint-utils"],
      extra: { key, error: String(error) },
    });
  }
}

function writeCachedConstraints(
  cache: CacheOptions,
  key: string,
  data: CachedConstraints,
  ttlSeconds = CACHE_TTL_SECONDS,
): void {
  const writePromise = setCachedConstraints(cache.kv, key, data, ttlSeconds);
  cache.waitUntil(writePromise);
}

function createConstraintCache(
  cache: CacheOptions,
  sentryHost: string,
  organizationSlug: string,
  projectSlug: string | null | undefined,
): ConstraintCache {
  const orgKey = buildCacheKey(
    cache.userId,
    sentryHost,
    organizationSlug,
    null,
  );
  const projectKey = projectSlug
    ? buildCacheKey(cache.userId, sentryHost, organizationSlug, projectSlug)
    : null;

  return {
    async readOrg() {
      const cached = await getCachedConstraints(cache.kv, orgKey);
      return cached?.scope === "org" ? cached : null;
    },
    async readProject() {
      if (!projectKey) {
        return null;
      }
      const cached = await getCachedConstraints(cache.kv, projectKey);
      return cached?.scope === "project" ? cached : null;
    },
    writeOrg(regionUrl) {
      writeCachedConstraints(cache, orgKey, {
        scope: "org",
        regionUrl,
        cachedAt: Date.now(),
      });
    },
    writeProjectVerified(regionUrl, projectCapabilities) {
      if (!projectKey) {
        return;
      }
      writeCachedConstraints(cache, projectKey, {
        scope: "project",
        status: "verified",
        regionUrl,
        projectCapabilities,
        cachedAt: Date.now(),
      });
    },
    writeProjectTimeout(regionUrl) {
      if (!projectKey) {
        return;
      }
      writeCachedConstraints(
        cache,
        projectKey,
        {
          scope: "project",
          status: "timeout",
          regionUrl,
          cachedAt: Date.now(),
        },
        PROJECT_TIMEOUT_CACHE_TTL_SECONDS,
      );
    },
  };
}

/**
 * Helper to race a promise against a timeout with proper cleanup.
 * Returns the result or throws a timeout error.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("CAPABILITY_TIMEOUT")),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

/**
 * Verify that provided org/project constraints exist and the user has access
 * by querying Sentry's API using the provided OAuth access token.
 *
 * If cache options are provided, results will be cached in KV to avoid
 * repeated API calls during MCP sessions.
 */
export async function verifyConstraintsAccess(
  { organizationSlug, projectSlug }: Constraints,
  {
    accessToken,
    sentryHost = "sentry.io",
    cache,
  }: {
    accessToken: string | undefined | null;
    sentryHost?: string;
    cache?: CacheOptions;
  },
): Promise<
  | {
      ok: true;
      constraints: Constraints;
    }
  | { ok: false; status?: number; message: string; eventId?: string }
> {
  if (!organizationSlug) {
    // No constraints specified, nothing to verify
    return {
      ok: true,
      constraints: {
        organizationSlug: null,
        projectSlug: null,
        regionUrl: null,
      },
    };
  }

  if (!accessToken) {
    return {
      ok: false,
      status: 401,
      message: "Missing access token for constraint verification",
    };
  }

  // Check KV cache when available (org-only and org+project keys).
  // Cache key includes userId to ensure per-user isolation.
  const constraintCache = cache
    ? createConstraintCache(cache, sentryHost, organizationSlug, projectSlug)
    : null;
  if (constraintCache) {
    if (projectSlug) {
      const cachedProject = await constraintCache.readProject();
      if (cachedProject) {
        return {
          ok: true,
          constraints: {
            organizationSlug,
            projectSlug,
            regionUrl: cachedProject.regionUrl,
            projectCapabilities:
              cachedProject.status === "verified"
                ? cachedProject.projectCapabilities
                : null,
          },
        };
      }
    } else {
      const cachedOrg = await constraintCache.readOrg();
      if (cachedOrg) {
        return {
          ok: true,
          constraints: {
            organizationSlug,
            projectSlug: null,
            regionUrl: cachedOrg.regionUrl,
            projectCapabilities: null,
          },
        };
      }
    }
  }

  const cachedOrgConstraints =
    constraintCache && projectSlug ? await constraintCache.readOrg() : null;

  // Use shared API client for consistent behavior and error handling
  const api = new SentryApiService({ accessToken, host: sentryHost });

  // Verify organization using API client
  let regionUrl: string | null = null;
  if (cachedOrgConstraints) {
    regionUrl = cachedOrgConstraints.regionUrl;
  } else {
    try {
      const org = await api.getOrganization(organizationSlug);
      regionUrl = org.links?.regionUrl || null;
      constraintCache?.writeOrg(regionUrl);
    } catch (error) {
      if (error instanceof ApiError) {
        const message =
          error.status === 404
            ? `Organization '${organizationSlug}' not found`
            : error.message;
        return { ok: false, status: error.status, message };
      }
      const eventId = logIssue(error);
      return {
        ok: false,
        status: 502,
        message: "Failed to verify organization",
        eventId,
      };
    }
  }

  // Verify project access if specified
  let projectCapabilities: ProjectCapabilities | null = null;
  if (projectSlug) {
    try {
      // Fetch project with timeout to avoid blocking on slow API responses
      const project = await withTimeout(
        api.getProject(
          {
            organizationSlug,
            projectSlugOrId: projectSlug,
          },
          regionUrl ? { host: new URL(regionUrl).host } : undefined,
        ),
        CAPABILITIES_TIMEOUT_MS,
      );

      // Extract capability flags from project response
      // If fields are missing, === true comparison safely defaults to false
      projectCapabilities = {
        profiles: project.hasProfiles === true,
        replays: project.hasReplays === true,
        logs: project.hasLogs === true,
        traces: project.firstTransactionEvent === true,
      };
      constraintCache?.writeProjectVerified(regionUrl, projectCapabilities);
    } catch (error) {
      // Check if this was a timeout
      if (error instanceof Error && error.message === "CAPABILITY_TIMEOUT") {
        // Timeout - log and proceed with null capabilities (fail-open for tool filtering)
        // Note: We couldn't verify project access in time, but we allow through
        // to avoid blocking users due to slow API responses. Tools will still
        // require valid auth tokens to actually execute.
        logIssue(
          new Error(
            `Project verification timed out after ${CAPABILITIES_TIMEOUT_MS}ms for ${projectSlug}`,
          ),
        );
        constraintCache?.writeProjectTimeout(regionUrl);
      } else if (error instanceof ApiError) {
        // API errors (404, 401, 403, etc.) should fail verification
        const message =
          error.status === 404
            ? `Project '${projectSlug}' not found in organization '${organizationSlug}'`
            : error.message;
        return { ok: false, status: error.status, message };
      } else {
        const eventId = logIssue(error);
        return {
          ok: false,
          status: 502,
          message: "Failed to verify project",
          eventId,
        };
      }
    }
  }

  return {
    ok: true,
    constraints: {
      organizationSlug,
      projectSlug: projectSlug || null,
      regionUrl,
      projectCapabilities,
    },
  };
}
