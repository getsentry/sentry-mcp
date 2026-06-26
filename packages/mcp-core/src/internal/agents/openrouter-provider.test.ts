import type { LanguageModelV3 } from "@ai-sdk/provider";
import { generateText } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOpenRouterModel } from "./openrouter-provider.js";

describe("openrouter-provider", () => {
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  const originalModel = process.env.OPENROUTER_MODEL;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    // biome-ignore lint/performance/noDelete: Required to properly unset environment variable
    delete process.env.OPENROUTER_MODEL;
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      // biome-ignore lint/performance/noDelete: Required to properly unset environment variable
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalApiKey;
    }

    if (originalModel === undefined) {
      // biome-ignore lint/performance/noDelete: Required to properly unset environment variable
      delete process.env.OPENROUTER_MODEL;
    } else {
      process.env.OPENROUTER_MODEL = originalModel;
    }

    vi.unstubAllGlobals();
  });

  it("uses the OpenRouter chat completions endpoint", async () => {
    let requestUrl: string | undefined;
    let authorization: string | null = null;

    const fetchMock = vi.fn(
      async (input: Request | URL | string, init?: RequestInit) => {
        const request =
          input instanceof Request
            ? new Request(input, init)
            : new Request(input.toString(), init);
        requestUrl = request.url;
        authorization = request.headers.get("authorization");

        return new Response(
          JSON.stringify({
            error: {
              message: "boom",
              type: "invalid_request_error",
              param: null,
              code: "bad_request",
            },
          }),
          {
            status: 400,
            headers: { "content-type": "application/json" },
          },
        );
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateText({
        model: getOpenRouterModel(),
        prompt: "hello",
      }),
    ).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(requestUrl).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(authorization).toBe("Bearer test-openrouter-key");
  });

  it("uses default and configured models", () => {
    expect((getOpenRouterModel() as LanguageModelV3).modelId).toBe(
      "openai/gpt-5",
    );

    process.env.OPENROUTER_MODEL = "anthropic/claude-sonnet-4";

    expect((getOpenRouterModel() as LanguageModelV3).modelId).toBe(
      "anthropic/claude-sonnet-4",
    );
    expect(
      (getOpenRouterModel("google/gemini-2.5-pro") as LanguageModelV3).modelId,
    ).toBe("google/gemini-2.5-pro");
  });
});
