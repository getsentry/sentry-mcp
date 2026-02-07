/**
 * Reusable Zod parameter schemas for MCP tools.
 *
 * Shared validation schemas used across tool definitions to ensure consistent
 * parameter handling and validation. Each schema includes transformation
 * (e.g., toLowerCase, trim) and LLM-friendly descriptions.
 */
import { z } from "zod";
import { SENTRY_GUIDES } from "./constants";
import { validateSlug } from "./utils/slug-validation";

export const ParamOrganizationSlug = z
  .string()
  .toLowerCase()
  .trim()
  .superRefine(validateSlug)
  .describe(
    "The organization's slug. You can find a existing list of organizations you have access to using the `find_organizations()` tool.",
  );

export const ParamTeamSlug = z
  .string()
  .toLowerCase()
  .trim()
  .superRefine(validateSlug)
  .describe(
    "The team's slug. You can find a list of existing teams in an organization using the `find_teams()` tool.",
  );

export const ParamProjectSlug = z
  .string()
  .toLowerCase()
  .trim()
  .superRefine(validateSlug)
  .describe(
    "The project's slug. You can find a list of existing projects in an organization using the `find_projects()` tool.",
  );

export const ParamProjectSlugOrAll = z
  .string()
  .toLowerCase()
  .trim()
  .superRefine(validateSlug)
  .describe(
    "The project's slug. This will default to all projects you have access to. It is encouraged to specify this when possible.",
  );

export const ParamSearchQuery = z
  .string()
  .trim()
  .describe(
    "Search query to filter results by name or slug. Use this to narrow down results when there are many items.",
  );

export const ParamIssueShortId = z
  .string()
  .toUpperCase()
  .trim()
  .describe("The Issue ID. e.g. `PROJECT-1Z43`");

export const ParamIssueUrl = z
  .string()
  .url()
  .trim()
  .describe(
    "The URL of the issue. e.g. https://my-organization.sentry.io/issues/PROJECT-1Z43",
  );

export const ParamTraceId = z
  .string()
  .trim()
  .regex(
    /^[0-9a-fA-F]{32}$/,
    "Trace ID must be a 32-character hexadecimal string",
  )
  .describe("The trace ID. e.g. `a4d1aae7216b47ff8117cf4e09ce9d0a`");

export const ParamPlatform = z
  .string()
  .toLowerCase()
  .trim()
  .describe(
    "The platform for the project. e.g., python, javascript, react, etc.",
  );

export const ParamTransaction = z
  .string()
  .trim()
  .describe("The transaction name. Also known as the endpoint, or route name.");

export const ParamQuery = z
  .string()
  .trim()
  .describe(
    `The search query to apply. Use the \`help(subject="query_syntax")\` tool to get more information about the query syntax rather than guessing.`,
  );

/**
 * Region URL parameter for Sentry API requests.
 *
 * Handles region-specific URLs for Sentry's Cloud Service while gracefully
 * supporting self-hosted Sentry installations that may return empty regionUrl values.
 * This schema accepts both valid URLs and empty strings to ensure compatibility
 * across different Sentry deployment types.
 */
export const ParamRegionUrl = z
  .string()
  .trim()
  .refine((value) => !value || z.string().url().safeParse(value).success, {
    message: "Must be a valid URL or empty string (for self-hosted Sentry)",
  })
  .describe(
    "The region URL for the organization you're querying, if known. " +
      "For Sentry's Cloud Service (sentry.io), this is typically the region-specific URL like 'https://us.sentry.io'. " +
      "For self-hosted Sentry installations, this parameter is usually not needed and should be omitted. " +
      "You can find the correct regionUrl from the organization details using the `find_organizations()` tool.",
  );

export const ParamIssueStatus = z
  .enum(["resolved", "resolvedInNextRelease", "unresolved", "ignored"])
  .describe(
    "The new status for the issue. Valid values are 'resolved', 'resolvedInNextRelease', 'unresolved', and 'ignored'.",
  );

export const ParamAssignedTo = z
  .string()
  .trim()
  .describe(
    "The assignee in format 'user:ID' or 'team:ID_OR_SLUG' where ID is numeric. Example: 'user:123456', 'team:789', or 'team:my-team-slug'. Use the whoami tool to find your user ID.",
  );

export const ParamSentryGuide = z
  .enum(SENTRY_GUIDES)
  .describe(
    "Optional guide filter to limit search results to specific documentation sections. " +
      "Use either a platform (e.g., 'javascript', 'python') or platform/guide combination (e.g., 'javascript/nextjs', 'python/django').",
  );

export const ParamEventId = z.string().trim().describe("The ID of the event.");

export const ParamAttachmentId = z
  .string()
  .trim()
  .describe("The ID of the attachment to download.");
