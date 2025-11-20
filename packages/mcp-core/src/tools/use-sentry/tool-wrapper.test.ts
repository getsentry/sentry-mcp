import { describe, it, expect } from "vitest";
import { z } from "zod";
import { wrapToolForAgent } from "./tool-wrapper";
import type { ServerContext } from "../../types";
import type { ToolConfig } from "../types";

// Create a simple mock tool for testing
const mockTool: ToolConfig<{
  organizationSlug: z.ZodOptional<z.ZodString>;
  projectSlug: z.ZodOptional<z.ZodString>;
  someParam: z.ZodString;
}> = {
  name: "mock_tool",
  description: "A mock tool for testing",
  inputSchema: {
    organizationSlug: z.string().optional(), // Optional to test constraint injection
    projectSlug: z.string().optional(),
    someParam: z.string(),
  },
  requiredSkills: [], // Required by ToolConfig
  requiredScopes: [],
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  handler: async (params, context) => {
    // Return the params so we can verify what was passed
    return JSON.stringify({
      params,
      contextOrg: context.constraints.organizationSlug,
      contextProject: context.constraints.projectSlug,
    });
  },
};

describe("wrapToolForAgent", () => {
  it("wraps a tool and calls it successfully", async () => {
    const context: ServerContext = {
      accessToken: "test-token",
      sentryHost: "sentry.io",
      userId: "1",
      clientId: "test-client",
      constraints: {},
      grantedScopes: new Set([]),
    };

    const wrappedTool = wrapToolForAgent(mockTool, { context });

    // Call the wrapped tool
    // AI SDK tools expect a toolContext parameter (messages, abortSignal, etc.)
    const result = await wrappedTool.execute(
      {
        organizationSlug: "my-org",
        someParam: "test-value",
      },
      {} as any, // Empty tool context for testing
    );

    // Verify the tool was called with correct params
    expect(result.result).toBeDefined();
    const parsed = JSON.parse(result.result as string);
    expect(parsed.params.organizationSlug).toBe("my-org");
    expect(parsed.params.someParam).toBe("test-value");
  });

  it("injects organizationSlug constraint", async () => {
    const context: ServerContext = {
      accessToken: "test-token",
      sentryHost: "sentry.io",
      userId: "1",
      clientId: "test-client",
      constraints: {
        organizationSlug: "constrained-org",
      },
      grantedScopes: new Set([]),
    };

    const wrappedTool = wrapToolForAgent(mockTool, { context });

    // Call without providing organizationSlug
    const result = await wrappedTool.execute(
      {
        someParam: "test-value",
      },
      {} as any,
    );

    // Verify the constraint was injected
    expect(result.result).toBeDefined();
    const parsed = JSON.parse(result.result as string);
    expect(parsed.params.organizationSlug).toBe("constrained-org");
    expect(parsed.contextOrg).toBe("constrained-org");
  });

  it("injects projectSlug constraint", async () => {
    const context: ServerContext = {
      accessToken: "test-token",
      sentryHost: "sentry.io",
      userId: "1",
      clientId: "test-client",
      constraints: {
        organizationSlug: "constrained-org",
        projectSlug: "constrained-project",
      },
      grantedScopes: new Set([]),
    };

    const wrappedTool = wrapToolForAgent(mockTool, { context });

    // Call without providing projectSlug
    const result = await wrappedTool.execute(
      {
        someParam: "test-value",
      },
      {} as any,
    );

    // Verify both constraints were injected
    expect(result.result).toBeDefined();
    const parsed = JSON.parse(result.result as string);
    expect(parsed.params.organizationSlug).toBe("constrained-org");
    expect(parsed.params.projectSlug).toBe("constrained-project");
    expect(parsed.contextProject).toBe("constrained-project");
  });

  it("allows agent-provided params to override constraints", async () => {
    const context: ServerContext = {
      accessToken: "test-token",
      sentryHost: "sentry.io",
      userId: "1",
      clientId: "test-client",
      constraints: {
        organizationSlug: "constrained-org",
      },
      grantedScopes: new Set([]),
    };

    const wrappedTool = wrapToolForAgent(mockTool, { context });

    // Provide organizationSlug explicitly (should NOT override since constraint injection doesn't override)
    const result = await wrappedTool.execute(
      {
        organizationSlug: "agent-provided-org",
        someParam: "test-value",
      },
      {} as any,
    );

    expect(result.result).toBeDefined();
    const parsed = JSON.parse(result.result as string);
    // The constraint injection only adds if not present, so agent's value should remain
    expect(parsed.params.organizationSlug).toBe("agent-provided-org");
  });

  it("handles tool errors via agentTool wrapper", async () => {
    const errorTool: ToolConfig<{ param: z.ZodString }> = {
      name: "error_tool",
      description: "A tool that throws an error",
      inputSchema: {
        param: z.string(),
      },
      requiredSkills: [], // Required by ToolConfig
      requiredScopes: [],
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async () => {
        throw new Error("Test error from tool");
      },
    };

    const context: ServerContext = {
      accessToken: "test-token",
      sentryHost: "sentry.io",
      userId: "1",
      clientId: "test-client",
      constraints: {},
      grantedScopes: new Set([]),
    };

    const wrappedTool = wrapToolForAgent(errorTool, { context });

    // Call the tool that throws an error
    const result = await wrappedTool.execute({ param: "test" }, {} as any);

    // Verify the error was caught and returned in structured format
    // Generic errors are wrapped as "System Error" by agentTool for security
    expect(result.error).toBeDefined();
    expect(result.error).toContain("System Error");
    expect(result.error).toContain("Event ID:");
    expect(result.result).toBeUndefined();
  });
});
