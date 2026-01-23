import { describe, it, expect, vi } from "vitest";
import { buildServer } from "./server";
import type { ServerContext } from "./types";
import type { ToolConfig } from "./tools/types";

// Mock the Sentry core module
vi.mock("@sentry/core", () => ({
  setTag: vi.fn(),
  setUser: vi.fn(),
  getActiveSpan: vi.fn(),
  wrapMcpServerWithSentry: vi.fn((server) => server),
}));

// Mock the agent provider factory
vi.mock("./internal/agents/provider-factory", () => ({
  hasAgentProvider: vi.fn(() => false),
}));

/**
 * Helper to get registered tool names from an McpServer.
 * Uses the internal _registeredTools object which exists directly on McpServer instances.
 */
function getRegisteredToolNames(server: unknown): string[] {
  // _registeredTools is directly on the McpServer as an object
  const mcpServer = server as { _registeredTools?: Record<string, unknown> };
  const registeredTools = mcpServer._registeredTools;
  if (!registeredTools) {
    return [];
  }
  return Object.keys(registeredTools);
}

describe("buildServer", () => {
  const baseContext: ServerContext = {
    accessToken: "test-token",
    grantedSkills: new Set(["inspect", "triage", "project-management", "seer"]),
    constraints: {
      organizationSlug: null,
      projectSlug: null,
    },
    sentryHost: "sentry.io",
  };

  const createMockTool = (
    name: string,
    options: Partial<ToolConfig> = {},
  ): ToolConfig => ({
    name,
    description: `${name} description`,
    inputSchema: {},
    skills: ["inspect"],
    requiredScopes: [],
    annotations: {},
    handler: async () => "result",
    ...options,
  });

  describe("experimental tool filtering", () => {
    // Note: When custom tools are provided, experimental filtering is intentionally skipped
    // to give full control to the caller. These tests verify the behavior with custom tools.

    it("does not filter experimental custom tools (by design)", () => {
      // When custom tools are provided, the caller has full control
      // and experimental filtering is skipped
      const server = buildServer({
        context: baseContext,
        tools: {
          regular_tool: createMockTool("regular_tool"),
          experimental_tool: createMockTool("experimental_tool", {
            experimental: true,
          }),
        },
      });

      const toolNames = getRegisteredToolNames(server);
      // Both tools should be registered because custom tools bypass experimental filtering
      expect(toolNames).toContain("regular_tool");
      expect(toolNames).toContain("experimental_tool");
    });

    it("includes all tools with experimentalMode enabled", () => {
      const server = buildServer({
        context: baseContext,
        experimentalMode: true,
        tools: {
          regular_tool: createMockTool("regular_tool"),
          experimental_tool: createMockTool("experimental_tool", {
            experimental: true,
          }),
        },
      });

      const toolNames = getRegisteredToolNames(server);
      expect(toolNames).toContain("regular_tool");
      expect(toolNames).toContain("experimental_tool");
    });

    it("only registers use_sentry in agent mode", () => {
      // In agent mode, only use_sentry is registered, which handles all tools internally
      const server = buildServer({
        context: baseContext,
        agentMode: true,
        experimentalMode: false,
        tools: {
          use_sentry: createMockTool("use_sentry", { skills: [] }),
          experimental_tool: createMockTool("experimental_tool", {
            experimental: true,
          }),
        },
      });

      // In agent mode, only use_sentry should be registered
      const toolNames = getRegisteredToolNames(server);
      expect(toolNames).toContain("use_sentry");
      // experimental_tool is not registered because agent mode only registers use_sentry
      expect(toolNames).not.toContain("experimental_tool");
    });

    it("does not filter tools with experimental: false", () => {
      const server = buildServer({
        context: baseContext,
        tools: {
          tool_with_false: createMockTool("tool_with_false", {
            experimental: false,
          }),
          tool_without_flag: createMockTool("tool_without_flag"),
        },
      });

      const toolNames = getRegisteredToolNames(server);
      expect(toolNames).toContain("tool_with_false");
      expect(toolNames).toContain("tool_without_flag");
    });
  });

  describe("experimental tool filtering with default tools", () => {
    // Test that experimental filtering works when using default tools (no custom tools provided)
    // We verify this by checking that the default tools are filtered correctly

    it("uses default tools when no custom tools provided", () => {
      const server = buildServer({
        context: baseContext,
      });

      const toolNames = getRegisteredToolNames(server);
      // Should have standard tools like whoami
      expect(toolNames).toContain("whoami");
      // Currently no tools are marked as experimental, so all should be present
      expect(toolNames.length).toBeGreaterThan(0);
    });

    it("filters experimental default tools when experimentalMode is false", () => {
      // This test validates the filtering code path with default tools
      // Since no default tools are currently marked experimental, this verifies
      // the code runs without error
      const server = buildServer({
        context: baseContext,
        experimentalMode: false,
      });

      const toolNames = getRegisteredToolNames(server);
      // Should still have tools (none are currently experimental)
      expect(toolNames).toContain("whoami");
    });

    it("includes all default tools when experimentalMode is true", () => {
      const server = buildServer({
        context: baseContext,
        experimentalMode: true,
      });

      const toolNames = getRegisteredToolNames(server);
      // Should have the standard tools
      expect(toolNames).toContain("whoami");
    });
  });
});
