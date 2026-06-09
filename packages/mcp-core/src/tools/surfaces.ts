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
  "find_projects",
  "update_issue",
  "search_events",
  "analyze_issue_with_seer",
  "search_docs",
  "search_issues",
  "get_sentry_resource",
  ...CATALOG_INFRASTRUCTURE_TOOL_NAMES,
] as const;

// The experimental direct surface is intentionally aligned with the default
// surface now that search_tools and execute_tool are primary primitives.
export const EXPERIMENTAL_TOP_LEVEL_TOOL_NAMES = TOP_LEVEL_TOOL_NAMES;

const topLevelToolNames = new Set<string>(TOP_LEVEL_TOOL_NAMES);
const wrapperToolNames = new Set<string>(WRAPPER_TOOL_NAMES);
const catalogInfrastructureToolNames = new Set<string>(
  CATALOG_INFRASTRUCTURE_TOOL_NAMES,
);

export type TopLevelToolName =
  | (typeof TOP_LEVEL_TOOL_NAMES)[number]
  | (typeof EXPERIMENTAL_TOP_LEVEL_TOOL_NAMES)[number];

export function isOutsideCatalogToolName(toolName: string): boolean {
  return (
    wrapperToolNames.has(toolName) ||
    catalogInfrastructureToolNames.has(toolName)
  );
}

export function isDefaultTopLevelToolName(toolName: string): boolean {
  return topLevelToolNames.has(toolName);
}

export function isTopLevelToolName(
  toolName: string,
  _experimentalMode: boolean,
): boolean {
  return topLevelToolNames.has(toolName);
}

export function getTopLevelToolNames({
  experimentalMode: _experimentalMode,
}: {
  experimentalMode: boolean;
}): readonly TopLevelToolName[] {
  return TOP_LEVEL_TOOL_NAMES;
}

export function isWrapperToolName(toolName: string): boolean {
  return wrapperToolNames.has(toolName);
}

export function isCatalogInfrastructureToolName(toolName: string): boolean {
  return catalogInfrastructureToolNames.has(toolName);
}
