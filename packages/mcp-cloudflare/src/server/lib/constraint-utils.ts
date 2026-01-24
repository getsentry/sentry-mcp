import type { Constraints, ProjectCapabilities } from "@sentry/mcp-core/types";
import { SentryApiService, ApiError } from "@sentry/mcp-core/api-client";
import { logIssue } from "@sentry/mcp-core/telem/logging";

// Timeout for fetching project capabilities (5 seconds)
const CAPABILITIES_TIMEOUT_MS = 5000;

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
 */
export async function verifyConstraintsAccess(
  { organizationSlug, projectSlug }: Constraints,
  {
    accessToken,
    sentryHost = "sentry.io",
  }: {
    accessToken: string | undefined | null;
    sentryHost?: string;
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

  // Use shared API client for consistent behavior and error handling
  const api = new SentryApiService({ accessToken, host: sentryHost });

  // Verify organization using API client
  let regionUrl: string | null | undefined = null;
  try {
    const org = await api.getOrganization(organizationSlug);
    regionUrl = org.links?.regionUrl || null;
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
      regionUrl: regionUrl || null,
      projectCapabilities,
    },
  };
}
