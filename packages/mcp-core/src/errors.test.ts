import { describe, expect, it } from "vitest";
import {
  AgentExecutionError,
  UserInputError,
  ConfigurationError,
  LLMProviderError,
} from "./errors";

describe("UserInputError", () => {
  it("should create a UserInputError with the correct message and name", () => {
    const message = "Invalid input provided";
    const error = new UserInputError(message);

    expect(error.message).toBe(message);
    expect(error.name).toBe("UserInputError");
    expect(error instanceof Error).toBe(true);
    expect(error instanceof UserInputError).toBe(true);
  });

  it("should be distinguishable from regular Error", () => {
    const userInputError = new UserInputError("User input error");
    const regularError = new Error("Regular error");

    expect(userInputError instanceof UserInputError).toBe(true);
    expect(regularError instanceof UserInputError).toBe(false);
  });

  it("should support error cause", () => {
    const cause = new Error("Original error");
    const error = new UserInputError("User input error", { cause });

    expect(error.cause).toBe(cause);
  });
});

describe("ConfigurationError", () => {
  it("should create a ConfigurationError with the correct message and name", () => {
    const message = "Invalid configuration";
    const error = new ConfigurationError(message);

    expect(error.message).toBe(message);
    expect(error.name).toBe("ConfigurationError");
    expect(error instanceof Error).toBe(true);
    expect(error instanceof ConfigurationError).toBe(true);
  });

  it("should be distinguishable from regular Error and UserInputError", () => {
    const configError = new ConfigurationError("Config error");
    const userInputError = new UserInputError("User input error");
    const regularError = new Error("Regular error");

    expect(configError instanceof ConfigurationError).toBe(true);
    expect(userInputError instanceof ConfigurationError).toBe(false);
    expect(regularError instanceof ConfigurationError).toBe(false);
  });

  it("should support error cause", () => {
    const cause = new Error("DNS resolution failed");
    const error = new ConfigurationError("Unable to connect to server", {
      cause,
    });

    expect(error.cause).toBe(cause);
  });
});

describe("LLMProviderError", () => {
  it("should create an LLMProviderError with the correct message and name", () => {
    const message = "Region not supported";
    const error = new LLMProviderError(message);

    expect(error.message).toBe(message);
    expect(error.name).toBe("LLMProviderError");
    expect(error instanceof Error).toBe(true);
    expect(error instanceof LLMProviderError).toBe(true);
  });

  it("should be distinguishable from other error types", () => {
    const llmError = new LLMProviderError("LLM provider error");
    const configError = new ConfigurationError("Config error");
    const userInputError = new UserInputError("User input error");
    const regularError = new Error("Regular error");

    expect(llmError instanceof LLMProviderError).toBe(true);
    expect(configError instanceof LLMProviderError).toBe(false);
    expect(userInputError instanceof LLMProviderError).toBe(false);
    expect(regularError instanceof LLMProviderError).toBe(false);
  });

  it("should support error cause", () => {
    const cause = new Error("OpenAI API rejected the request");
    const error = new LLMProviderError("Region not supported", { cause });

    expect(error.cause).toBe(cause);
  });
});

describe("AgentExecutionError", () => {
  it("should create an AgentExecutionError with the correct message and name", () => {
    const message = "The AI agent failed to complete this request";
    const error = new AgentExecutionError(message);

    expect(error.message).toBe(message);
    expect(error.name).toBe("AgentExecutionError");
    expect(error instanceof Error).toBe(true);
    expect(error instanceof AgentExecutionError).toBe(true);
  });

  it("should be distinguishable from other error types", () => {
    const agentError = new AgentExecutionError("agent failed");
    const llmError = new LLMProviderError("provider failed");
    const userInputError = new UserInputError("bad input");
    const regularError = new Error("regular");

    expect(agentError instanceof AgentExecutionError).toBe(true);
    expect(llmError instanceof AgentExecutionError).toBe(false);
    expect(userInputError instanceof AgentExecutionError).toBe(false);
    expect(regularError instanceof AgentExecutionError).toBe(false);
  });

  it("should support error cause and eventId", () => {
    const cause = new Error("No output generated.");
    const error = new AgentExecutionError("agent failed", {
      cause,
      eventId: "abc123",
    });

    expect(error.cause).toBe(cause);
    expect(error.eventId).toBe("abc123");
  });
});
