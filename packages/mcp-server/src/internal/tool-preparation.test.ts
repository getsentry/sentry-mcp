import { describe, it, expect } from "vitest";
import { z } from "zod";
import { prepareToolsForContext, applyConstraints } from "./tool-preparation";
import type { ServerContext } from "../types";
import type { ToolConfig } from "../tools/types";
import type { Scope } from "../permissions";

describe("prepareToolsForContext", () => {
  const mockContext: ServerContext = {
    accessToken: "test-token",
    sentryHost: "sentry.io",
    userId: "1",
    clientId: "test-client",
    constraints: {},
    grantedScopes: new Set<Scope>(["org:read", "project:read"]),
  };

  const mockTools: Record<string, ToolConfig<any>> = {
    tool_with_org: {
      name: "tool_with_org",
      description: "A tool that requires org",
      inputSchema: {
        organizationSlug: z.string(),
        query: z.string().optional(),
      },
      requiredScopes: ["org:read"],
      annotations: { readOnlyHint: true },
      handler: async () => "result",
    },
    tool_with_project: {
      name: "tool_with_project",
      description: "A tool that requires project",
      inputSchema: {
        organizationSlug: z.string(),
        projectSlugOrId: z.string(),
        query: z.string().optional(),
      },
      requiredScopes: ["project:read"],
      annotations: { readOnlyHint: true },
      handler: async () => "result",
    },
    tool_restricted: {
      name: "tool_restricted",
      description: "A tool requiring special scope",
      inputSchema: {
        data: z.string(),
      },
      requiredScopes: ["project:write"],
      annotations: { readOnlyHint: false },
      handler: async () => "result",
    },
  };

  it("filters tools by granted scopes", () => {
    const prepared = prepareToolsForContext(mockTools, mockContext);

    // Should include tools with org:read and project:read
    const keys = prepared.map((p) => p.key);
    expect(keys).toContain("tool_with_org");
    expect(keys).toContain("tool_with_project");

    // Should exclude tool requiring project:write (not granted)
    expect(keys).not.toContain("tool_restricted");
  });

  it("filters schema parameters based on constraints", () => {
    const contextWithConstraints: ServerContext = {
      ...mockContext,
      constraints: {
        organizationSlug: "constrained-org",
      },
    };

    const prepared = prepareToolsForContext(mockTools, contextWithConstraints);

    const orgTool = prepared.find((p) => p.key === "tool_with_org");
    expect(orgTool).toBeDefined();

    // organizationSlug should be filtered out
    expect("organizationSlug" in orgTool!.filteredInputSchema).toBe(false);
    // query should remain
    expect("query" in orgTool!.filteredInputSchema).toBe(true);
  });

  it("filters projectSlugOrId when projectSlug constraint is set", () => {
    const contextWithConstraints: ServerContext = {
      ...mockContext,
      constraints: {
        organizationSlug: "constrained-org",
        projectSlug: "constrained-project",
      },
    };

    const prepared = prepareToolsForContext(mockTools, contextWithConstraints);

    const projectTool = prepared.find((p) => p.key === "tool_with_project");
    expect(projectTool).toBeDefined();

    // Both organizationSlug and projectSlugOrId should be filtered
    expect("organizationSlug" in projectTool!.filteredInputSchema).toBe(false);
    expect("projectSlugOrId" in projectTool!.filteredInputSchema).toBe(false);
    // query should remain
    expect("query" in projectTool!.filteredInputSchema).toBe(true);
  });

  it("returns empty array when no tools match granted scopes", () => {
    const contextWithNoScopes: ServerContext = {
      ...mockContext,
      grantedScopes: new Set<Scope>(),
    };

    const prepared = prepareToolsForContext(mockTools, contextWithNoScopes);
    expect(prepared).toHaveLength(0);
  });

  it("preserves all schema fields when no constraints are set", () => {
    const prepared = prepareToolsForContext(mockTools, mockContext);

    const orgTool = prepared.find((p) => p.key === "tool_with_org");
    expect(orgTool).toBeDefined();

    // All fields should be present when no constraints
    expect("organizationSlug" in orgTool!.filteredInputSchema).toBe(true);
    expect("query" in orgTool!.filteredInputSchema).toBe(true);
  });
});

describe("applyConstraints", () => {
  const toolInputSchema = {
    organizationSlug: z.string(),
    projectSlugOrId: z.string().optional(),
    query: z.string().optional(),
    regionUrl: z.string().optional(),
  };

  it("injects organization constraint", () => {
    const params = { query: "is:unresolved" };
    const constraints = { organizationSlug: "my-org" };

    const result = applyConstraints(params, constraints, toolInputSchema);

    expect(result).toEqual({
      query: "is:unresolved",
      organizationSlug: "my-org",
    });
  });

  it("injects project constraint as projectSlugOrId alias", () => {
    const params = { query: "is:unresolved" };
    const constraints = {
      organizationSlug: "my-org",
      projectSlug: "my-project",
    };

    const result = applyConstraints(params, constraints, toolInputSchema);

    expect(result).toEqual({
      query: "is:unresolved",
      organizationSlug: "my-org",
      projectSlugOrId: "my-project",
    });
  });

  it("overwrites user-provided parameters with constraints (security)", () => {
    const params = {
      query: "is:unresolved",
      organizationSlug: "user-org", // User tries to access different org
    };
    const constraints = { organizationSlug: "constrained-org" };

    const result = applyConstraints(params, constraints, toolInputSchema);

    // Constraint MUST overwrite user param (security requirement)
    expect(result).toEqual({
      query: "is:unresolved",
      organizationSlug: "constrained-org",
    });
  });

  it("overwrites projectSlugOrId when projectSlug constraint is set (security)", () => {
    const params = {
      query: "is:unresolved",
      projectSlugOrId: "user-project", // User tries to access different project
    };
    const constraints = { projectSlug: "constrained-project" };

    const result = applyConstraints(params, constraints, toolInputSchema);

    // Constraint MUST overwrite user param (security requirement)
    expect(result).toEqual({
      query: "is:unresolved",
      projectSlugOrId: "constrained-project",
    });
  });

  it("applies multiple constraints together", () => {
    const params = { query: "is:unresolved" };
    const constraints = {
      organizationSlug: "my-org",
      projectSlug: "my-project",
      regionUrl: "https://us.sentry.io",
    };

    const result = applyConstraints(params, constraints, toolInputSchema);

    expect(result).toEqual({
      query: "is:unresolved",
      organizationSlug: "my-org",
      projectSlugOrId: "my-project",
      regionUrl: "https://us.sentry.io",
    });
  });

  it("ignores constraints for parameters not in schema", () => {
    const params = { query: "is:unresolved" };
    const constraints = {
      organizationSlug: "my-org",
      unknownParam: "some-value",
    } as any;

    const result = applyConstraints(params, constraints, toolInputSchema);

    // Unknown constraint should be ignored
    expect(result).toEqual({
      query: "is:unresolved",
      organizationSlug: "my-org",
    });
  });

  it("returns params unchanged when no constraints are set", () => {
    const params = {
      organizationSlug: "user-org",
      query: "is:unresolved",
    };
    const constraints = {};

    const result = applyConstraints(params, constraints, toolInputSchema);

    expect(result).toEqual(params);
  });

  it("handles null/undefined constraint values", () => {
    const params = { query: "is:unresolved" };
    const constraints = {
      organizationSlug: null,
      projectSlug: undefined,
    };

    const result = applyConstraints(
      params,
      constraints as any,
      toolInputSchema,
    );

    // Null/undefined constraints should not be injected
    expect(result).toEqual({
      query: "is:unresolved",
    });
  });
});
