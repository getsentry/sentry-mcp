/**
 * Reusable Zod parameter schemas for MCP tools.
 *
 * Shared validation schemas used across tool definitions to ensure consistent
 * parameter handling and validation. Each schema includes transformation
 * (e.g., toLowerCase, trim) and LLM-friendly descriptions.
 */
import { z } from "zod";

export const ParamOrganizationSlug = z
  .string()
  .toLowerCase()
  .trim()
  .describe(
    "The organization's slug. You can find a existing list of organizations you have access to using the `find_organizations()` tool.",
  );

export const ParamTeamSlug = z
  .string()
  .toLowerCase()
  .trim()
  .describe(
    "The team's slug. You can find a list of existing teams in an organization using the `find_teams()` tool.",
  );

export const ParamProjectSlug = z
  .string()
  .toLowerCase()
  .trim()
  .describe(
    "The project's slug. You can find a list of existing projects in an organization using the `find_projects()` tool.",
  );

export const ParamProjectSlugOrAll = z
  .string()
  .toLowerCase()
  .trim()
  .describe(
    "The project's slug. This will default to all projects you have access to. It is encouraged to specify this when possible.",
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

export const ParamRegionUrl = z
  .string()
  .trim()
  .describe("The region URL for the organization you're querying, if known.");

export const ParamIssueStatus = z
  .enum(["resolved", "resolvedInNextRelease", "unresolved", "ignored"])
  .describe(
    "The new status for the issue. Valid values are 'resolved', 'resolvedInNextRelease', 'unresolved', and 'ignored'.",
  );

export const ParamAssignedTo = z
  .string()
  .trim()
  .describe(
    "The username or team slug to assign the issue to. Use 'me' to assign to yourself, or provide a username/team slug.",
  );
