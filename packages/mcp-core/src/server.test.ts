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
    // Note: Experimental filtering is applied consistently to both default and custom tools.
    // Tools marked with `experimental: true` are only shown when `experimentalMode: true`.
    // Tools marked with `hideInExperimentalMode: true` are hidden when `experimentalMode: true`.

    it("filters experimental custom tools when experimentalMode is false", () => {
      // Experimental filtering applies to all tools, including custom ones
      const server = buildServer({
        context: baseContext,
        experimentalMode: false,
        tools: {
          regular_tool: createMockTool("regular_tool"),
          experimental_tool: createMockTool("experimental_tool", {
            experimental: true,
          }),
        },
      });

      const toolNames = getRegisteredToolNames(server);
      // Regular tool should be visible, experimental tool should be hidden
      expect(toolNames).toContain("regular_tool");
      expect(toolNames).not.toContain("experimental_tool");
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

  describe("capability-based tool filtering (experimental)", () => {
    it("hides tools when project lacks required capabilities", () => {
      const server = buildServer({
        experimentalMode: true,
        context: {
          ...baseContext,
          constraints: {
            organizationSlug: "test-org",
            projectSlug: "test-project",
            projectCapabilities: {
              profiles: false,
              replays: false,
              logs: false,
              traces: false,
            },
          },
        },
        tools: {
          tool_with_caps: createMockTool("tool_with_caps", {
            requiredCapabilities: ["profiles"],
          }),
          tool_without_caps: createMockTool("tool_without_caps"),
        },
      });

      const toolNames = getRegisteredToolNames(server);
      // Tool with unmet capability requirement should be hidden
      expect(toolNames).not.toContain("tool_with_caps");
      // Tool without capability requirements should be visible
      expect(toolNames).toContain("tool_without_caps");
    });

    it("shows tools when project has required capabilities", () => {
      const server = buildServer({
        experimentalMode: true,
        context: {
          ...baseContext,
          constraints: {
            organizationSlug: "test-org",
            projectSlug: "test-project",
            projectCapabilities: {
              profiles: true,
              replays: false,
              logs: false,
              traces: true,
            },
          },
        },
        tools: {
          profile_tool: createMockTool("profile_tool", {
            requiredCapabilities: ["profiles"],
          }),
          trace_tool: createMockTool("trace_tool", {
            requiredCapabilities: ["traces"],
          }),
          replay_tool: createMockTool("replay_tool", {
            requiredCapabilities: ["replays"],
          }),
        },
      });

      const toolNames = getRegisteredToolNames(server);
      // Tools with met capability requirements should be visible
      expect(toolNames).toContain("profile_tool");
      expect(toolNames).toContain("trace_tool");
      // Tool with unmet capability requirement should be hidden
      expect(toolNames).not.toContain("replay_tool");
    });

    it("shows all tools when capabilities are unknown (fail-open)", () => {
      const server = buildServer({
        experimentalMode: true,
        context: {
          ...baseContext,
          constraints: {
            organizationSlug: "test-org",
            projectSlug: "test-project",
            projectCapabilities: null, // Capabilities unknown
          },
        },
        tools: {
          tool_with_caps: createMockTool("tool_with_caps", {
            requiredCapabilities: ["profiles"],
          }),
          tool_without_caps: createMockTool("tool_without_caps"),
        },
      });

      const toolNames = getRegisteredToolNames(server);
      // All tools should be visible when capabilities are unknown (fail-open)
      expect(toolNames).toContain("tool_with_caps");
      expect(toolNames).toContain("tool_without_caps");
    });

    it("shows all tools when no project constraint is active", () => {
      const server = buildServer({
        experimentalMode: true,
        context: {
          ...baseContext,
          constraints: {
            organizationSlug: "test-org",
            projectSlug: null, // No project constraint
            projectCapabilities: null,
          },
        },
        tools: {
          tool_with_caps: createMockTool("tool_with_caps", {
            requiredCapabilities: ["profiles"],
          }),
          tool_without_caps: createMockTool("tool_without_caps"),
        },
      });

      const toolNames = getRegisteredToolNames(server);
      // All tools should be visible when no project constraint is active
      expect(toolNames).toContain("tool_with_caps");
      expect(toolNames).toContain("tool_without_caps");
    });

    it("requires all capabilities when tool has multiple requirements", () => {
      const server = buildServer({
        experimentalMode: true,
        context: {
          ...baseContext,
          constraints: {
            organizationSlug: "test-org",
            projectSlug: "test-project",
            projectCapabilities: {
              profiles: true,
              replays: false, // One capability missing
              logs: false,
              traces: true,
            },
          },
        },
        tools: {
          multi_cap_tool: createMockTool("multi_cap_tool", {
            requiredCapabilities: ["profiles", "replays"],
          }),
        },
      });

      const toolNames = getRegisteredToolNames(server);
      // Tool should be hidden because not all required capabilities are present
      expect(toolNames).not.toContain("multi_cap_tool");
    });

    it("does not filter by capabilities when experimentalMode is false", () => {
      const server = buildServer({
        experimentalMode: false,
        context: {
          ...baseContext,
          constraints: {
            organizationSlug: "test-org",
            projectSlug: "test-project",
            projectCapabilities: {
              profiles: false,
              replays: false,
              logs: false,
              traces: false,
            },
          },
        },
        tools: {
          tool_with_caps: createMockTool("tool_with_caps", {
            requiredCapabilities: ["profiles"],
          }),
          tool_without_caps: createMockTool("tool_without_caps"),
        },
      });

      const toolNames = getRegisteredToolNames(server);
      // All tools should be visible when experimentalMode is false
      expect(toolNames).toContain("tool_with_caps");
      expect(toolNames).toContain("tool_without_caps");
    });
  });

  describe("hideInExperimentalMode filtering", () => {
    it("hides tools with hideInExperimentalMode when experimentalMode is true", () => {
      const server = buildServer({
        context: baseContext,
        experimentalMode: true,
        tools: {
          regular_tool: createMockTool("regular_tool"),
          hidden_in_experimental: createMockTool("hidden_in_experimental", {
            hideInExperimentalMode: true,
          }),
          experimental_tool: createMockTool("experimental_tool", {
            experimental: true,
          }),
        },
      });

      const toolNames = getRegisteredToolNames(server);
      // Regular tool should be visible
      expect(toolNames).toContain("regular_tool");
      // Tool marked hideInExperimentalMode should be hidden
      expect(toolNames).not.toContain("hidden_in_experimental");
      // Experimental tool should be visible in experimental mode
      expect(toolNames).toContain("experimental_tool");
    });

    it("shows tools with hideInExperimentalMode when experimentalMode is false", () => {
      const server = buildServer({
        context: baseContext,
        experimentalMode: false,
        tools: {
          regular_tool: createMockTool("regular_tool"),
          hidden_in_experimental: createMockTool("hidden_in_experimental", {
            hideInExperimentalMode: true,
          }),
        },
      });

      const toolNames = getRegisteredToolNames(server);
      // Both tools should be visible when not in experimental mode
      expect(toolNames).toContain("regular_tool");
      expect(toolNames).toContain("hidden_in_experimental");
    });

    it("correctly filters tools with both experimental and hideInExperimentalMode", () => {
      // This is an edge case - a tool shouldn't have both flags, but we test the behavior anyway
      const server = buildServer({
        context: baseContext,
        experimentalMode: true,
        tools: {
          both_flags: createMockTool("both_flags", {
            experimental: true,
            hideInExperimentalMode: true,
          }),
        },
      });

      const toolNames = getRegisteredToolNames(server);
      // hideInExperimentalMode takes precedence - tool should be hidden
      expect(toolNames).not.toContain("both_flags");
    });
  });

  describe("dynamic descriptions", () => {
    it("resolves function descriptions with context", () => {
      const dynamicDescription = vi.fn((ctx: { experimentalMode: boolean }) =>
        ctx.experimentalMode
          ? "Experimental description"
          : "Normal description",
      );

      buildServer({
        context: baseContext,
        experimentalMode: true,
        tools: {
          dynamic_tool: createMockTool("dynamic_tool", {
            description: dynamicDescription,
          }),
        },
      });

      // The description function should be called with the correct context
      expect(dynamicDescription).toHaveBeenCalledWith({
        experimentalMode: true,
      });
    });

    it("passes static descriptions unchanged", () => {
      // This test verifies that static string descriptions work as expected
      const server = buildServer({
        context: baseContext,
        experimentalMode: false,
        tools: {
          static_tool: createMockTool("static_tool", {
            description: "Static description",
          }),
        },
      });

      const toolNames = getRegisteredToolNames(server);
      expect(toolNames).toContain("static_tool");
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
