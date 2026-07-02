import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import useSentry from "./handler";
import type { ServerContext } from "../../../types";
import type { Skill } from "../../../skills";
import tools from "../../index";
import { getToolsForMcpRegistration } from "../../catalog-runtime/availability";
import { CATALOG_INFRASTRUCTURE_TOOL_NAMES } from "../../surfaces";

// Mock the embedded agent
vi.mock("./agent", () => ({
  useSentryAgent: vi.fn(),
}));

// Import the mocked module to get access to the mock function
import { useSentryAgent } from "./agent";
const mockUseSentryAgent = useSentryAgent as Mock;

// Use all skills for testing to ensure all tools are available
const ALL_SKILLS: Skill[] = [
  "inspect",
  "docs",
  "seer",
  "triage",
  "project-management",
];

const mockContext: ServerContext = {
  accessToken: "test-token",
  sentryHost: "sentry.io",
  userId: "1",
  clientId: "test-client",
  constraints: {},
  grantedSkills: new Set(ALL_SKILLS),
};

function getExpectedAgentToolNames(context: ServerContext): string[] {
  const toolsToExclude = new Set<string>([
    "use_sentry",
    ...CATALOG_INFRASTRUCTURE_TOOL_NAMES,
  ]);
  const allowWrites = context.allowEmbeddedAgentWrites === true;
  const toolsForAgent = Object.fromEntries(
    Object.entries(tools).filter(([key, tool]) => {
      if (toolsToExclude.has(key)) return false;
      if (allowWrites) return true;
      return tool.annotations.readOnlyHint === true;
    }),
  );

  return getToolsForMcpRegistration({
    tools: toolsForAgent,
    context,
    experimentalMode: context.experimentalMode ?? false,
    useDefaultSurfacePolicy: false,
  })
    .map(({ tool }) => tool.name)
    .sort();
}

function expectAgentToolNames(
  toolsArg: Record<string, unknown>,
  context: ServerContext,
) {
  expect(Object.keys(toolsArg).sort()).toEqual(
    getExpectedAgentToolNames(context),
  );
}

// Tools that mutate upstream state; must never reach the agent unless the
// trusted caller enables writes via context.
const WRITE_TOOL_NAMES = [
  "update_issue",
  "add_issue_note",
  "create_dsn",
  "update_dsn",
  "create_project",
  "update_project",
  "create_team",
] as const;

describe("use_sentry handler", () => {
  beforeEach(() => {
    mockUseSentryAgent.mockClear();
  });

  it("calls embedded agent with request and wrapped tools", async () => {
    mockUseSentryAgent.mockResolvedValue({
      result: {
        result: "Agent executed tools successfully",
      },
      toolCalls: [{ toolName: "whoami", args: {} }],
    });

    const result = await useSentry.handler(
      { request: "Show me unresolved issues", trace: null },
      mockContext,
    );

    // Verify agent was called
    expect(mockUseSentryAgent).toHaveBeenCalledWith({
      request: "Show me unresolved issues",
      tools: expect.objectContaining({
        whoami: expect.any(Object),
        find_organizations: expect.any(Object),
        get_sentry_resource: expect.any(Object),
        get_profile: expect.any(Object),
        search_issues: expect.any(Object),
        get_ai_conversation_details: expect.any(Object),
      }),
    });

    // Verify all operation tools available to this context were provided.
    const toolsArg = mockUseSentryAgent.mock.calls[0][0].tools;
    expectAgentToolNames(toolsArg, mockContext);

    // Verify result is returned
    expect(result).toBe("Agent executed tools successfully");
  });

  it("provides wrapped tools with ServerContext", async () => {
    mockUseSentryAgent.mockResolvedValue({
      result: {
        result: "Success",
      },
      toolCalls: [],
    });

    await useSentry.handler(
      { request: "test request", trace: null },
      mockContext,
    );

    // Verify tools were provided to agent
    const toolsArg = mockUseSentryAgent.mock.calls[0][0].tools;
    expect(toolsArg).toBeDefined();

    // Verify key tools are present
    expect(toolsArg.whoami).toBeDefined();
    expect(toolsArg.find_organizations).toBeDefined();
    expect(toolsArg.search_events).toBeDefined();
    expect(toolsArg.search_issues).toBeDefined();
    expect(toolsArg.get_sentry_resource).toBeDefined();
    expect(toolsArg.get_profile).toBeDefined();
    expect(toolsArg.get_issue_details).toBeDefined();
    expect(toolsArg.get_trace_details).toBeDefined();
  });

  it("filters capability-gated tools for the embedded agent in experimental mode", async () => {
    const projectConstrainedContext: ServerContext = {
      ...mockContext,
      experimentalMode: true,
      constraints: {
        organizationSlug: "constrained-org",
        projectSlug: "constrained-project",
        projectCapabilities: {
          profiles: false,
          replays: false,
          traces: false,
        },
      },
    };

    mockUseSentryAgent.mockResolvedValue({
      result: {
        result: "Success",
      },
      toolCalls: [],
    });

    await useSentry.handler(
      { request: "test capability filtering", trace: null },
      projectConstrainedContext,
    );

    const toolsArg = mockUseSentryAgent.mock.calls[0][0].tools;
    expect(toolsArg.search_issues).toBeDefined();
    expect(toolsArg.get_issue_details).toBeDefined();
    expect(toolsArg.get_profile).toBeUndefined();
    expect(toolsArg.get_profile_details).toBeUndefined();
    expect(toolsArg.get_replay_details).toBeUndefined();
    expect(toolsArg.get_trace_details).toBeUndefined();
  });

  it("excludes use_sentry from available tools to prevent recursion", async () => {
    mockUseSentryAgent.mockResolvedValue({
      result: {
        result: "Success",
      },
      toolCalls: [],
    });

    await useSentry.handler({ request: "test", trace: null }, mockContext);

    const toolsArg = mockUseSentryAgent.mock.calls[0][0].tools;
    const toolNames = Object.keys(toolsArg);

    // Verify use_sentry is NOT in the list
    expect(toolNames).not.toContain("use_sentry");

    expectAgentToolNames(toolsArg, mockContext);
  });

  it("filters find_organizations when organizationSlug constraint is set", async () => {
    const orgConstrainedContext: ServerContext = {
      ...mockContext,
      constraints: {
        organizationSlug: "constrained-org",
      },
    };

    mockUseSentryAgent.mockResolvedValue({
      result: {
        result: "Success with org constraint",
      },
      toolCalls: [],
    });

    await useSentry.handler(
      { request: "test with org constraint", trace: null },
      orgConstrainedContext,
    );

    const toolsArg = mockUseSentryAgent.mock.calls[0][0].tools;
    expect(toolsArg).toBeDefined();

    expectAgentToolNames(toolsArg, orgConstrainedContext);

    // Verify find_organizations is filtered but find_projects remains
    expect(toolsArg.find_organizations).toBeUndefined();
    expect(toolsArg.find_projects).toBeDefined();
  });

  it("filters both find tools when org and project constraints are set", async () => {
    const fullyConstrainedContext: ServerContext = {
      ...mockContext,
      constraints: {
        organizationSlug: "constrained-org",
        projectSlug: "constrained-project",
      },
    };

    mockUseSentryAgent.mockResolvedValue({
      result: {
        result: "Success with both constraints",
      },
      toolCalls: [],
    });

    await useSentry.handler(
      { request: "test with both constraints", trace: null },
      fullyConstrainedContext,
    );

    const toolsArg = mockUseSentryAgent.mock.calls[0][0].tools;
    expect(toolsArg).toBeDefined();

    expectAgentToolNames(toolsArg, fullyConstrainedContext);

    // Verify both find tools are filtered
    expect(toolsArg.find_organizations).toBeUndefined();
    expect(toolsArg.find_projects).toBeUndefined();
  });

  it("excludes write tools by default (read-only)", async () => {
    mockUseSentryAgent.mockResolvedValue({
      result: { result: "Success" },
      toolCalls: [],
    });

    await useSentry.handler(
      { request: "triage PROJ-1", trace: null },
      mockContext,
    );

    const toolsArg = mockUseSentryAgent.mock.calls[0][0].tools;

    // No write tool is reachable without an explicit context opt-in, even
    // though the context grants triage + project-management skills.
    for (const name of WRITE_TOOL_NAMES) {
      expect(
        toolsArg[name],
        `${name} must be excluded by default`,
      ).toBeUndefined();
    }
    expect(toolsArg.get_issue_details).toBeDefined();
    expect(toolsArg.search_issues).toBeDefined();
    expectAgentToolNames(toolsArg, mockContext);
  });

  it("only ever exposes read-only tools to the agent by default", async () => {
    // Generic guard for the whole surface: whatever the catalog grows to, an
    // embedded agent without an explicit write opt-in must never receive a tool
    // that is not readOnlyHint=true. This locks the indirect-injection boundary
    // so a new write tool can't silently become reachable.
    mockUseSentryAgent.mockResolvedValue({
      result: { result: "Success" },
      toolCalls: [],
    });

    await useSentry.handler(
      { request: "do whatever", trace: null },
      mockContext,
    );

    const toolsArg = mockUseSentryAgent.mock.calls[0][0].tools;
    const nonReadOnly = Object.keys(toolsArg).filter(
      (name) =>
        tools[name as keyof typeof tools]?.annotations.readOnlyHint !== true,
    );
    expect(nonReadOnly).toEqual([]);
  });

  it("exposes write tools only when context enables agent writes", async () => {
    const writeContext: ServerContext = {
      ...mockContext,
      allowEmbeddedAgentWrites: true,
    };

    mockUseSentryAgent.mockResolvedValue({
      result: { result: "Success" },
      toolCalls: [],
    });

    await useSentry.handler(
      { request: "resolve PROJ-1", trace: null },
      writeContext,
    );

    const toolsArg = mockUseSentryAgent.mock.calls[0][0].tools;

    expect(toolsArg.update_issue).toBeDefined();
    expect(toolsArg.add_issue_note).toBeDefined();
    expect(toolsArg.create_dsn).toBeDefined();
    expectAgentToolNames(toolsArg, writeContext);
  });
});
