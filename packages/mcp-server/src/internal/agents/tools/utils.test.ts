import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { agentTool } from "./utils";
import { UserInputError } from "../../../errors";
import {
  ApiClientError,
  ApiServerError,
  ApiNotFoundError,
} from "../../../api-client";
import * as logging from "../../../logging";

// Mock the logging module
vi.mock("../../../logging", () => ({
  logError: vi.fn().mockReturnValue("mock-event-id-12345"),
}));

describe("agentTool", () => {
  it("returns structured success response", async () => {
    const testTool = agentTool({
      description: "Test tool",
      parameters: z.object({ input: z.string() }),
      execute: async ({ input }) => `Hello ${input}`,
    });

    const result = await testTool.execute({ input: "world" });

    expect(result).toEqual({
      result: "Hello world",
    });
  });

  it("handles UserInputError with structured error response", async () => {
    const testTool = agentTool({
      description: "Test tool",
      parameters: z.object({ input: z.string() }),
      execute: async () => {
        throw new UserInputError("Invalid input provided");
      },
    });

    const result = await testTool.execute({ input: "test" });

    expect(result).toEqual({
      error:
        "Input Error: Invalid input provided. You may be able to resolve this by addressing the concern and trying again.",
    });
    expect(result.result).toBeUndefined();
  });

  it("handles ApiClientError with structured error response", async () => {
    const testTool = agentTool({
      description: "Test tool",
      parameters: z.object({ input: z.string() }),
      execute: async () => {
        throw new ApiNotFoundError("Resource not found");
      },
    });

    const result = await testTool.execute({ input: "test" });

    expect(result.error).toContain("Input Error:");
    expect(result.error).toContain("Resource not found");
    expect(result.error).toContain("You may be able to resolve this");
    expect(result.result).toBeUndefined();
  });

  it("handles ApiServerError with structured error response", async () => {
    const testTool = agentTool({
      description: "Test tool",
      parameters: z.object({ input: z.string() }),
      execute: async () => {
        throw new ApiServerError("Internal server error", 500);
      },
    });

    const result = await testTool.execute({ input: "test" });

    expect(result).toEqual({
      error:
        "Server Error (500): Internal server error. Event ID: mock-event-id-12345. This is a system error that cannot be resolved by retrying.",
    });
    expect(result.result).toBeUndefined();
    expect(logging.logError).toHaveBeenCalledWith(expect.any(ApiServerError));
  });

  it("handles unexpected errors with structured error response", async () => {
    const unexpectedError = new Error("Network timeout");
    const testTool = agentTool({
      description: "Test tool",
      parameters: z.object({ input: z.string() }),
      execute: async () => {
        throw unexpectedError;
      },
    });

    const result = await testTool.execute({ input: "test" });

    expect(result).toEqual({
      error:
        "System Error: An unexpected error occurred. Event ID: mock-event-id-12345. This is a system error that cannot be resolved by retrying.",
    });
    expect(result.result).toBeUndefined();
    expect(logging.logError).toHaveBeenCalledWith(unexpectedError);
  });

  it("handles TypeError with structured error response", async () => {
    const typeError = new TypeError("Cannot read property 'foo' of undefined");
    const testTool = agentTool({
      description: "Test tool",
      parameters: z.object({ input: z.string() }),
      execute: async () => {
        throw typeError;
      },
    });

    const result = await testTool.execute({ input: "test" });

    expect(result).toEqual({
      error:
        "System Error: An unexpected error occurred. Event ID: mock-event-id-12345. This is a system error that cannot be resolved by retrying.",
    });
    expect(result.result).toBeUndefined();
    expect(logging.logError).toHaveBeenCalledWith(typeError);
  });

  it("preserves type inference for result", async () => {
    const testTool = agentTool({
      description: "Test tool",
      parameters: z.object({ input: z.string() }),
      execute: async ({ input }) => ({ message: `Hello ${input}`, count: 42 }),
    });

    const result = await testTool.execute({ input: "world" });

    expect(result).toEqual({
      result: { message: "Hello world", count: 42 },
    });
    // TypeScript should infer the correct type for result
    if (result.result) {
      expect(result.result.message).toBe("Hello world");
      expect(result.result.count).toBe(42);
    }
  });
});
