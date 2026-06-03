/**
 * Central policy for direct MCP exposure.
 *
 * Tool modules define behavior: name, description, schema, annotations, and
 * handler. Ordinary tools are catalog-eligible by default. This file only lists
 * wrapper/infrastructure tools outside the catalog and the explicit subset also
 * exposed through tools/list.
 */

export const CATALOG_INFRASTRUCTURE_TOOL_NAMES = [
  "search_tools",
  "execute_tool",
] as const;

export const WRAPPER_TOOL_NAMES = ["use_sentry"] as const;

export const TOP_LEVEL_TOOL_NAMES = [
  "whoami",
  "find_organizations",
  "find_teams",
  "find_projects",
  "find_releases",
  "get_issue_tag_values",
  "get_replay_details",
  "get_event_attachment",
  "update_issue",
  "search_events",
  "create_team",
  "create_project",
  "update_project",
  "create_dsn",
  "find_dsns",
  "analyze_issue_with_seer",
  "search_docs",
  "get_doc",
  "search_issues",
  "search_issue_events",
  "get_profile_details",
  "get_sentry_resource",
  ...CATALOG_INFRASTRUCTURE_TOOL_NAMES,
] as const;

const topLevelToolNames = new Set<string>(TOP_LEVEL_TOOL_NAMES);
const wrapperToolNames = new Set<string>(WRAPPER_TOOL_NAMES);
const catalogInfrastructureToolNames = new Set<string>(
  CATALOG_INFRASTRUCTURE_TOOL_NAMES,
);

export function isOutsideCatalogToolName(toolName: string): boolean {
  return (
    wrapperToolNames.has(toolName) ||
    catalogInfrastructureToolNames.has(toolName)
  );
}

export function isDefaultTopLevelToolName(toolName: string): boolean {
  return topLevelToolNames.has(toolName);
}

export function isWrapperToolName(toolName: string): boolean {
  return wrapperToolNames.has(toolName);
}

export function isCatalogInfrastructureToolName(toolName: string): boolean {
  return catalogInfrastructureToolNames.has(toolName);
}
