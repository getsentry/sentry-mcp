/**
 * Tool filtering utility for hiding tools based on regex patterns.
 *
 * This module provides functionality to filter out tools matching a regex pattern
 * from the SENTRY_DENIED_TOOLS_REGEX environment variable. Tools that match the
 * pattern are completely hidden from the MCP server response.
 */

/**
 * Filters tools based on a denied tools regex pattern.
 *
 * @param tools - Object mapping tool names to tool definitions
 * @param deniedToolsRegex - Regex pattern string to match against tool names
 * @returns Filtered tools object with denied tools removed
 *
 * @example
 * ```typescript
 * const tools = {
 *   whoami: toolDef,
 *   search_events: toolDef,
 *   find_issues: toolDef
 * };
 *
 * // Hide all search tools
 * const filtered = filterDeniedTools(tools, "^search_");
 * // Returns { whoami: toolDef, find_issues: toolDef }
 *
 * // Hide multiple patterns
 * const filtered2 = filterDeniedTools(tools, "(search_|find_)");
 * // Returns { whoami: toolDef }
 * ```
 */
export function filterDeniedTools<T extends Record<string, any>>(
  tools: T,
  deniedToolsRegex?: string,
): T {
  // If no regex provided, return all tools unchanged
  if (!deniedToolsRegex) {
    return tools;
  }

  try {
    const regex = new RegExp(deniedToolsRegex);
    const filtered = {} as T;

    for (const [toolName, toolDef] of Object.entries(tools)) {
      if (!regex.test(toolName)) {
        (filtered as any)[toolName] = toolDef;
      }
    }

    return filtered;
  } catch (error) {
    // If regex is invalid, log warning and return all tools
    console.warn(
      `[MCP] Invalid SENTRY_DENIED_TOOLS_REGEX pattern: "${deniedToolsRegex}". Error: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.warn(
      `[MCP] All tools will be available. Please check your regex pattern.`,
    );
    return tools;
  }
}
