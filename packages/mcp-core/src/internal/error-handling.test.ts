import { describe, it, expect, vi, beforeEach } from "vitest";
import { formatErrorForUser } from "./error-handling";
import {
  UserInputError,
  ConfigurationError,
  LLMProviderError,
} from "../errors";
import { APICallError } from "ai";

vi.mock("../telem/logging", () => ({
  logIssue: vi.fn(() => "mock-event-id"),
}));

import { logIssue } from "../telem/logging";

describe("formatErrorForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("ConfigurationError", () => {
    const error = new ConfigurationError("OPENAI_API_KEY is not set");

    it("returns detailed message for stdio transport", async () => {
      const result = await formatErrorForUser(error, { transport: "stdio" });
      expect(result).toContain("OPENAI_API_KEY is not set");
      expect(result).toContain("**Configuration Error**");
      expect(result).not.toContain("Feature Unavailable");
      expect(logIssue).not.toHaveBeenCalled();
    });

    it("returns generic message for http transport", async () => {
      const result = await formatErrorForUser(error, { transport: "http" });
      expect(result).toContain("**Feature Unavailable**");
      expect(result).not.toContain("OPENAI_API_KEY is not set");
      expect(logIssue).toHaveBeenCalledWith(error);
    });

    it("returns detailed message when transport is undefined (backward compat)", async () => {
      const result = await formatErrorForUser(error);
      expect(result).toContain("OPENAI_API_KEY is not set");
      expect(result).toContain("**Configuration Error**");
      expect(logIssue).not.toHaveBeenCalled();
    });
  });

  describe("LLMProviderError", () => {
    const error = new LLMProviderError("Region not supported by OpenAI");

    it("returns detailed message for stdio transport", async () => {
      const result = await formatErrorForUser(error, { transport: "stdio" });
      expect(result).toContain("Region not supported by OpenAI");
      expect(result).toContain("**AI Provider Error**");
      expect(result).not.toContain("Feature Unavailable");
      expect(logIssue).not.toHaveBeenCalled();
    });

    it("returns generic message for http transport", async () => {
      const result = await formatErrorForUser(error, { transport: "http" });
      expect(result).toContain("**Feature Unavailable**");
      expect(result).not.toContain("Region not supported by OpenAI");
      expect(logIssue).toHaveBeenCalledWith(error);
    });

    it("returns detailed message when transport is undefined", async () => {
      const result = await formatErrorForUser(error);
      expect(result).toContain("Region not supported by OpenAI");
      expect(logIssue).not.toHaveBeenCalled();
    });
  });

  describe("APICallError 4xx", () => {
    const error = new APICallError({
      message: "Invalid API key provided",
      url: "https://api.openai.com/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 401,
      isRetryable: false,
    });

    it("returns detailed message for stdio transport", async () => {
      const result = await formatErrorForUser(error, { transport: "stdio" });
      expect(result).toContain("Invalid API key provided");
      expect(result).toContain("**AI Provider Error**");
      expect(result).not.toContain("Feature Unavailable");
      expect(logIssue).not.toHaveBeenCalled();
    });

    it("returns generic message for http transport", async () => {
      const result = await formatErrorForUser(error, { transport: "http" });
      expect(result).toContain("**Feature Unavailable**");
      expect(result).not.toContain("Invalid API key provided");
      expect(logIssue).toHaveBeenCalledWith(error);
    });

    it("returns detailed message when transport is undefined", async () => {
      const result = await formatErrorForUser(error);
      expect(result).toContain("Invalid API key provided");
      expect(logIssue).not.toHaveBeenCalled();
    });
  });

  describe("UserInputError", () => {
    const error = new UserInputError("Invalid issue ID format");

    it("returns detailed message for http transport (user can fix input)", async () => {
      const result = await formatErrorForUser(error, { transport: "http" });
      expect(result).toContain("Invalid issue ID format");
      expect(result).toContain("**Input Error**");
      expect(result).not.toContain("Feature Unavailable");
      expect(logIssue).not.toHaveBeenCalled();
    });

    it("returns detailed message for stdio transport", async () => {
      const result = await formatErrorForUser(error, { transport: "stdio" });
      expect(result).toContain("Invalid issue ID format");
      expect(result).toContain("**Input Error**");
      expect(logIssue).not.toHaveBeenCalled();
    });
  });
});
