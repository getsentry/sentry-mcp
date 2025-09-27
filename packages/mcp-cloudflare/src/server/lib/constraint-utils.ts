import type { Constraints } from "@sentry/mcp-server/types";
import { SentryApiService, ApiError } from "@sentry/mcp-server/api-client";
import { logIssue } from "@sentry/mcp-server/logging";

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
  if (projectSlug) {
    try {
      await api.getProject(
        {
          organizationSlug,
          projectSlugOrId: projectSlug,
        },
        regionUrl ? { host: new URL(regionUrl).host } : undefined,
      );
    } catch (error) {
      if (error instanceof ApiError) {
        const message =
          error.status === 404
            ? `Project '${projectSlug}' not found in organization '${organizationSlug}'`
            : error.message;
        return { ok: false, status: error.status, message };
      }
      const eventId = logIssue(error);
      return {
        ok: false,
        status: 502,
        message: "Failed to verify project",
        eventId,
      };
    }
  }

  return {
    ok: true,
    constraints: {
      organizationSlug,
      projectSlug: projectSlug || null,
      regionUrl: regionUrl || null,
    },
  };
}
