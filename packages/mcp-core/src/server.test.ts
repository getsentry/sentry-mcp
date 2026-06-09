import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { setUser } from "@sentry/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server";
import type { ToolConfig } from "./tools/types";
import type { ServerContext } from "./types";

// Mock the Sentry core module
vi.mock("@sentry/core", () => ({
  setTag: vi.fn(),
  setUser: vi.fn(),
  getActiveSpan: vi.fn(),
  wrapMcpServerWithSentry: vi.fn((server) => server),
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

async function listRegisteredTools(server: ReturnType<typeof buildServer>) {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: "server-test-client",
    version: "1.0.0",
  });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
    await server.close();
  }
}

async function callRegisteredTool(
  server: ReturnType<typeof buildServer>,
  name: string,
  args: Record<string, unknown>,
) {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: "server-test-client",
    version: "1.0.0",
  });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    return await client.callTool({ name, arguments: args });
  } finally {
    await client.close();
    await server.close();
  }
}

function getTextContent(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content;
  return content?.find((item) => typeof item.text === "string")?.text ?? "";
}

function getStructuredContent<T extends Record<string, unknown>>(
  result: unknown,
): T {
  const structuredContent = (result as { structuredContent?: unknown })
    .structuredContent;
  if (
    !structuredContent ||
    typeof structuredContent !== "object" ||
    Array.isArray(structuredContent)
  ) {
    throw new Error(`No structured content found: ${JSON.stringify(result)}`);
  }

  return structuredContent as T;
}

const DEFAULT_DIRECT_TOOL_NAMES = [
  "analyze_issue_with_seer",
  "execute_tool",
  "find_organizations",
  "find_projects",
  "get_sentry_resource",
  "search_events",
  "search_issues",
  "search_tools",
  "update_issue",
  "whoami",
].sort();
const DEFAULT_DIRECT_TOOL_NAMES_WITH_DOCS = [
  ...DEFAULT_DIRECT_TOOL_NAMES,
  "search_docs",
].sort();

describe("buildServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  describe("telemetry context", () => {
    it("sets user ID and IP address together for tool calls", async () => {
      const server = buildServer({
        context: {
          ...baseContext,
          userId: "user-123",
          userIpAddress: "192.0.2.1",
        },
        tools: {
          example_tool: createMockTool("example_tool", {
            annotations: { readOnlyHint: true },
          }),
        },
      });
      const registeredTools = (
        server as unknown as {
          _registeredTools: Record<
            string,
            {
              handler: (
                params: Record<string, unknown>,
                extra: unknown,
              ) => Promise<unknown>;
            }
          >;
        }
      )._registeredTools;

      await registeredTools.example_tool?.handler({}, {});

      expect(setUser).toHaveBeenCalledWith({
        id: "user-123",
        ip_address: "192.0.2.1",
      });
    });
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

  describe("capability-based tool filtering", () => {
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

    it("hides tools with unmet capabilities when experimentalMode is false", () => {
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
      expect(toolNames).not.toContain("tool_with_caps");
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
      const dynamicDescription = vi.fn(
        (ctx: {
          experimentalMode: boolean;
          availableToolNames?: ReadonlySet<string>;
          directToolNames?: ReadonlySet<string>;
        }) =>
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
      expect(dynamicDescription).toHaveBeenCalledWith(
        expect.objectContaining({
          experimentalMode: true,
          availableToolNames: expect.any(Set),
          directToolNames: expect.any(Set),
        }),
      );
      expect(
        dynamicDescription.mock.calls[0]![0].availableToolNames?.has(
          "dynamic_tool",
        ),
      ).toBe(true);
      expect(
        dynamicDescription.mock.calls[0]![0].directToolNames?.has(
          "dynamic_tool",
        ),
      ).toBe(true);
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
      expect(toolNames).toContain("get_sentry_resource");
      expect(toolNames).not.toContain("get_issue_details");
      expect(toolNames).not.toContain("get_trace_details");
      expect(toolNames).not.toContain("get_snapshot");
      expect(toolNames).not.toContain("get_snapshot_image");
      expect(toolNames).not.toContain("get_snapshot_details");
      expect(toolNames).toContain("search_tools");
      expect(toolNames).toContain("execute_tool");
      expect(toolNames.length).toBeGreaterThan(0);
    });

    it("includes catalog gateway tools when experimentalMode is false", () => {
      const server = buildServer({
        context: baseContext,
        experimentalMode: false,
      });

      const toolNames = getRegisteredToolNames(server);
      // Should still have tools, including get_sentry_resource in stable mode
      expect(toolNames).toContain("whoami");
      expect(toolNames).toContain("get_sentry_resource");
      expect(toolNames).not.toContain("get_issue_details");
      expect(toolNames).not.toContain("get_trace_details");
      expect(toolNames).toContain("search_tools");
      expect(toolNames).toContain("execute_tool");
    });

    it("includes all default tools when experimentalMode is true", () => {
      const server = buildServer({
        context: baseContext,
        experimentalMode: true,
      });

      const toolNames = getRegisteredToolNames(server);
      // Should have the standard tools
      expect(toolNames).toContain("whoami");
      expect(toolNames).toContain("get_sentry_resource");
      expect(toolNames).not.toContain("get_issue_details");
      expect(toolNames).not.toContain("get_trace_details");
      expect(toolNames).toContain("search_tools");
      expect(toolNames).toContain("execute_tool");
    });

    it("keeps get_sentry_resource available for legacy triage and seer skills", () => {
      for (const grantedSkills of [["triage"], ["seer"]] as const) {
        const server = buildServer({
          context: {
            ...baseContext,
            grantedSkills: new Set(grantedSkills),
          },
        });

        const toolNames = getRegisteredToolNames(server);
        expect(toolNames).toContain("get_sentry_resource");
        expect(toolNames).not.toContain("get_issue_details");
      }
    });

    it("discloses exactly the top-level tools allowed by granted skills through MCP tools/list", async () => {
      const server = buildServer({
        context: baseContext,
      });

      const registeredTools = await listRegisteredTools(server);
      const toolNames = registeredTools.map((tool) => tool.name).sort();

      expect(toolNames).toEqual(DEFAULT_DIRECT_TOOL_NAMES);
      expect(toolNames).toContain("search_tools");
      expect(toolNames).toContain("execute_tool");
      expect(toolNames).not.toContain("use_sentry");
      expect(toolNames).not.toContain("search_docs");
      expect(toolNames).not.toContain("get_doc");
      expect(toolNames).not.toContain("get_issue_details");
      expect(toolNames).not.toContain("get_trace_details");
      expect(toolNames).not.toContain("get_profile");
    });

    it("discloses docs tools through MCP tools/list when docs skill is granted", async () => {
      const server = buildServer({
        context: {
          ...baseContext,
          grantedSkills: new Set([
            "inspect",
            "triage",
            "project-management",
            "seer",
            "docs",
          ]),
        },
      });

      const registeredTools = await listRegisteredTools(server);
      const toolNames = registeredTools.map((tool) => tool.name).sort();

      expect(toolNames).toEqual(DEFAULT_DIRECT_TOOL_NAMES_WITH_DOCS);
      expect(toolNames).toContain("search_docs");
      expect(toolNames).not.toContain("get_doc");
      expect(toolNames).toContain("search_tools");
      expect(toolNames).toContain("execute_tool");
    });

    it("keeps the same direct tool surface in experimental mode", async () => {
      const defaultServer = buildServer({
        context: baseContext,
      });
      const experimentalServer = buildServer({
        context: baseContext,
        experimentalMode: true,
      });

      const defaultToolNames = (await listRegisteredTools(defaultServer))
        .map((tool) => tool.name)
        .sort();
      const experimentalToolNames = (
        await listRegisteredTools(experimentalServer)
      )
        .map((tool) => tool.name)
        .sort();

      expect(experimentalToolNames).toEqual(defaultToolNames);
      expect(experimentalToolNames).toEqual(DEFAULT_DIRECT_TOOL_NAMES);
    });

    it("advertises catalog gateway calls for snapshot image tools", async () => {
      const server = buildServer({
        context: {
          ...baseContext,
          grantedSkills: new Set([...baseContext.grantedSkills!, "preprod"]),
        },
      });

      const registeredTools = await listRegisteredTools(server);
      const getSentryResource = registeredTools.find(
        (tool) => tool.name === "get_sentry_resource",
      );

      expect(getSentryResource?.description).toContain(
        "search `search_tools(query='get_snapshot_image')`",
      );
      expect(getSentryResource?.description).toContain(
        "then call `execute_tool` with name `get_snapshot_image`",
      );
    });

    it("does not recommend unavailable catalog tools in generated runtime guidance", async () => {
      const server = buildServer({
        context: {
          ...baseContext,
          grantedSkills: new Set(["triage"]),
        },
        experimentalMode: true,
      });

      const result = await callRegisteredTool(server, "get_sentry_resource", {
        url: "https://my-org.sentry.io/releases/v1.2.3/",
      });
      const text = getTextContent(result);

      expect(text).toContain(
        "- **Find releases**: Release listing is not available in this session",
      );
      expect(text).not.toContain("find_releases(");
      expect(text).not.toContain(
        "search `search_tools(query='find_releases')`",
      );
    });

    it("keeps long-tail tools catalog-only by default", async () => {
      const server = buildServer({
        context: baseContext,
      });

      const toolNames = getRegisteredToolNames(server);

      expect(toolNames).not.toContain("create_project");
      expect(toolNames).not.toContain("find_releases");
      expect(toolNames).not.toContain("get_event_attachment");

      const result = await callRegisteredTool(server, "search_tools", {
        query: "create project",
        limit: 5,
      });
      const payload = getStructuredContent<{
        results: Array<{ name: string }>;
      }>(result);

      expect(payload.results.map((tool) => tool.name)).toContain(
        "create_project",
      );
    });

    it("discloses only use_sentry through MCP tools/list in agent mode", async () => {
      const server = buildServer({
        context: baseContext,
        agentMode: true,
      });

      const registeredTools = await listRegisteredTools(server);

      expect(registeredTools.map((tool) => tool.name)).toEqual(["use_sentry"]);
    });

    it("keeps preprod tools catalog-only while enforcing their skill gate", async () => {
      const withoutPreprod = buildServer({
        context: baseContext,
      });
      const withoutPreprodToolNames = getRegisteredToolNames(withoutPreprod);
      expect(withoutPreprodToolNames).not.toContain("get_snapshot");
      expect(withoutPreprodToolNames).not.toContain("get_snapshot_image");
      expect(withoutPreprodToolNames).not.toContain("get_latest_base_snapshot");

      const hiddenResult = await callRegisteredTool(
        withoutPreprod,
        "search_tools",
        {
          query: "snapshot",
          limit: 10,
        },
      );
      const hiddenPayload = getStructuredContent<{
        results: Array<{ name: string }>;
      }>(hiddenResult);
      expect(hiddenPayload.results.map((tool) => tool.name)).not.toContain(
        "get_snapshot",
      );

      const withPreprod = buildServer({
        context: {
          ...baseContext,
          grantedSkills: new Set([
            "inspect",
            "triage",
            "project-management",
            "seer",
            "preprod",
          ]),
        },
      });
      const withPreprodToolNames = getRegisteredToolNames(withPreprod);
      expect(withPreprodToolNames).not.toContain("get_snapshot");
      expect(withPreprodToolNames).not.toContain("get_snapshot_image");
      expect(withPreprodToolNames).not.toContain("get_latest_base_snapshot");

      const visibleResult = await callRegisteredTool(
        withPreprod,
        "search_tools",
        {
          query: "snapshot",
          limit: 10,
        },
      );
      const visiblePayload = getStructuredContent<{
        results: Array<{ name: string }>;
      }>(visibleResult);
      const catalogToolNames = visiblePayload.results.map((tool) => tool.name);
      expect(catalogToolNames).toContain("get_snapshot");
      expect(catalogToolNames).toContain("get_snapshot_image");
      expect(catalogToolNames).toContain("get_latest_base_snapshot");
    });

    it("exposes use_sentry safety annotations through tool metadata in agent mode", async () => {
      const server = buildServer({
        context: baseContext,
        agentMode: true,
      });

      const registeredTools = await listRegisteredTools(server);
      const useSentryTool = registeredTools.find(
        (tool) => tool.name === "use_sentry",
      );

      expect(useSentryTool).toMatchObject({
        name: "use_sentry",
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: true,
        },
      });
    });

    it("exposes catalog tools with conservative safety annotations", async () => {
      const server = buildServer({
        context: baseContext,
      });

      const registeredTools = await listRegisteredTools(server);
      const searchTools = registeredTools.find(
        (tool) => tool.name === "search_tools",
      );
      const executeTool = registeredTools.find(
        (tool) => tool.name === "execute_tool",
      );

      expect(searchTools).toMatchObject({
        name: "search_tools",
        outputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            results: { type: "array" },
          },
          required: ["query", "results"],
        },
        annotations: {
          readOnlyHint: true,
          openWorldHint: false,
        },
      });
      expect(executeTool).toMatchObject({
        name: "execute_tool",
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: true,
        },
      });
    });

    it("search_tools returns available tools with constrained schemas", async () => {
      const server = buildServer({
        context: {
          ...baseContext,
          constraints: {
            organizationSlug: "bound-org",
            projectSlug: null,
          },
        },
      });

      const result = await callRegisteredTool(server, "search_tools", {
        query: "replay",
        limit: 1,
      });
      const payload = getStructuredContent<{
        query: string;
        results: Array<
          {
            name: string;
            inputSchema: {
              properties?: Record<string, unknown>;
            };
          } & Record<string, unknown>
        >;
      }>(result);
      const firstResult = payload.results[0];

      expect(payload.query).toBe("replay");
      expect(getTextContent(result)).toBe(JSON.stringify(payload, null, 2));
      expect(getTextContent(result)).not.toContain("# Tool Search Results");
      expect(getTextContent(result)).not.toContain("```json");
      expect(firstResult?.name).toBe("get_replay_details");
      expect(Object.keys(firstResult ?? {}).sort()).toEqual([
        "annotations",
        "description",
        "inputSchema",
        "name",
      ]);
      expect(firstResult).not.toHaveProperty("requiredSkills");
      expect(firstResult).not.toHaveProperty("requiredScopes");
      expect(firstResult).not.toHaveProperty("skills");
      expect(firstResult?.inputSchema.properties).not.toHaveProperty(
        "organizationSlug",
      );
    });

    it("search_tools hides constraint-injected schema parameters", async () => {
      const server = buildServer({
        context: {
          ...baseContext,
          constraints: {
            organizationSlug: "sentry-mcp-evals",
            projectSlug: "cloudflare-mcp",
            regionUrl: "https://us.sentry.io",
          },
        },
      });

      const result = await callRegisteredTool(server, "search_tools", {
        query: "issues",
        limit: 10,
      });
      const payload = getStructuredContent<{
        results: Array<{
          name: string;
          inputSchema: {
            properties?: Record<string, unknown>;
          };
        }>;
      }>(result);
      const searchIssues = payload.results.find(
        (tool) => tool.name === "search_issues",
      );

      expect(searchIssues?.inputSchema.properties).not.toHaveProperty(
        "organizationSlug",
      );
      expect(searchIssues?.inputSchema.properties).not.toHaveProperty(
        "projectSlugOrId",
      );
      expect(searchIssues?.inputSchema.properties).not.toHaveProperty(
        "regionUrl",
      );
      expect(searchIssues?.inputSchema.properties).toHaveProperty("query");
    });

    it("search_tools includes catalog-only tools that are not directly registered", async () => {
      const server = buildServer({
        context: baseContext,
      });

      const toolNames = getRegisteredToolNames(server);
      expect(toolNames).not.toContain("get_issue_details");

      const result = await callRegisteredTool(server, "search_tools", {
        query: "issue details",
        limit: 5,
      });
      const payload = getStructuredContent<{
        results: Array<{ name: string }>;
      }>(result);

      expect(payload.results.map((tool) => tool.name)).toContain(
        "get_issue_details",
      );
    });

    it("search_tools and execute_tool enforce project capabilities by default", async () => {
      const server = buildServer({
        context: {
          ...baseContext,
          constraints: {
            organizationSlug: "sentry-mcp-evals",
            projectSlug: "cloudflare-mcp",
            projectCapabilities: {
              profiles: false,
              replays: false,
              logs: true,
              traces: true,
            },
          },
        },
      });

      const result = await callRegisteredTool(server, "search_tools", {
        query: "replay details",
        limit: 10,
      });
      const payload = getStructuredContent<{
        results: Array<{ name: string }>;
      }>(result);

      expect(payload.results.map((tool) => tool.name)).not.toContain(
        "get_replay_details",
      );
      const executeResult = await callRegisteredTool(server, "execute_tool", {
        name: "get_replay_details",
        arguments: {
          replayId: "7e07485f12f9416b8b1426260799b51f",
        },
      });

      expect(executeResult).toMatchObject({ isError: true });
      expect(getTextContent(executeResult)).toContain(
        'Tool "get_replay_details" is not available in this session',
      );
    });

    it("execute_tool dispatches to an available tool", async () => {
      const server = buildServer({
        context: baseContext,
      });

      const result = await callRegisteredTool(server, "execute_tool", {
        name: "find_organizations",
        arguments: {},
      });

      expect(getTextContent(result)).toContain("# Organizations");
    });

    it("execute_tool dispatches to a catalog-only tool", async () => {
      const server = buildServer({
        context: baseContext,
      });

      const toolNames = getRegisteredToolNames(server);
      expect(toolNames).not.toContain("get_issue_details");

      const result = await callRegisteredTool(server, "execute_tool", {
        name: "get_issue_details",
        arguments: {
          organizationSlug: "sentry-mcp-evals",
          issueId: "CLOUDFLARE-MCP-41",
        },
      });

      expect(getTextContent(result)).toContain(
        "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**",
      );
    });

    it("execute_tool injects constrained arguments for catalog-only tools", async () => {
      const server = buildServer({
        context: {
          ...baseContext,
          constraints: {
            organizationSlug: "sentry-mcp-evals",
            projectSlug: null,
            regionUrl: "https://us.sentry.io",
          },
        },
      });

      const result = await callRegisteredTool(server, "execute_tool", {
        name: "get_issue_details",
        arguments: {
          issueId: "CLOUDFLARE-MCP-41",
        },
      });

      expect(getTextContent(result)).toContain(
        "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**",
      );
    });

    it("exposes catalog-only tool safety annotations through search_tools", async () => {
      const server = buildServer({
        context: baseContext,
      });

      const registeredToolNames = getRegisteredToolNames(server);
      expect(registeredToolNames).not.toContain("get_profile_details");

      const result = await callRegisteredTool(server, "search_tools", {
        query: "profile details",
        limit: 5,
      });
      const payload = getStructuredContent<{
        results: Array<{
          name: string;
          annotations: Record<string, unknown>;
        }>;
      }>(result);
      const getProfileDetailsTool = payload.results.find(
        (tool) => tool.name === "get_profile_details",
      );

      expect(getProfileDetailsTool).toMatchObject({
        name: "get_profile_details",
        annotations: {
          readOnlyHint: true,
          openWorldHint: true,
        },
      });
    });

    it("removes constrained organizationSlug from catalog tool schemas", async () => {
      const server = buildServer({
        context: {
          ...baseContext,
          constraints: {
            organizationSlug: "bound-org",
            projectSlug: null,
          },
        },
      });

      const result = await callRegisteredTool(server, "search_tools", {
        query: "replay details",
        limit: 1,
      });
      const payload = getStructuredContent<{
        results: Array<{
          name: string;
          inputSchema: {
            properties?: Record<string, unknown>;
          };
        }>;
      }>(result);
      const replayTool = payload.results[0];

      expect(replayTool?.name).toBe("get_replay_details");
      expect(
        Object.keys(replayTool?.inputSchema.properties ?? {}).sort(),
      ).toEqual(["regionUrl", "replayId", "replayUrl"]);
    });
  });
});
