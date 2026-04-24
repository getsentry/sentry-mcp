import { z } from "zod";
import { getActiveSpan, setTag } from "@sentry/core";
import { defineTool } from "../internal/tool-helpers/define";
import { UserInputError } from "../errors";
import type { ServerContext } from "../types";
import { ParamOrganizationSlug } from "../schema";
import { parseSentryUrl, type ParsedSentryUrl } from "../internal/url-helpers";
import {
  resolveScopedOrganizationSlug,
  resolveScopedProjectSlug,
} from "../internal/url-scope";
import { apiServiceFromContext } from "../internal/tool-helpers/api";
import { ApiNotFoundError } from "../api-client";
import { enhanceNotFoundError } from "../internal/tool-helpers/enhance-error";
import { ensureIssueWithinProjectConstraint } from "../internal/tool-helpers/issue";
import { fetchAndFormatBreadcrumbs } from "../internal/tool-helpers/breadcrumbs";
import getIssueDetails from "./get-issue-details";
import getTraceDetails from "./get-trace-details";
import getProfileDetails from "./get-profile-details";
import getReplayDetails from "./get-replay-details";

/** Types with full API integration. */
export const FULLY_SUPPORTED_TYPES = [
  "issue",
  "event",
  "trace",
  "span",
  "breadcrumbs",
  "replay",
] as const;
export type FullySupportedType = (typeof FULLY_SUPPORTED_TYPES)[number];

/** Recognized from URLs but not yet fully supported -- return guidance messages. */
export type RecognizedType = "monitor" | "release";

/** All resource types. */
export type ResolvedResourceType =
  | FullySupportedType
  | RecognizedType
  | "profile";

export interface ResolvedResourceParams {
  type: ResolvedResourceType;
  organizationSlug: string;
  // Issue/Event params
  issueId?: string;
  eventId?: string;
  // Trace/Span params
  traceId?: string;
  spanId?: string;
  // Profile params
  projectSlug?: string;
  profileId?: string;
  profilerId?: string;
  start?: string;
  end?: string;
  // Replay params
  replayId?: string;
  // Monitor params
  monitorSlug?: string;
  // Release params
  releaseVersion?: string;
}

export function resolveResourceParams(params: {
  url?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  organizationSlug?: string | null;
  projectSlug?: string | null;
}): ResolvedResourceParams {
  if (params.url) {
    const parsed = parseSentryUrl(params.url);
    return resolveFromParsedUrl(parsed, params);
  }

  if (!params.resourceType) {
    throw new UserInputError(
      "Either `url` or `resourceType` must be provided. " +
        "Pass a `url` to auto-detect the resource type, or specify `resourceType` with `resourceId`.",
    );
  }

  if (
    !FULLY_SUPPORTED_TYPES.includes(params.resourceType as FullySupportedType)
  ) {
    throw new UserInputError(
      `Invalid resourceType: ${params.resourceType}. ` +
        `Supported types: ${FULLY_SUPPORTED_TYPES.join(", ")}`,
    );
  }

  if (!params.organizationSlug) {
    throw new UserInputError(
      "`organizationSlug` is required when not using a URL.",
    );
  }

  const resourceType = params.resourceType as FullySupportedType;
  const organizationSlug = params.organizationSlug;

  if (!params.resourceId) {
    throw new UserInputError("`resourceId` is required when not using a URL.");
  }

  const resourceId = params.resourceId;

  switch (resourceType) {
    case "issue":
      return {
        type: "issue",
        organizationSlug,
        issueId: resourceId.toUpperCase(),
      };

    case "event":
      return {
        type: "event",
        organizationSlug,
        eventId: resourceId,
      };

    case "trace":
      return {
        type: "trace",
        organizationSlug,
        traceId: resourceId,
      };

    case "span": {
      const { traceId, spanId } = parseSpanResourceId(resourceId);
      return {
        type: "span",
        organizationSlug,
        traceId,
        spanId,
      };
    }

    case "breadcrumbs":
      return {
        type: "breadcrumbs",
        organizationSlug,
        issueId: resourceId.toUpperCase(),
      };

    case "replay":
      return {
        type: "replay",
        organizationSlug,
        replayId: resourceId,
      };
  }
}

/**
 * When resourceType is provided alongside a URL, it overrides the auto-detected type.
 * Breadcrumbs can override issue/event URLs, and trace URLs can override span-focused trace URLs.
 */
function resolveFromParsedUrl(
  parsed: ParsedSentryUrl,
  params: {
    resourceType?: string | null;
    organizationSlug?: string | null;
    projectSlug?: string | null;
  },
): ResolvedResourceParams {
  const detectedType: ResolvedResourceType | "unknown" =
    parsed.type === "trace" && parsed.spanId ? "span" : parsed.type;
  const organizationSlug = resolveScopedOrganizationSlug({
    resourceLabel: "Sentry resource",
    scopedOrganizationSlug: params.organizationSlug,
    urlOrganizationSlug: parsed.organizationSlug,
  });

  if (detectedType === "unknown") {
    if (parsed.transaction) {
      throw new UserInputError(
        `Detected a performance summary URL for transaction "${parsed.transaction}". Use \`search_events\` to find traces and performance data for this transaction.`,
      );
    }
    throw new UserInputError(
      "Could not determine resource type from URL. " +
        "Supported URL patterns: issues, events, traces, profiles, replays, monitors, and releases.",
    );
  }

  if (params.resourceType && params.resourceType !== detectedType) {
    if (params.resourceType === "trace" && detectedType === "span") {
      if (!parsed.traceId) {
        throw new UserInputError("Could not extract trace ID from URL.");
      }
      return {
        type: "trace",
        organizationSlug,
        traceId: parsed.traceId,
      };
    }
    if (params.resourceType === "span" && detectedType === "trace") {
      throw new UserInputError(
        "Could not extract span ID from URL for span resource. Provide a trace URL with `?node=span-<spanId>` or use `resourceId='<traceId>:<spanId>'`.",
      );
    }
    if (params.resourceType !== "breadcrumbs") {
      throw new UserInputError(
        `Cannot override URL type with resourceType '${params.resourceType}'. Only 'breadcrumbs' or 'trace' on a span URL can be used as a resourceType override with a URL.`,
      );
    }
    if (!parsed.issueId) {
      throw new UserInputError(
        "Could not extract issue ID from URL for breadcrumbs. Provide an issue URL.",
      );
    }
    return {
      type: "breadcrumbs",
      organizationSlug,
      issueId: parsed.issueId,
    };
  }

  switch (detectedType) {
    case "issue":
      if (!parsed.issueId) {
        throw new UserInputError("Could not extract issue ID from URL.");
      }
      return {
        type: "issue",
        organizationSlug,
        issueId: parsed.issueId,
      };

    case "event":
      if (!parsed.issueId || !parsed.eventId) {
        throw new UserInputError(
          "Could not extract issue ID and event ID from URL.",
        );
      }
      return {
        type: "event",
        organizationSlug,
        issueId: parsed.issueId,
        eventId: parsed.eventId,
      };

    case "trace":
      if (!parsed.traceId) {
        throw new UserInputError("Could not extract trace ID from URL.");
      }
      return {
        type: "trace",
        organizationSlug,
        traceId: parsed.traceId,
      };

    case "span":
      if (!parsed.traceId || !parsed.spanId) {
        throw new UserInputError(
          "Could not extract trace ID and span ID from URL.",
        );
      }
      return {
        type: "span",
        organizationSlug,
        traceId: parsed.traceId,
        spanId: parsed.spanId,
      };

    case "profile":
      if (!parsed.projectSlug) {
        throw new UserInputError(
          "Could not extract project slug from profile URL.",
        );
      }
      return {
        type: "profile",
        organizationSlug,
        projectSlug: resolveScopedProjectSlug({
          resourceLabel: "Profile",
          scopedProjectSlug: params.projectSlug,
          urlProjectSlug: parsed.projectSlug,
        }),
        profileId: parsed.profileId,
        profilerId: parsed.profilerId,
        start: parsed.start,
        end: parsed.end,
      };

    case "replay":
      if (!parsed.replayId) {
        throw new UserInputError("Could not extract replay ID from URL.");
      }
      return {
        type: "replay",
        organizationSlug,
        replayId: parsed.replayId,
      };

    case "monitor":
      if (!parsed.monitorSlug) {
        throw new UserInputError("Could not extract monitor slug from URL.");
      }
      return {
        type: "monitor",
        organizationSlug,
        monitorSlug: parsed.monitorSlug,
        projectSlug: parsed.projectSlug
          ? resolveScopedProjectSlug({
              resourceLabel: "Monitor",
              scopedProjectSlug: params.projectSlug,
              urlProjectSlug: parsed.projectSlug,
            })
          : undefined,
      };

    case "release":
      if (!parsed.releaseVersion) {
        throw new UserInputError("Could not extract release version from URL.");
      }
      return {
        type: "release",
        organizationSlug,
        releaseVersion: parsed.releaseVersion,
      };
  }
}

function parseSpanResourceId(resourceId: string): {
  traceId: string;
  spanId: string;
} {
  const parts = resourceId.trim().split(":");

  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new UserInputError(
      "Span resourceId must use the format `<traceId>:<spanId>`.",
    );
  }

  return {
    traceId: parts[0],
    spanId: parts[1],
  };
}

function generateUnsupportedResourceMessage(
  resolved: ResolvedResourceParams,
): string {
  const { type, organizationSlug } = resolved;

  switch (type) {
    case "monitor": {
      // Include projectSlug in URL when present
      const monitorPath = resolved.projectSlug
        ? `${resolved.projectSlug}/${resolved.monitorSlug}`
        : resolved.monitorSlug;
      const monitorUrl = `https://${organizationSlug}.sentry.io/crons/${monitorPath}/`;
      return [
        "# Cron Monitor Detected",
        "",
        `**Organization**: ${organizationSlug}`,
        `**Monitor**: ${resolved.monitorSlug}`,
        resolved.projectSlug ? `**Project**: ${resolved.projectSlug}` : "",
        "",
        "Cron monitor support is coming soon. In the meantime:",
        "",
        `- **View in Sentry**: [Open Monitor](${monitorUrl})`,
        `- **Search issues**: Use \`search_issues\` with query \`monitor.slug:${resolved.monitorSlug}\` to find issues from this monitor`,
      ]
        .filter(Boolean)
        .join("\n");
    }

    case "release": {
      const releaseUrl = `https://${organizationSlug}.sentry.io/releases/${resolved.releaseVersion}/`;
      return [
        "# Release Detected",
        "",
        `**Organization**: ${organizationSlug}`,
        `**Release**: ${resolved.releaseVersion}`,
        "",
        "To get release information:",
        "",
        `- **View in Sentry**: [Open Release](${releaseUrl})`,
        `- **Find releases**: Use \`find_releases(organizationSlug='${organizationSlug}')\` to list releases and their details`,
        `- **Search issues**: Use \`search_issues\` with query \`release:${resolved.releaseVersion}\` to find issues in this release`,
      ].join("\n");
    }

    default:
      // This should never happen due to TypeScript exhaustiveness
      return `Unsupported resource type: ${type}`;
  }
}

export default defineTool({
  name: "get_sentry_resource",
  skills: ["inspect", "triage", "seer"], // Preserve legacy issue-detail access for triage and Seer workflows.
  requiredScopes: ["event:read"],

  description: [
    "Fetch a Sentry resource by URL or by type and ID.",
    "",
    "Supports issues, events, traces, spans, replays, and breadcrumbs.",
    "Trace lookups return a condensed overview by default.",
    "",
    "For `resourceType='span'`, pass `resourceId` as `<traceId>:<spanId>`.",
    "",
    "<examples>",
    "### From a Sentry URL",
    "get_sentry_resource(url='https://sentry.io/issues/PROJECT-123/')",
    "",
    "### Breadcrumbs from a Sentry URL",
    "get_sentry_resource(url='https://sentry.io/issues/PROJECT-123/', resourceType='breadcrumbs')",
    "",
    "### By type and ID",
    "get_sentry_resource(resourceType='issue', organizationSlug='my-org', resourceId='PROJECT-123')",
    "",
    "### Span by trace and span ID",
    "get_sentry_resource(resourceType='span', organizationSlug='my-org', resourceId='a4d1aae7216b47ff8117cf4e09ce9d0a:aa8e7f3384ef4ff5')",
    "",
    "### Replay by ID",
    "get_sentry_resource(resourceType='replay', organizationSlug='my-org', resourceId='7e07485f-12f9-416b-8b14-26260799b51f')",
    "</examples>",
  ].join("\n"),

  inputSchema: {
    url: z
      .string()
      .url()
      .optional()
      .describe(
        "Sentry URL. The resource type is auto-detected from the URL pattern.",
      ),

    resourceType: z
      .enum(["issue", "event", "trace", "span", "breadcrumbs", "replay"])
      .optional()
      .describe(
        "Resource type. With a URL, can override the auto-detected type for breadcrumbs on an issue/event URL or for `trace` on a span-focused trace URL.",
      ),

    resourceId: z
      .string()
      .trim()
      .optional()
      .describe(
        "Resource identifier: issue shortId (e.g., 'PROJECT-123'), event ID, trace ID, replay ID, or `traceId:spanId` for span resources. Required when not using a URL.",
      ),

    organizationSlug: ParamOrganizationSlug.optional(),
  },

  annotations: { readOnlyHint: true, openWorldHint: true },

  async handler(params, context: ServerContext) {
    const resolved = resolveResourceParams({
      url: params.url,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      organizationSlug:
        params.organizationSlug ?? context.constraints.organizationSlug,
      projectSlug: context.constraints.projectSlug,
    });

    setTag("resource.type", resolved.type);
    setTag("organization.slug", resolved.organizationSlug);
    if (resolved.spanId) {
      setTag("trace.span_id", resolved.spanId);
    }

    getActiveSpan()?.setAttribute("sentry-mcp.resource-type", resolved.type);

    // Recognized but not yet fully supported types return guidance messages
    if (resolved.type === "monitor" || resolved.type === "release") {
      return generateUnsupportedResourceMessage(resolved);
    }

    switch (resolved.type) {
      case "issue":
        return getIssueDetails.handler(
          {
            organizationSlug: resolved.organizationSlug,
            issueId: resolved.issueId,
            regionUrl: context.constraints.regionUrl ?? null,
          },
          context,
        );

      case "event":
        return getIssueDetails.handler(
          {
            organizationSlug: resolved.organizationSlug,
            issueId: resolved.issueId,
            eventId: resolved.eventId,
            regionUrl: context.constraints.regionUrl ?? null,
          },
          context,
        );

      case "trace":
        return getTraceDetails.handler(
          {
            organizationSlug: resolved.organizationSlug,
            traceId: resolved.traceId!,
            regionUrl: context.constraints.regionUrl ?? null,
          },
          context,
        );

      case "span":
        return getTraceDetails.handler(
          {
            organizationSlug: resolved.organizationSlug,
            traceId: resolved.traceId!,
            spanId: resolved.spanId,
            regionUrl: context.constraints.regionUrl ?? null,
          },
          context,
        );

      case "breadcrumbs": {
        const apiService = apiServiceFromContext(context, {
          regionUrl: context.constraints.regionUrl ?? undefined,
        });
        try {
          await ensureIssueWithinProjectConstraint({
            apiService,
            organizationSlug: resolved.organizationSlug,
            issueId: resolved.issueId!,
            projectSlug: context.constraints.projectSlug,
          });
          return await fetchAndFormatBreadcrumbs(
            apiService,
            resolved.organizationSlug,
            resolved.issueId!,
          );
        } catch (error) {
          if (error instanceof ApiNotFoundError) {
            throw enhanceNotFoundError(error, {
              organizationSlug: resolved.organizationSlug,
              issueId: resolved.issueId,
            });
          }
          throw error;
        }
      }

      case "replay":
        return getReplayDetails.handler(
          {
            replayUrl: params.url,
            organizationSlug: resolved.organizationSlug,
            replayId: resolved.replayId,
            regionUrl: context.constraints.regionUrl ?? undefined,
          },
          context,
        );

      case "profile":
        return getProfileDetails.handler(
          {
            profileUrl: params.url,
            organizationSlug: resolved.organizationSlug,
            projectSlugOrId: resolved.projectSlug,
            profileId: resolved.profileId,
            profilerId: resolved.profilerId,
            start: resolved.start,
            end: resolved.end,
            regionUrl: context.constraints.regionUrl ?? null,
            focusOnUserCode: true,
          },
          context,
        );

      default: {
        const _exhaustiveCheck: never = resolved.type;
        throw new Error(`Unhandled resource type: ${_exhaustiveCheck}`);
      }
    }
  },
});
