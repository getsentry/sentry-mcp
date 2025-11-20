import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import useSentry from "./handler";
import type { ServerContext } from "../../types";
import type { Scope } from "../../permissions";
import type { Skill } from "../../skills";

// Mock the embedded agent
vi.mock("./agent", () => ({
  useSentryAgent: vi.fn(),
}));

// Import the mocked module to get access to the mock function
import { useSentryAgent } from "./agent";
const mockUseSentryAgent = useSentryAgent as Mock;

// Use all scopes for testing to ensure all tools are available
const ALL_SCOPES: Scope[] = [
  "org:read",
  "org:write",
  "project:read",
  "project:write",
  "team:read",
  "team:write",
  "event:read",
  "event:write",
  "project:releases",
];

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
  grantedScopes: new Set(ALL_SCOPES),
  grantedSkills: new Set(ALL_SKILLS),
};

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
        search_issues: expect.any(Object),
      }),
    });

    // Verify all 19 tools were provided (20 total - use_sentry itself)
    const toolsArg = mockUseSentryAgent.mock.calls[0][0].tools;
    expect(Object.keys(toolsArg)).toHaveLength(19);

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
    expect(toolsArg.get_issue_details).toBeDefined();
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

    // Verify we have exactly 19 tools (20 total - 1 use_sentry)
    expect(toolNames).toHaveLength(19);
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

    // With only org constraint, find_organizations is filtered (19 - 1 = 18)
    expect(Object.keys(toolsArg)).toHaveLength(18);

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

    // When both org and project constraints are present,
    // find_organizations and find_projects are filtered out (19 - 2 = 17)
    expect(Object.keys(toolsArg)).toHaveLength(17);

    // Verify both find tools are filtered
    expect(toolsArg.find_organizations).toBeUndefined();
    expect(toolsArg.find_projects).toBeUndefined();
  });
});
