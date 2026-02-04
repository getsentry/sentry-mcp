import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateText, APICallError } from "ai";
import { z } from "zod";
import { callEmbeddedAgent } from "./callEmbeddedAgent";
import { LLMProviderError } from "../../errors";

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
    ).rejects.toThrow(/configuration or account issue/);
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
    ).rejects.toThrow(/configuration or account issue/);
  });

  it("re-throws 5xx APICallErrors unchanged (system errors)", async () => {
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
    ).rejects.toThrow(APICallError);

    await expect(
      callEmbeddedAgent({
        system: "You are a test agent",
        prompt: "Test prompt",
        tools: {},
        schema: testSchema,
      }),
    ).rejects.toThrow("Internal server error");
  });

  it("re-throws APICallErrors without status code unchanged", async () => {
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
    ).rejects.toThrow(APICallError);
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
});
