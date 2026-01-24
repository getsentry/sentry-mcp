import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../internal/tool-helpers/define";
import { UserInputError } from "../errors";
import type { ServerContext } from "../types";
import { ParamOrganizationSlug, ParamRegionUrl } from "../schema";
import { parseSentryUrl, type ParsedSentryUrl } from "../internal/url-helpers";
import getIssueDetails from "./get-issue-details";
import getTraceDetails from "./get-trace-details";
import getProfile from "./get-profile";

/**
 * Resource types fully supported with API integration.
 */
const FULLY_SUPPORTED_TYPES = ["issue", "event", "trace", "profile"] as const;
type FullySupportedType = (typeof FULLY_SUPPORTED_TYPES)[number];

/**
 * Resource types recognized from URLs but not yet fully supported.
 */
const RECOGNIZED_TYPES = ["replay", "monitor", "release"] as const;
type RecognizedType = (typeof RECOGNIZED_TYPES)[number];

/**
 * All resource types (supported + recognized).
 */
type ResolvedResourceType = FullySupportedType | RecognizedType;

/**
 * Resolved parameters after URL parsing or explicit params validation.
 */
interface ResolvedResourceParams {
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

/**
 * Validates and resolves resource parameters from URL or explicit params.
 */
function resolveResourceParams(params: {
  url?: string | null;
  resourceType?: string | null;
  organizationSlug?: string | null;
  issueId?: string | null;
  eventId?: string | null;
  traceId?: string | null;
  projectSlug?: string | null;
  profilerId?: string | null;
  transactionName?: string | null;
}): ResolvedResourceParams {
  // URL-based resolution
  if (params.url) {
    const parsed = parseSentryUrl(params.url);
    return resolveFromParsedUrl(parsed, params);
  }

  // Explicit params resolution
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
      "`organizationSlug` is required when using explicit `resourceType`.",
    );
  }

  const resourceType = params.resourceType as FullySupportedType;
  const organizationSlug = params.organizationSlug;

  // Validate type-specific required params
  switch (resourceType) {
    case "issue":
      if (!params.issueId) {
        throw new UserInputError(
          "`issueId` is required for resource type 'issue'.",
        );
      }
      return {
        type: "issue",
        organizationSlug,
        issueId: params.issueId,
      };

    case "event":
      if (!params.issueId || !params.eventId) {
        throw new UserInputError(
          "`issueId` and `eventId` are required for resource type 'event'.",
        );
      }
      return {
        type: "event",
        organizationSlug,
        issueId: params.issueId,
        eventId: params.eventId,
      };

    case "trace":
      if (!params.traceId) {
        throw new UserInputError(
          "`traceId` is required for resource type 'trace'.",
        );
      }
      return {
        type: "trace",
        organizationSlug,
        traceId: params.traceId,
      };

    case "profile":
      if (!params.projectSlug) {
        throw new UserInputError(
          "`projectSlug` is required for resource type 'profile'.",
        );
      }
      if (!params.transactionName) {
        throw new UserInputError(
          "`transactionName` is required for resource type 'profile'.",
        );
      }
      return {
        type: "profile",
        organizationSlug,
        projectSlug: params.projectSlug,
        profilerId: params.profilerId ?? undefined,
        transactionName: params.transactionName,
      };
  }
}

/**
 * Resolves params from a parsed Sentry URL.
 */
function resolveFromParsedUrl(
  parsed: ParsedSentryUrl,
  params: { transactionName?: string | null },
): ResolvedResourceParams {
  const { type, organizationSlug } = parsed;

  if (type === "unknown") {
    // Check if we have a transaction from performance summary URL
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

  switch (type) {
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

    case "profile": {
      if (!parsed.projectSlug) {
        throw new UserInputError(
          "Could not extract project slug from profile URL.",
        );
      }
      // transactionName may come from explicit param since URLs don't always contain it
      const transactionName = params.transactionName ?? undefined;
      return {
        type: "profile",
        organizationSlug,
        projectSlug: parsed.projectSlug,
        profilerId: parsed.profilerId,
        transactionName,
      };
    }

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

/**
 * Generates a helpful message for recognized but not fully supported resource types.
 */
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
    "Unified entry point for fetching Sentry resources. Auto-detects resource type from URL or accepts explicit type and identifiers.",
    "",
    "USE THIS TOOL WHEN:",
    "- User provides a Sentry URL (any type: issue, event, trace, profile, replay, monitor, release)",
    "- User wants to fetch a specific resource by type and ID",
    "",
    "FULLY SUPPORTED:",
    "- **issue**: Fetch issue details by ID",
    "- **event**: Fetch specific event within an issue",
    "- **trace**: Fetch trace details (supports span focus from URL)",
    "- **profile**: Fetch and analyze CPU profiling data",
    "",
    "URL RECOGNIZED (returns helpful guidance):",
    "- **replay**: Session replay URLs",
    "- **monitor**: Cron monitor URLs",
    "- **release**: Release URLs",
    "",
    "<examples>",
    "### URL mode (auto-detect type)",
    "```",
    "get_sentry_resource(url='https://my-org.sentry.io/issues/PROJECT-123')",
    "get_sentry_resource(url='https://my-org.sentry.io/explore/traces/trace/abc123...')",
    "get_sentry_resource(url='https://my-org.sentry.io/replays/def456...')",
    "```",
    "",
    "### Explicit mode - Issue",
    "```",
    "get_sentry_resource(",
    "  resourceType='issue',",
    "  organizationSlug='my-org',",
    "  issueId='PROJECT-123'",
    ")",
    "```",
    "",
    "### Explicit mode - Trace",
    "```",
    "get_sentry_resource(",
    "  resourceType='trace',",
    "  organizationSlug='my-org',",
    "  traceId='a4d1aae7216b47ff8117cf4e09ce9d0a'",
    ")",
    "```",
    "</examples>",
    "",
    "<hints>",
    "- URL mode is simplest: just pass the Sentry URL and the tool auto-detects the resource type",
    "- For explicit mode, required params depend on resourceType:",
    "  - issue: organizationSlug, issueId",
    "  - event: organizationSlug, issueId, eventId",
    "  - trace: organizationSlug, traceId",
    "  - profile: organizationSlug, projectSlug, transactionName",
    "</hints>",
  ].join("\n"),

  inputSchema: {
    // Mode 1: URL-based (auto-detect type)
    url: z
      .string()
      .url()
      .optional()
      .describe(
        "Sentry URL. Auto-detects resource type (issue, event, trace, profile, replay, monitor, release) from URL pattern.",
      ),

    // Mode 2: Explicit type + identifier
    resourceType: z
      .enum(["issue", "event", "trace", "profile"])
      .optional()
      .describe(
        "Resource type when not using URL. Required params depend on type.",
      ),

    organizationSlug: ParamOrganizationSlug.optional(),
    regionUrl: ParamRegionUrl.nullable().default(null),

    // Issue/Event identifiers
    issueId: z
      .string()
      .toUpperCase()
      .trim()
      .optional()
      .describe(
        "Issue ID (e.g., 'PROJECT-123'). Required for issue/event types.",
      ),
    eventId: z
      .string()
      .trim()
      .optional()
      .describe("Event ID. Required for event type."),

    // Trace identifier
    traceId: z
      .string()
      .trim()
      .optional()
      .describe("Trace ID (32-char hex string). Required for trace type."),

    // Profile identifiers
    projectSlug: z
      .string()
      .toLowerCase()
      .trim()
      .optional()
      .describe("Project slug. Required for profile type."),
    profilerId: z
      .string()
      .trim()
      .optional()
      .describe("Profiler ID (optional for profile type)."),
    transactionName: z
      .string()
      .trim()
      .optional()
      .describe(
        "Transaction name (e.g., 'GET /api/users'). Required for profile type.",
      ),
  },

  annotations: { readOnlyHint: true, openWorldHint: true },

  async handler(params, context: ServerContext) {
    // Resolve params from URL or explicit values
    const resolved = resolveResourceParams({
      url: params.url,
      resourceType: params.resourceType,
      organizationSlug: params.organizationSlug,
      issueId: params.issueId,
      eventId: params.eventId,
      traceId: params.traceId,
      projectSlug: params.projectSlug,
      profilerId: params.profilerId,
      transactionName: params.transactionName,
    });

    setTag("resource.type", resolved.type);
    setTag("organization.slug", resolved.organizationSlug);

    // Handle recognized but not fully supported types
    if (
      resolved.type === "replay" ||
      resolved.type === "monitor" ||
      resolved.type === "release"
    ) {
      return generateUnsupportedResourceMessage(resolved);
    }

    // Dispatch to the appropriate handler for fully supported types
    // After the above check, resolved.type is narrowed to FullySupportedType
    switch (resolved.type) {
      case "issue":
        return getIssueDetails.handler(
          {
            organizationSlug: resolved.organizationSlug,
            issueId: resolved.issueId,
            regionUrl: params.regionUrl,
          },
          context,
        );

      case "event":
        return getIssueDetails.handler(
          {
            organizationSlug: resolved.organizationSlug,
            issueId: resolved.issueId,
            eventId: resolved.eventId,
            regionUrl: params.regionUrl,
          },
          context,
        );

      case "trace":
        return getTraceDetails.handler(
          {
            organizationSlug: resolved.organizationSlug,
            traceId: resolved.traceId!,
            regionUrl: params.regionUrl,
          },
          context,
        );

      case "profile":
        return getProfile.handler(
          {
            organizationSlug: resolved.organizationSlug,
            projectSlugOrId: resolved.projectSlug,
            transactionName: resolved.transactionName,
            regionUrl: params.regionUrl,
            // Use defaults for optional profile params
            statsPeriod: "7d",
            focusOnUserCode: true,
            maxHotPaths: 10,
          },
          context,
        );

      default: {
        // TypeScript exhaustiveness check - this should never be reached
        const _exhaustiveCheck: never = resolved.type;
        throw new Error(`Unhandled resource type: ${_exhaustiveCheck}`);
      }
    }
  },
});
