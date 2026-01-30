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

  it("re-throws other APICallErrors unchanged", async () => {
    // Create an APICallError for a different error (e.g., rate limit)
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
    ).rejects.toThrow(APICallError);

    await expect(
      callEmbeddedAgent({
        system: "You are a test agent",
        prompt: "Test prompt",
        tools: {},
        schema: testSchema,
      }),
    ).rejects.toThrow("Rate limit exceeded");
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
