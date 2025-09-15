import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { filterDeniedTools } from "./filter-denied-tools";

// Set up simple test environment without test-setup imports
vi.stubGlobal("console", {
  warn: vi.fn(),
  log: vi.fn(),
  error: vi.fn(),
});

describe("filterDeniedTools", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  const mockTools = {
    whoami: { name: "whoami", description: "Get user info" },
    search_events: { name: "search_events", description: "Search events" },
    search_issues: { name: "search_issues", description: "Search issues" },
    find_organizations: {
      name: "find_organizations",
      description: "Find orgs",
    },
    find_projects: { name: "find_projects", description: "Find projects" },
    get_doc: { name: "get_doc", description: "Get documentation" },
    update_issue: { name: "update_issue", description: "Update an issue" },
  };

  it("returns all tools when no regex provided", () => {
    const result = filterDeniedTools(mockTools);
    expect(result).toEqual(mockTools);
  });

  it("returns all tools when regex is undefined", () => {
    const result = filterDeniedTools(mockTools, undefined);
    expect(result).toEqual(mockTools);
  });

  it("filters tools matching regex pattern", () => {
    const result = filterDeniedTools(mockTools, "^search_");

    expect(result).toEqual({
      whoami: mockTools.whoami,
      find_organizations: mockTools.find_organizations,
      find_projects: mockTools.find_projects,
      get_doc: mockTools.get_doc,
      update_issue: mockTools.update_issue,
    });

    expect(result).not.toHaveProperty("search_events");
    expect(result).not.toHaveProperty("search_issues");
  });

  it("filters tools with multiple patterns", () => {
    const result = filterDeniedTools(mockTools, "(search_|find_)");

    expect(result).toEqual({
      whoami: mockTools.whoami,
      get_doc: mockTools.get_doc,
      update_issue: mockTools.update_issue,
    });

    expect(result).not.toHaveProperty("search_events");
    expect(result).not.toHaveProperty("search_issues");
    expect(result).not.toHaveProperty("find_organizations");
    expect(result).not.toHaveProperty("find_projects");
  });

  it("filters specific tools with exact match", () => {
    const result = filterDeniedTools(mockTools, "^(whoami|get_doc)$");

    expect(result).toEqual({
      search_events: mockTools.search_events,
      search_issues: mockTools.search_issues,
      find_organizations: mockTools.find_organizations,
      find_projects: mockTools.find_projects,
      update_issue: mockTools.update_issue,
    });

    expect(result).not.toHaveProperty("whoami");
    expect(result).not.toHaveProperty("get_doc");
  });

  it("returns empty object when all tools match pattern", () => {
    const result = filterDeniedTools(mockTools, ".*");
    expect(result).toEqual({});
  });

  it("handles invalid regex gracefully", () => {
    const invalidRegex = "[invalid";
    const result = filterDeniedTools(mockTools, invalidRegex);

    // Should return all tools when regex is invalid
    expect(result).toEqual(mockTools);

    // Should log warning
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        `[MCP] Invalid SENTRY_DENIED_TOOLS_REGEX pattern: "${invalidRegex}"`,
      ),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      "[MCP] All tools will be available. Please check your regex pattern.",
    );
  });

  it("handles empty tools object", () => {
    const result = filterDeniedTools({}, "search_");
    expect(result).toEqual({});
  });

  it("handles case-sensitive matching", () => {
    const result = filterDeniedTools(mockTools, "^SEARCH_");

    // Should not match lowercase tool names
    expect(result).toEqual(mockTools);
  });

  it("handles case-insensitive matching with flags", () => {
    const result = filterDeniedTools(mockTools, "(?i)^search_");

    expect(result).toEqual({
      whoami: mockTools.whoami,
      find_organizations: mockTools.find_organizations,
      find_projects: mockTools.find_projects,
      get_doc: mockTools.get_doc,
      update_issue: mockTools.update_issue,
    });
  });

  it("preserves original object structure", () => {
    const toolsWithMethods = {
      whoami: {
        name: "whoami",
        description: "Get user info",
        handler: () => "test",
        inputSchema: { param: "string" },
      },
      search_events: {
        name: "search_events",
        description: "Search events",
        handler: () => "test",
        inputSchema: { query: "string" },
      },
    };

    const result = filterDeniedTools(toolsWithMethods, "search_");

    expect(result).toEqual({
      whoami: toolsWithMethods.whoami,
    });
    expect(result.whoami).toHaveProperty("handler");
    expect(result.whoami).toHaveProperty("inputSchema");
  });
});
