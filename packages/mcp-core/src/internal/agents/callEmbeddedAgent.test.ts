import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateText,
  APICallError,
  NoObjectGeneratedError,
  RetryError,
  type LanguageModelUsage,
} from "ai";
import { z } from "zod";
import { callEmbeddedAgent } from "./callEmbeddedAgent";
import { LLMProviderError, UserInputError } from "../../errors";

// Mock the AI SDK
vi.mock("@ai-sdk/openai", () => {
  const mockModel = vi.fn(() => "mocked-model");
  return {
    openai: mockModel,
    createOpenAI: vi.fn(() => mockModel),
  };
});

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: vi.fn(),
    Output: { object: vi.fn(() => ({})) },
  };
});

describe("callEmbeddedAgent", () => {
  const mockGenerateText = vi.mocked(generateText);
  const testSchema = z.object({
    result: z.string(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENROUTER_API_KEY = "";
  });

  it("throws LLMProviderError for OpenAI region restriction", async () => {
    // Create an APICallError simulating OpenAI's region restriction
    const regionError = new APICallError({
      message: "Country, region, or territory not supported",
      url: "https://api.openai.com/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 403,
      isRetryable: false,
    });

    mockGenerateText.mockRejectedValue(regionError);

    await expect(
      callEmbeddedAgent({
        system: "You are a test agent",
        prompt: "Test prompt",
        tools: {},
        schema: testSchema,
      }),
    ).rejects.toThrow(LLMProviderError);

    await expect(
      callEmbeddedAgent({
        system: "You are a test agent",
        prompt: "Test prompt",
        tools: {},
        schema: testSchema,
      }),
    ).rejects.toThrow(
      /does not support requests from your region.*contact support/,
    );
  });

  it("throws LLMProviderError for account deactivated error (401)", async () => {
    const deactivatedError = new APICallError({
      message:
        "The OpenAI account associated with this API key has been deactivated.",
      url: "https://api.openai.com/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 401,
      isRetryable: false,
    });

    mockGenerateText.mockRejectedValue(deactivatedError);

    await expect(
      callEmbeddedAgent({
        system: "You are a test agent",
        prompt: "Test prompt",
        tools: {},
        schema: testSchema,
      }),
    ).rejects.toThrow(LLMProviderError);

    await expect(
      callEmbeddedAgent({
        system: "You are a test agent",
        prompt: "Test prompt",
        tools: {},
        schema: testSchema,
      }),
    ).rejects.toThrow(/configuration, quota, or account issue/);
  });

  it("throws LLMProviderError for invalid API key (401)", async () => {
    const invalidKeyError = new APICallError({
      message: "Incorrect API key provided",
      url: "https://api.openai.com/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 401,
      isRetryable: false,
    });

    mockGenerateText.mockRejectedValue(invalidKeyError);

    await expect(
      callEmbeddedAgent({
        system: "You are a test agent",
        prompt: "Test prompt",
        tools: {},
        schema: testSchema,
      }),
    ).rejects.toThrow(LLMProviderError);
  });

  it("throws LLMProviderError for rate limit error (429)", async () => {
    const rateLimitError = new APICallError({
      message: "Rate limit exceeded",
      url: "https://api.openai.com/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 429,
      isRetryable: true,
    });

    mockGenerateText.mockRejectedValue(rateLimitError);

    await expect(
      callEmbeddedAgent({
        system: "You are a test agent",
        prompt: "Test prompt",
        tools: {},
        schema: testSchema,
      }),
    ).rejects.toThrow(LLMProviderError);

    await expect(
      callEmbeddedAgent({
        system: "You are a test agent",
        prompt: "Test prompt",
        tools: {},
        schema: testSchema,
      }),
    ).rejects.toThrow(/configuration, quota, or account issue/);
  });

  it("throws LLMProviderError for 5xx provider outages", async () => {
    const serverError = new APICallError({
      message: "Internal server error",
      url: "https://api.openai.com/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 500,
      isRetryable: true,
    });

    mockGenerateText.mockRejectedValue(serverError);

    await expect(
      callEmbeddedAgent({
        system: "You are a test agent",
        prompt: "Test prompt",
        tools: {},
        schema: testSchema,
      }),
    ).rejects.toThrow(LLMProviderError);

    await expect(
      callEmbeddedAgent({
        system: "You are a test agent",
        prompt: "Test prompt",
        tools: {},
        schema: testSchema,
      }),
    ).rejects.toThrow(/currently unavailable.*Internal server error/);
  });

  it("throws LLMProviderError for provider APICallErrors without status code", async () => {
    // Some errors may not have a status code (e.g., network errors)
    const networkError = new APICallError({
      message: "Network error",
      url: "https://api.openai.com/v1/chat/completions",
      requestBodyValues: {},
      isRetryable: true,
    });

    mockGenerateText.mockRejectedValue(networkError);

    await expect(
      callEmbeddedAgent({
        system: "You are a test agent",
        prompt: "Test prompt",
        tools: {},
        schema: testSchema,
      }),
    ).rejects.toThrow(LLMProviderError);

    await expect(
      callEmbeddedAgent({
        system: "You are a test agent",
        prompt: "Test prompt",
        tools: {},
        schema: testSchema,
      }),
    ).rejects.toThrow(/currently unavailable.*Network error/);
  });

  it("throws LLMProviderError for provider budget/quota failures", async () => {
    const budgetError = new APICallError({
      message: "Workspace monthly budget of $15000.00 exceeded. Contact your org admin.",
      url: "https://openrouter.ai/api/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 402,
      isRetryable: false,
    });

    mockGenerateText.mockRejectedValue(budgetError);

    await expect(
      callEmbeddedAgent({
        system: "You are a test agent",
        prompt: "Test prompt",
        tools: {},
        schema: testSchema,
      }),
    ).rejects.toThrow(LLMProviderError);

    await expect(
      callEmbeddedAgent({
        system: "You are a test agent",
        prompt: "Test prompt",
        tools: {},
        schema: testSchema,
      }),
    ).rejects.toThrow(/quota, or account issue/);
  });

  it("throws LLMProviderError for RetryError-wrapped provider outages", async () => {
    // After maxRetries, the AI SDK wraps retryable 5xx/network failures.
    const serverError = new APICallError({
      message: "Internal server error",
      url: "https://api.openai.com/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 503,
      isRetryable: true,
    });
    const retryError = new RetryError({
      message: "Failed after 3 attempts. Last error: Internal server error",
      reason: "maxRetriesExceeded",
      errors: [serverError, serverError, serverError],
    });

    mockGenerateText.mockRejectedValue(retryError);

    await expect(
      callEmbeddedAgent({
        system: "You are a test agent",
        prompt: "Test prompt",
        tools: {},
        schema: testSchema,
      }),
    ).rejects.toThrow(LLMProviderError);

    await expect(
      callEmbeddedAgent({
        system: "You are a test agent",
        prompt: "Test prompt",
        tools: {},
        schema: testSchema,
      }),
    ).rejects.toThrow(/currently unavailable.*Internal server error/);
  });

  it("throws LLMProviderError for RetryError without an APICallError cause", async () => {
    const retryError = new RetryError({
      message: "Failed after 3 attempts. Last error: socket hang up",
      reason: "maxRetriesExceeded",
      errors: [new Error("socket hang up")],
    });

    mockGenerateText.mockRejectedValue(retryError);

    await expect(
      callEmbeddedAgent({
        system: "You are a test agent",
        prompt: "Test prompt",
        tools: {},
        schema: testSchema,
      }),
    ).rejects.toThrow(LLMProviderError);

    await expect(
      callEmbeddedAgent({
        system: "You are a test agent",
        prompt: "Test prompt",
        tools: {},
        schema: testSchema,
      }),
    ).rejects.toThrow(/currently unavailable.*socket hang up/);
  });

  it("re-throws non-APICallError errors unchanged", async () => {
    const genericError = new Error("Something went wrong");

    mockGenerateText.mockRejectedValue(genericError);

    await expect(
      callEmbeddedAgent({
        system: "You are a test agent",
        prompt: "Test prompt",
        tools: {},
        schema: testSchema,
      }),
    ).rejects.toThrow("Something went wrong");
  });

  describe("NoObjectGeneratedError handling", () => {
    const schemaWithDefault = z.object({
      query: z.string(),
      explanation: z.string().default(""),
    });

    const noObjectErrorOpts = {
      response: {
        id: "test-id",
        modelId: "test-model",
        timestamp: new Date(),
        headers: {},
      },
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      } as LanguageModelUsage,
      finishReason: "stop" as const,
    };

    it("rescues NoObjectGeneratedError when text is parseable JSON", async () => {
      const error = new NoObjectGeneratedError({
        ...noObjectErrorOpts,
        message: "response did not match schema",
        text: '{"query": "is:unresolved"}',
      });

      mockGenerateText.mockRejectedValue(error);

      const result = await callEmbeddedAgent({
        system: "You are a test agent",
        prompt: "Test prompt",
        tools: {},
        schema: schemaWithDefault,
      });

      expect(result.result).toEqual({
        query: "is:unresolved",
        explanation: "",
      });
    });

    it("rescues NoObjectGeneratedError when text is JSON in markdown code block", async () => {
      const error = new NoObjectGeneratedError({
        ...noObjectErrorOpts,
        message: "response did not match schema",
        text: 'Based on the available fields, here is the query:\n\n```json\n{"query": "is:unresolved", "explanation": "Unresolved issues"}\n```',
      });

      mockGenerateText.mockRejectedValue(error);

      const result = await callEmbeddedAgent({
        system: "You are a test agent",
        prompt: "Test prompt",
        tools: {},
        schema: schemaWithDefault,
      });

      expect(result.result).toEqual({
        query: "is:unresolved",
        explanation: "Unresolved issues",
      });
    });

    it("rescues NoObjectGeneratedError when text is JSON in plain code block", async () => {
      const error = new NoObjectGeneratedError({
        ...noObjectErrorOpts,
        message: "response did not match schema",
        text: 'Here is the translated query:\n\n```\n{"query": "is:unresolved"}\n```',
      });

      mockGenerateText.mockRejectedValue(error);

      const result = await callEmbeddedAgent({
        system: "You are a test agent",
        prompt: "Test prompt",
        tools: {},
        schema: schemaWithDefault,
      });

      expect(result.result).toEqual({
        query: "is:unresolved",
        explanation: "",
      });
    });

    it("rescues NoObjectGeneratedError when JSON object is embedded in prose", async () => {
      const error = new NoObjectGeneratedError({
        ...noObjectErrorOpts,
        message: "response did not match schema",
        text: 'I can translate this to Sentry query syntax. {"query": "is:unresolved", "explanation": "Shows all unresolved issues"} This should work well.',
      });

      mockGenerateText.mockRejectedValue(error);

      const result = await callEmbeddedAgent({
        system: "You are a test agent",
        prompt: "Test prompt",
        tools: {},
        schema: schemaWithDefault,
      });

      expect(result.result).toEqual({
        query: "is:unresolved",
        explanation: "Shows all unresolved issues",
      });
    });

    it("rescues NoObjectGeneratedError when JSON is followed by prose containing }", async () => {
      const error = new NoObjectGeneratedError({
        ...noObjectErrorOpts,
        message: "response did not match schema",
        text: 'Here is the query: {"query": "is:unresolved", "explanation": "done"} See /api/{id}/results for details.',
      });

      mockGenerateText.mockRejectedValue(error);

      const result = await callEmbeddedAgent({
        system: "You are a test agent",
        prompt: "Test prompt",
        tools: {},
        schema: schemaWithDefault,
      });

      expect(result.result).toEqual({
        query: "is:unresolved",
        explanation: "done",
      });
    });

    it("rescues NoObjectGeneratedError when prose contains braces before the JSON object", async () => {
      const error = new NoObjectGeneratedError({
        ...noObjectErrorOpts,
        message: "response did not match schema",
        text: 'Use the {field} syntax for examples. The actual query is {"query": "is:unresolved", "explanation": "valid JSON"}',
      });

      mockGenerateText.mockRejectedValue(error);

      const result = await callEmbeddedAgent({
        system: "You are a test agent",
        prompt: "Test prompt",
        tools: {},
        schema: schemaWithDefault,
      });

      expect(result.result).toEqual({
        query: "is:unresolved",
        explanation: "valid JSON",
      });
    });

    it("rescues NoObjectGeneratedError when prose has unmatched quotes before the JSON object", async () => {
      const error = new NoObjectGeneratedError({
        ...noObjectErrorOpts,
        message: "response did not match schema",
        text: 'The 5" pipe needs attention. Actual output: {"query": "is:unresolved", "explanation": "valid JSON"}',
      });

      mockGenerateText.mockRejectedValue(error);

      const result = await callEmbeddedAgent({
        system: "You are a test agent",
        prompt: "Test prompt",
        tools: {},
        schema: schemaWithDefault,
      });

      expect(result.result).toEqual({
        query: "is:unresolved",
        explanation: "valid JSON",
      });
    });

    it("throws UserInputError when text is not parseable JSON", async () => {
      const error = new NoObjectGeneratedError({
        ...noObjectErrorOpts,
        message: "could not parse the response",
        text: ".",
      });

      mockGenerateText.mockRejectedValue(error);

      await expect(
        callEmbeddedAgent({
          system: "You are a test agent",
          prompt: "Test prompt",
          tools: {},
          schema: schemaWithDefault,
        }),
      ).rejects.toThrow(UserInputError);

      await expect(
        callEmbeddedAgent({
          system: "You are a test agent",
          prompt: "Test prompt",
          tools: {},
          schema: schemaWithDefault,
        }),
      ).rejects.toThrow(/unable to process your query/);
    });
  });
});
