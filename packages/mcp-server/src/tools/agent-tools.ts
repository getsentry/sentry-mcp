import useSentry from "./use-sentry/index";

/**
 * Agent-specific tools for agent mode (/mcp?agent=1).
 *
 * When agent mode is enabled via query parameter, the MCP server exposes
 * only the use_sentry tool, designed for AI agents that need high-level
 * Sentry operations via natural language.
 */
export default {
  use_sentry: useSentry,
} as const;

// Type export
export type AgentToolName = keyof typeof import("./agent-tools").default;
