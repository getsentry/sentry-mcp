import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../internal/tool-helpers/define";
import { UserInputError } from "../errors";
import type { ServerContext } from "../types";
import { ParamOrganizationSlug } from "../schema";
import { parseSentryUrl, type ParsedSentryUrl } from "../internal/url-helpers";
import { apiServiceFromContext } from "../internal/tool-helpers/api";
import { ApiNotFoundError } from "../api-client";
import { enhanceNotFoundError } from "../internal/tool-helpers/enhance-error";
import { fetchAndFormatBreadcrumbs } from "../internal/tool-helpers/breadcrumbs";
import getIssueDetails from "./get-issue-details";
import getTraceDetails from "./get-trace-details";
import getProfile from "./get-profile";

/** Types available in both URL mode and explicit mode (resourceType + resourceId). */
export const FULLY_SUPPORTED_TYPES = [
  "issue",
  "event",
  "trace",
  "breadcrumbs",
] as const;
export type FullySupportedType = (typeof FULLY_SUPPORTED_TYPES)[number];

/** Recognized from URLs but not yet fully supported -- return guidance messages. */
export type RecognizedType = "replay" | "monitor" | "release";

/**
 * All resource types. Profile is URL-only (delegates to get_profile, which
 * needs transactionName -- not expressible through a single resourceId).
 */
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
  // Trace params
  traceId?: string;
  // TODO: spanId is parsed from URLs but not yet used - add when get_trace_details supports span focusing
  spanId?: string;
  // Profile params
  projectSlug?: string;
  profilerId?: string;
  transactionName?: string;
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
}): ResolvedResourceParams {
  if (params.url) {
    const parsed = parseSentryUrl(params.url);
    return resolveFromParsedUrl(parsed, params);
  }

  if (!params.resourceType) {
    throw new UserInputError(
      "Either `url` or `resourceType` must be provided. " +
        "Use `url` to automatically detect the resource type, or specify `resourceType` explicitly.",
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

    case "breadcrumbs":
      return {
        type: "breadcrumbs",
        organizationSlug,
        issueId: resourceId.toUpperCase(),
      };
  }
}

/**
 * When resourceType is provided alongside a URL, it overrides the auto-detected type.
 * Only 'breadcrumbs' is allowed as an override (requires an issue URL).
 */
function resolveFromParsedUrl(
  parsed: ParsedSentryUrl,
  params: { resourceType?: string | null },
): ResolvedResourceParams {
  const { type: detectedType, organizationSlug } = parsed;

  if (detectedType === "unknown") {
    if (parsed.transaction) {
      throw new UserInputError(
        `Detected a performance summary URL for transaction "${parsed.transaction}". Use \`get_profile\` with the transaction name to analyze performance data, or \`search_events\` to find traces for this transaction.`,
      );
    }
    throw new UserInputError(
      "Could not determine resource type from URL. " +
        "Supported URL patterns: issues, events, traces, profiles, replays, monitors, and releases.",
    );
  }

  if (params.resourceType && params.resourceType !== detectedType) {
    if (params.resourceType !== "breadcrumbs") {
      throw new UserInputError(
        `Cannot override URL type with resourceType '${params.resourceType}'. Only 'breadcrumbs' can be used as a resourceType override with a URL.`,
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
        projectSlug: parsed.projectSlug,
        profilerId: parsed.profilerId,
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
        projectSlug: parsed.projectSlug,
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

function generateUnsupportedResourceMessage(
  resolved: ResolvedResourceParams,
): string {
  const { type, organizationSlug } = resolved;

  switch (type) {
    case "replay": {
      const replayUrl = `https://${organizationSlug}.sentry.io/replays/${resolved.replayId}/`;
      return [
        "# Replay Detected",
        "",
        `**Organization**: ${organizationSlug}`,
        `**Replay ID**: ${resolved.replayId}`,
        "",
        "Session replay support is coming soon. In the meantime:",
        "",
        `- **View in Sentry**: [Open Replay](${replayUrl})`,
        "- **Find related issues**: Use `search_issues` with the replay's time range",
        `- **Search events**: Use \`search_events\` with query \`replay_id:${resolved.replayId}\` to find events associated with this replay`,
      ].join("\n");
    }

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
  skills: ["inspect"],
  requiredScopes: ["event:read"],
  experimental: true,

  description: [
    "Fetch a Sentry resource by URL or by type and ID.",
    "",
    "USE THIS TOOL WHEN:",
    "- User provides a Sentry URL (issue, event, trace, profile, replay, monitor, release)",
    "- User wants to fetch a specific resource by type and ID",
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
    "get_sentry_resource(resourceType='breadcrumbs', organizationSlug='my-org', resourceId='PROJECT-123')",
    "</examples>",
    "",
    "<hints>",
    "- If user provides a Sentry URL, pass the ENTIRE URL to the `url` parameter",
    "- Use `resourceType='breadcrumbs'` with an issue URL to see the trail of events leading up to the error",
    "- For replay, monitor, and release URLs, this tool returns guidance on which tools to use instead",
    "</hints>",
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
      .enum(["issue", "event", "trace", "breadcrumbs"])
      .optional()
      .describe(
        "Resource type. With a URL, overrides the auto-detected type (e.g., 'breadcrumbs' on an issue URL).",
      ),

    resourceId: z
      .string()
      .trim()
      .optional()
      .describe(
        "Resource identifier: issue shortId (e.g., 'PROJECT-123'), event ID, or trace ID. Required when not using a URL.",
      ),

    organizationSlug: ParamOrganizationSlug.optional(),
  },

  annotations: { readOnlyHint: true, openWorldHint: true },

  async handler(params, context: ServerContext) {
    const resolved = resolveResourceParams({
      url: params.url,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      organizationSlug: params.organizationSlug,
    });

    setTag("resource.type", resolved.type);
    setTag("organization.slug", resolved.organizationSlug);

    // Recognized but not yet fully supported types return guidance messages
    if (
      resolved.type === "replay" ||
      resolved.type === "monitor" ||
      resolved.type === "release"
    ) {
      return generateUnsupportedResourceMessage(resolved);
    }

    switch (resolved.type) {
      case "issue":
        return getIssueDetails.handler(
          {
            organizationSlug: resolved.organizationSlug,
            issueId: resolved.issueId,
            regionUrl: null,
          },
          context,
        );

      case "event":
        return getIssueDetails.handler(
          {
            organizationSlug: resolved.organizationSlug,
            eventId: resolved.eventId,
            regionUrl: null,
          },
          context,
        );

      case "trace":
        return getTraceDetails.handler(
          {
            organizationSlug: resolved.organizationSlug,
            traceId: resolved.traceId!,
            regionUrl: null,
          },
          context,
        );

      case "breadcrumbs": {
        const apiService = apiServiceFromContext(context);
        try {
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

      case "profile":
        return getProfile.handler(
          {
            organizationSlug: resolved.organizationSlug,
            projectSlugOrId: resolved.projectSlug,
            transactionName: resolved.transactionName,
            regionUrl: null,
            statsPeriod: "7d",
            focusOnUserCode: true,
            maxHotPaths: 10,
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
