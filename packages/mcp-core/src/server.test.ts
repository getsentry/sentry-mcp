import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer as ModernMcpServer } from "@modelcontextprotocol/server";
import { type Span, setUser, startSpan } from "@sentry/core";
import { mswServer } from "@sentry/mcp-server-mocks";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { structuredResult } from "./internal/tool-helpers/results";
import { buildServer } from "./server";
import type { Skill } from "./skills";
import {
  getGeneratedTextFromStructuredContent,
  getStructuredContent,
  getTextContent,
} from "./test-utils/structured-content";
import { createExecuteTool } from "./tools/special/execute-tool";
import type { ToolConfig } from "./tools/types";
import type { ServerContext } from "./types";

// Mock the Sentry core module
vi.mock("@sentry/core", () => ({
  setTag: vi.fn(),
  setUser: vi.fn(),
  getActiveSpan: vi.fn(),
  startSpan: vi.fn(),
  withScope: vi.fn((callback) =>
    callback({
      addAttachment: vi.fn(),
      setContext: vi.fn(),
    }),
  ),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  wrapMcpServerWithSentry: vi.fn((server) => server),
}));

function createMockSpan() {
  return {
    setAttribute: vi.fn(),
    setStatus: vi.fn(),
    recordException: vi.fn(),
  };
}

type MockSpan = ReturnType<typeof createMockSpan>;

let startedSpans: MockSpan[] = [];

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

const DEFAULT_DIRECT_TOOL_NAMES = [
  "analyze_issue_with_seer",
  "execute_sentry_tool",
  "find_organizations",
  "find_projects",
  "get_sentry_resource",
  "search_events",
  "search_issues",
  "search_sentry_tools",
  "update_issue",
].sort();

describe("buildServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startedSpans = [];
    vi.mocked(startSpan).mockImplementation((<T>(
      _options: Parameters<typeof startSpan>[0],
      callback: (span: Span) => T,
    ) => {
      const span = createMockSpan();
      startedSpans.push(span);
      return callback(span as unknown as Span);
    }) as typeof startSpan);
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

  it("registers and executes tools with the SDK v2 server", async () => {
    const server = buildServer({
      context: baseContext,
      tools: {
        v2_tool: createMockTool("v2_tool", {
          inputSchema: { value: z.string() },
          handler: async ({ value }) => `v2:${value}`,
        }),
      },
      sdkVersion: "v2",
    });

    expect(server).toBeInstanceOf(ModernMcpServer);
    const registeredTools = (
      server as unknown as {
        _registeredTools: Record<
          string,
          {
            handler: (params: Record<string, unknown>) => Promise<unknown>;
          }
        >;
      }
    )._registeredTools;

    expect(registeredTools.v2_tool).toBeDefined();
    await expect(
      registeredTools.v2_tool?.handler({ value: "ok" }),
    ).resolves.toMatchObject({
      content: [{ type: "text", text: "v2:ok" }],
    });
  });

  describe("telemetry context", () => {
    it("generates compatibility text for structured-only tool output", async () => {
      const server = buildServer({
        context: baseContext,
        tools: {
          structured_tool: createMockTool("structured_tool", {
            outputSchema: z.object({
              status: z.string(),
              count: z.number(),
            }),
            handler: async () =>
              structuredResult({
                status: "ok",
                count: 2,
              }),
          }),
        },
      });

      const result = await callRegisteredTool(server, "structured_tool", {});
      const payload = getStructuredContent<{
        status: string;
        count: number;
      }>(result);

      expect(payload).toMatchInlineSnapshot(`
        {
          "count": 2,
          "status": "ok",
        }
      `);
      expect(getTextContent(result)).toBe(
        getGeneratedTextFromStructuredContent(result),
      );
    });

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
      // whoami is available through the catalog, not as a direct tool.
      expect(toolNames).not.toContain("whoami");
      expect(toolNames).toContain("get_sentry_resource");
      expect(toolNames).not.toContain("get_issue_details");
      expect(toolNames).not.toContain("get_issue_breadcrumbs");
      expect(toolNames).not.toContain("get_trace_details");
      expect(toolNames).not.toContain("get_snapshot");
      expect(toolNames).not.toContain("get_snapshot_image");
      expect(toolNames).not.toContain("get_snapshot_details");
      expect(toolNames).toContain("search_sentry_tools");
      expect(toolNames).toContain("execute_sentry_tool");
      expect(toolNames.length).toBeGreaterThan(0);
    });

    it("includes catalog gateway tools when experimentalMode is false", () => {
      const server = buildServer({
        context: baseContext,
        experimentalMode: false,
      });

      const toolNames = getRegisteredToolNames(server);
      // Should still have tools, including get_sentry_resource in stable mode
      expect(toolNames).not.toContain("whoami");
      expect(toolNames).toContain("get_sentry_resource");
      expect(toolNames).not.toContain("get_issue_details");
      expect(toolNames).not.toContain("get_trace_details");
      expect(toolNames).toContain("search_sentry_tools");
      expect(toolNames).toContain("execute_sentry_tool");
    });

    it("includes all default tools when experimentalMode is true", () => {
      const server = buildServer({
        context: baseContext,
        experimentalMode: true,
      });

      const toolNames = getRegisteredToolNames(server);
      // whoami is available through the catalog, not as a direct tool.
      expect(toolNames).not.toContain("whoami");
      expect(toolNames).toContain("get_sentry_resource");
      expect(toolNames).not.toContain("get_issue_details");
      expect(toolNames).not.toContain("get_trace_details");
      expect(toolNames).toContain("search_sentry_tools");
      expect(toolNames).toContain("execute_sentry_tool");
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
      expect(toolNames).toContain("search_sentry_tools");
      expect(toolNames).toContain("execute_sentry_tool");
      expect(toolNames).not.toContain("whoami");
      expect(toolNames).not.toContain("use_sentry");
      expect(toolNames).not.toContain("search_docs");
      expect(toolNames).not.toContain("get_doc");
      expect(toolNames).not.toContain("get_issue_details");
      expect(toolNames).not.toContain("get_trace_details");
      expect(toolNames).not.toContain("get_profile");
    });

    it("keeps docs tools catalog-only and executable under inspect and legacy docs grants", async () => {
      const cases: Array<{
        grantedSkills: ReadonlySet<Skill>;
        expectedDirectTools: string[];
      }> = [
        {
          grantedSkills: new Set([
            "inspect",
            "triage",
            "project-management",
            "seer",
          ]),
          expectedDirectTools: DEFAULT_DIRECT_TOOL_NAMES,
        },
        {
          grantedSkills: new Set(["docs"]),
          expectedDirectTools: [
            "execute_sentry_tool",
            "find_organizations",
            "find_projects",
            "search_sentry_tools",
          ],
        },
      ] as const;

      for (const { grantedSkills, expectedDirectTools } of cases) {
        const listServer = buildServer({
          context: {
            ...baseContext,
            grantedSkills,
          },
        });
        const registeredTools = await listRegisteredTools(listServer);
        const toolNames = registeredTools.map((tool) => tool.name).sort();

        expect(toolNames).toEqual(expectedDirectTools);
        expect(toolNames).not.toContain("search_docs");
        expect(toolNames).not.toContain("get_doc");
        expect(toolNames).toContain("search_sentry_tools");
        expect(toolNames).toContain("execute_sentry_tool");

        const searchServer = buildServer({
          context: {
            ...baseContext,
            grantedSkills,
          },
        });
        const searchResult = await callRegisteredTool(
          searchServer,
          "search_sentry_tools",
          {
            query: "documentation",
            limit: 10,
          },
        );
        const payload = getStructuredContent<{
          results: Array<{ name: string }>;
        }>(searchResult);

        const catalogToolNames = payload.results.map((tool) => tool.name);
        expect(catalogToolNames).toContain("search_docs");
        expect(catalogToolNames).toContain("get_doc");

        const executeServer = buildServer({
          context: {
            ...baseContext,
            grantedSkills,
          },
        });
        const executeResult = await callRegisteredTool(
          executeServer,
          "execute_sentry_tool",
          {
            name: "get_doc",
            arguments: {
              path: "/product/rate-limiting.md",
            },
          },
        );

        expect(getTextContent(executeResult)).toContain(
          "# Project Rate Limits and Quotas",
        );
      }
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

    it("advertises Sentry tool guidance for snapshot image tools", async () => {
      const server = buildServer({
        context: baseContext,
      });

      const registeredTools = await listRegisteredTools(server);
      const getSentryResource = registeredTools.find(
        (tool) => tool.name === "get_sentry_resource",
      );

      expect(getSentryResource?.description).toContain(
        "Use the Sentry tool `get_snapshot_image` for full-resolution image bytes",
      );
    });

    it("does not advertise monitor resources when inspect tools are unavailable", async () => {
      const server = buildServer({
        context: {
          ...baseContext,
          grantedSkills: new Set(["triage"]),
        },
      });

      const registeredTools = await listRegisteredTools(server);
      const getSentryResource = registeredTools.find(
        (tool) => tool.name === "get_sentry_resource",
      );

      expect(getSentryResource?.description).toContain("replays");
      expect(getSentryResource?.description).not.toContain("monitors");
      expect(getSentryResource?.description).not.toContain(
        "- monitor: <monitorSlug>",
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
    });

    it("keeps long-tail tools catalog-only by default", async () => {
      const server = buildServer({
        context: baseContext,
      });

      const toolNames = getRegisteredToolNames(server);

      expect(toolNames).not.toContain("create_project");
      expect(toolNames).not.toContain("find_releases");
      expect(toolNames).not.toContain("get_event_attachment");
      expect(toolNames).not.toContain("get_event_stacktrace");

      const result = await callRegisteredTool(server, "search_sentry_tools", {
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

    it("keeps snapshot tools catalog-only while enforcing the inspect skill gate", async () => {
      const withoutInspect = buildServer({
        context: {
          ...baseContext,
          grantedSkills: new Set(["triage"]),
        },
      });
      const withoutInspectToolNames = getRegisteredToolNames(withoutInspect);
      expect(withoutInspectToolNames).not.toContain("get_snapshot");
      expect(withoutInspectToolNames).not.toContain("get_snapshot_image");
      expect(withoutInspectToolNames).not.toContain("get_latest_base_snapshot");

      const hiddenResult = await callRegisteredTool(
        withoutInspect,
        "search_sentry_tools",
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

      const withInspect = buildServer({
        context: baseContext,
      });
      const withInspectToolNames = getRegisteredToolNames(withInspect);
      expect(withInspectToolNames).not.toContain("get_snapshot");
      expect(withInspectToolNames).not.toContain("get_snapshot_image");
      expect(withInspectToolNames).not.toContain("get_latest_base_snapshot");

      const visibleResult = await callRegisteredTool(
        withInspect,
        "search_sentry_tools",
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
        (tool) => tool.name === "search_sentry_tools",
      );
      const executeTool = registeredTools.find(
        (tool) => tool.name === "execute_sentry_tool",
      );

      expect(searchTools).toMatchObject({
        name: "search_sentry_tools",
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
        name: "execute_sentry_tool",
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: true,
        },
      });
    });

    it("search_sentry_tools returns available tools with constrained schemas", async () => {
      const server = buildServer({
        context: {
          ...baseContext,
          constraints: {
            organizationSlug: "bound-org",
            projectSlug: null,
          },
        },
      });

      const result = await callRegisteredTool(server, "search_sentry_tools", {
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
      expect(getTextContent(result)).toBe(
        getGeneratedTextFromStructuredContent(result),
      );
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

    it("search_sentry_tools hides constraint-injected schema parameters", async () => {
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

      const result = await callRegisteredTool(server, "search_sentry_tools", {
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

    it("search_sentry_tools includes catalog-only tools that are not directly registered", async () => {
      const server = buildServer({
        context: baseContext,
      });

      const toolNames = getRegisteredToolNames(server);
      expect(toolNames).not.toContain("get_issue_details");
      expect(toolNames).not.toContain("get_event_stacktrace");

      const result = await callRegisteredTool(server, "search_sentry_tools", {
        query: "event stacktrace",
        limit: 5,
      });
      const payload = getStructuredContent<{
        results: Array<{ name: string }>;
      }>(result);

      const resultNames = payload.results.map((tool) => tool.name);
      expect(resultNames).toContain("get_issue_details");
      expect(resultNames).toContain("get_event_stacktrace");
    });

    it("search_sentry_tools includes whoami as a catalog-only foundational tool", async () => {
      const server = buildServer({
        context: {
          ...baseContext,
          grantedSkills: new Set(["inspect"]),
        },
      });

      const toolNames = getRegisteredToolNames(server);
      expect(toolNames).not.toContain("whoami");

      const result = await callRegisteredTool(server, "search_sentry_tools", {
        query: "authenticated user",
        limit: 10,
      });
      const payload = getStructuredContent<{
        results: Array<{ name: string }>;
      }>(result);

      expect(payload.results.map((tool) => tool.name)).toContain("whoami");
    });

    it("search_sentry_tools omits unavailable non-inspect tools", async () => {
      const inspectSeerServer = buildServer({
        context: {
          ...baseContext,
          grantedSkills: new Set(["inspect", "seer"]),
        },
      });
      for (const [toolName, grantedSkills] of [
        ["add_issue_note", ["triage"]],
        ["update_issue", ["triage"]],
        ["create_project", ["project-management"]],
        ["create_team", ["project-management"]],
        ["update_project", ["project-management"]],
        ["add_team_to_project", ["project-management"]],
        ["remove_team_from_project", ["project-management"]],
        ["create_dsn", ["project-management"]],
        ["find_dsns", ["project-management"]],
      ] as const) {
        const grantedServer = buildServer({
          context: {
            ...baseContext,
            grantedSkills: new Set(grantedSkills),
          },
        });
        const grantedResult = await callRegisteredTool(
          grantedServer,
          "search_sentry_tools",
          {
            query: toolName,
            limit: 10,
          },
        );
        const grantedPayload = getStructuredContent<{
          results: Array<{ name: string }>;
        }>(grantedResult);
        expect(grantedPayload.results.map((tool) => tool.name)).toContain(
          toolName,
        );

        const inspectSeerResult = await callRegisteredTool(
          inspectSeerServer,
          "search_sentry_tools",
          {
            query: toolName,
            limit: 10,
          },
        );
        const inspectSeerPayload = getStructuredContent<{
          results: Array<{ name: string }>;
        }>(inspectSeerResult);
        expect(
          inspectSeerPayload.results.map((tool) => tool.name),
        ).not.toContain(toolName);
      }
    });

    it("execute_sentry_tool rejects unavailable non-inspect tools", async () => {
      const server = buildServer({
        context: {
          ...baseContext,
          grantedSkills: new Set(["inspect", "seer"]),
        },
      });

      const result = await callRegisteredTool(server, "execute_sentry_tool", {
        name: "update_issue",
        arguments: {
          organizationSlug: "sentry-mcp-evals",
          issueId: "CLOUDFLARE-MCP-41",
          status: "resolved",
        },
      });

      expect(result).toMatchObject({ isError: true });
      expect(getTextContent(result)).toContain(
        'Tool "update_issue" is not available in this session',
      );
    });

    it("search_sentry_tools and execute_sentry_tool enforce project capabilities by default", async () => {
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

      const result = await callRegisteredTool(server, "search_sentry_tools", {
        query: "replay details",
        limit: 10,
      });
      const payload = getStructuredContent<{
        results: Array<{ name: string }>;
      }>(result);

      expect(payload.results.map((tool) => tool.name)).not.toContain(
        "get_replay_details",
      );
      const executeResult = await callRegisteredTool(
        server,
        "execute_sentry_tool",
        {
          name: "get_replay_details",
          arguments: {
            replayId: "7e07485f12f9416b8b1426260799b51f",
          },
        },
      );

      expect(executeResult).toMatchObject({ isError: true });
      expect(getTextContent(executeResult)).toContain(
        'Tool "get_replay_details" is not available in this session',
      );
    });

    it("execute_sentry_tool dispatches to an available tool", async () => {
      const server = buildServer({
        context: baseContext,
      });

      const result = await callRegisteredTool(server, "execute_sentry_tool", {
        name: "find_organizations",
        arguments: {},
      });

      expect(getTextContent(result)).toContain("# Organizations");
    });

    it("execute_sentry_tool dispatches to a catalog-only tool", async () => {
      const server = buildServer({
        context: baseContext,
      });

      const toolNames = getRegisteredToolNames(server);
      expect(toolNames).not.toContain("get_issue_details");

      const result = await callRegisteredTool(server, "execute_sentry_tool", {
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

    it("execute_sentry_tool dispatches to catalog-only event stacktrace", async () => {
      const server = buildServer({
        context: baseContext,
      });

      const toolNames = getRegisteredToolNames(server);
      expect(toolNames).not.toContain("get_event_stacktrace");

      const result = await callRegisteredTool(server, "execute_sentry_tool", {
        name: "get_event_stacktrace",
        arguments: {
          organizationSlug: "sentry-mcp-evals",
          issueId: "CLOUDFLARE-MCP-41",
        },
      });

      expect(getTextContent(result)).toContain(
        "# Event Stacktrace in **sentry-mcp-evals**",
      );
    });

    it("execute_sentry_tool dispatches to catalog-only issue user reports", async () => {
      const server = buildServer({
        context: baseContext,
      });

      const toolNames = getRegisteredToolNames(server);
      expect(toolNames).not.toContain("get_issue_user_reports");

      const result = await callRegisteredTool(server, "execute_sentry_tool", {
        name: "get_issue_user_reports",
        arguments: {
          organizationSlug: "sentry-mcp-evals",
          issueId: "CLOUDFLARE-MCP-41",
        },
      });

      expect(getTextContent(result)).toContain(
        "# Issue User Reports for Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**",
      );
    });

    it("execute_sentry_tool dispatches to catalog-only update_dsn", async () => {
      const server = buildServer({
        context: baseContext,
      });

      const toolNames = getRegisteredToolNames(server);
      expect(toolNames).not.toContain("update_dsn");

      const result = await callRegisteredTool(server, "execute_sentry_tool", {
        name: "update_dsn",
        arguments: {
          organizationSlug: "sentry-mcp-evals",
          projectSlug: "cloudflare-mcp",
          keyId: "d20df0a1ab5031c7f3c7edca9c02814d",
          rateLimitWindow: 3600,
          rateLimitCount: 0,
        },
      });

      expect(getTextContent(result)).toContain(
        "# Updated DSN in **sentry-mcp-evals/cloudflare-mcp**",
      );
      expect(getTextContent(result)).toContain("**Rate Limit**: Disabled");
    });

    it("execute_sentry_tool dispatches to catalog-only whoami", async () => {
      const server = buildServer({
        context: {
          ...baseContext,
          grantedSkills: new Set(["inspect"]),
        },
      });

      const toolNames = getRegisteredToolNames(server);
      expect(toolNames).not.toContain("whoami");

      const result = await callRegisteredTool(server, "execute_sentry_tool", {
        name: "whoami",
        arguments: {},
      });

      expect(getTextContent(result)).toContain("You are authenticated as");
    });

    it("execute_sentry_tool dispatches structured catalog results", async () => {
      mswServer.use(
        http.get(
          "https://sentry.io/api/0/organizations/test-org/ai-conversations/",
          ({ request }) => {
            const url = new URL(request.url);
            expect(url.searchParams.get("query")).toBe("checkout");
            expect(url.searchParams.get("statsPeriod")).toBe("7d");
            expect(url.searchParams.get("per_page")).toBe("10");
            return HttpResponse.json([
              {
                conversationId: "conv-123",
                flow: ["triage-agent"],
                errors: 1,
                llmCalls: 2,
                toolCalls: 1,
                toolErrors: 0,
                totalTokens: 1200,
                totalCost: 0.012,
                startTimestamp: 1713805400000,
                endTimestamp: 1713805415000,
                traceCount: 1,
                traceIds: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
                firstInput: "What failed in checkout?",
                lastOutput: "The checkout worker is timing out.",
                user: {
                  id: "1",
                  email: "dev@example.com",
                  username: "dev",
                  ip_address: "127.0.0.1",
                },
                toolNames: ["search_events"],
              },
            ]);
          },
        ),
      );
      const server = buildServer({
        context: {
          ...baseContext,
          grantedSkills: new Set(["inspect"]),
        },
      });

      const result = await callRegisteredTool(server, "execute_sentry_tool", {
        name: "search_ai_conversations",
        arguments: {
          organizationSlug: "test-org",
          query: "checkout",
          period: "7d",
          limit: 10,
        },
      });
      const payload = getStructuredContent<{
        conversations: Array<{
          conversationId: string;
          sampleTraceIds: string[];
        }>;
      }>(result);

      expect(payload.conversations).toMatchObject([
        {
          conversationId: "conv-123",
          sampleTraceIds: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
        },
      ]);
      expect(getTextContent(result)).toBe(
        getGeneratedTextFromStructuredContent(result),
      );
    });

    it("execute_sentry_tool passes effective arguments to a catalog tool", async () => {
      const handler = vi.fn(async (params: unknown) => {
        const parsed = params as {
          organizationSlug: string;
          filter: string;
          nested: { limit: number };
        };
        return `${parsed.organizationSlug}:${parsed.filter}:${parsed.nested.limit}`;
      });
      const registry: Record<string, ToolConfig> = {};
      registry.fake_catalog_tool = createMockTool("fake_catalog_tool", {
        inputSchema: {
          organizationSlug: z.string(),
          filter: z.string(),
          nested: z.object({ limit: z.number() }),
        },
        handler,
      });
      registry.execute_sentry_tool = createExecuteTool(() => registry);
      const server = buildServer({
        context: {
          ...baseContext,
          constraints: {
            organizationSlug: "bound-org",
            projectSlug: null,
          },
        },
        tools: registry,
      });

      const result = await callRegisteredTool(server, "execute_sentry_tool", {
        name: "fake_catalog_tool",
        arguments: {
          filter: "handled",
          nested: { limit: 3 },
        },
      });

      expect(getTextContent(result)).toBe("bound-org:handled:3");
      expect(handler).toHaveBeenCalledWith(
        {
          organizationSlug: "bound-org",
          filter: "handled",
          nested: { limit: 3 },
        },
        expect.any(Object),
      );
    });

    it("does not create a catalog child span for direct tool calls", async () => {
      const server = buildServer({
        context: baseContext,
        tools: {
          fake_catalog_tool: createMockTool("fake_catalog_tool", {
            handler: async () => "direct-result",
          }),
        },
      });

      const result = await callRegisteredTool(server, "fake_catalog_tool", {});

      expect(getTextContent(result)).toBe("direct-result");
      expect(startSpan).not.toHaveBeenCalled();
    });

    it("marks the catalog tool span as errored when execute_sentry_tool validation fails", async () => {
      const registry: Record<string, ToolConfig> = {};
      registry.fake_catalog_tool = createMockTool("fake_catalog_tool", {
        inputSchema: {
          requiredValue: z.string(),
        },
      });
      registry.execute_sentry_tool = createExecuteTool(() => registry);
      const server = buildServer({
        context: baseContext,
        tools: registry,
      });

      const result = await callRegisteredTool(server, "execute_sentry_tool", {
        name: "fake_catalog_tool",
        arguments: {},
      });

      expect(result).toMatchObject({ isError: true });
      expect(getTextContent(result)).toContain(
        "Invalid arguments for fake_catalog_tool",
      );
      expect(startSpan).toHaveBeenCalledWith(
        expect.objectContaining({
          attributes: expect.objectContaining({
            "gen_ai.tool.name": "fake_catalog_tool",
          }),
        }),
        expect.any(Function),
      );
      const span = startedSpans[0];
      expect(span?.setStatus).toHaveBeenCalledWith({ code: 2 });
      expect(span?.recordException).toHaveBeenCalledWith(expect.any(Error));
    });

    it("execute_sentry_tool injects constrained arguments for catalog-only tools", async () => {
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

      const result = await callRegisteredTool(server, "execute_sentry_tool", {
        name: "get_issue_details",
        arguments: {
          issueId: "CLOUDFLARE-MCP-41",
        },
      });

      expect(getTextContent(result)).toContain(
        "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**",
      );
    });

    it("exposes catalog-only tool safety annotations through search_sentry_tools", async () => {
      const server = buildServer({
        context: baseContext,
      });

      const registeredToolNames = getRegisteredToolNames(server);
      expect(registeredToolNames).not.toContain("get_profile_details");

      const result = await callRegisteredTool(server, "search_sentry_tools", {
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

      const result = await callRegisteredTool(server, "search_sentry_tools", {
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
