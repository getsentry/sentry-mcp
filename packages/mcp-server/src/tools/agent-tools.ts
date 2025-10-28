import useSentry from "./use-sentry/index";

/**
 * Agent-specific tools for the /mcp-agent endpoint.
 *
 * This is a specialized MCP server that exposes only the use_sentry tool,
 * designed for AI agents that need high-level Sentry operations.
 */
export default {
  use_sentry: useSentry,
} as const;

// Type export
export type AgentToolName = keyof typeof import("./agent-tools").default;
