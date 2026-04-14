import type { LanguageModelV3 } from "@ai-sdk/provider";
import { generateText } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOpenAIModel, setOpenAIBaseUrl } from "./openai-provider.js";

describe("openai-provider", () => {
  const originalModel = process.env.OPENAI_MODEL;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalApiVersion = process.env.OPENAI_API_VERSION;

  beforeEach(() => {
    setOpenAIBaseUrl(undefined);
    // biome-ignore lint/performance/noDelete: Required to properly unset environment variable
    delete process.env.OPENAI_MODEL;
    // biome-ignore lint/performance/noDelete: Required to properly unset environment variable
    delete process.env.OPENAI_API_VERSION;
  });

  afterEach(() => {
    if (originalModel === undefined) {
      // biome-ignore lint/performance/noDelete: Required to properly unset environment variable
      delete process.env.OPENAI_MODEL;
    } else {
      process.env.OPENAI_MODEL = originalModel;
    }

    if (originalApiKey === undefined) {
      // biome-ignore lint/performance/noDelete: Required to properly unset environment variable
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }

    if (originalApiVersion === undefined) {
      // biome-ignore lint/performance/noDelete: Required to properly unset environment variable
      delete process.env.OPENAI_API_VERSION;
    } else {
      process.env.OPENAI_API_VERSION = originalApiVersion;
    }

    vi.unstubAllGlobals();
  });

  describe("base URL configuration", () => {
    it("uses default base URL when not configured", () => {
      const model = getOpenAIModel() as LanguageModelV3;

      expect(model).toBeDefined();
      expect(model.modelId).toBe("gpt-5");
    });

    it("uses configured base URL", () => {
      setOpenAIBaseUrl("https://custom-openai.example.com");

      const model = getOpenAIModel() as LanguageModelV3;

      expect(model).toBeDefined();
      expect(model.modelId).toBe("gpt-5");
    });

    it("uses responses API for generic custom base URL requests", async () => {
      process.env.OPENAI_API_KEY = "test-key";
      setOpenAIBaseUrl("https://proxy.example.com/v1");

      const fetchMock = vi.fn(async (input: Request | URL | string) => {
        const url = input instanceof Request ? input.url : input.toString();

        expect(url).toBe("https://proxy.example.com/v1/responses");

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
      });

      vi.stubGlobal("fetch", fetchMock);

      await expect(
        generateText({
          model: getOpenAIModel(),
          prompt: "hello",
        }),
      ).rejects.toThrow();

      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("keeps responses API for deployment-style URLs in generic openai mode", async () => {
      process.env.OPENAI_API_KEY = "test-key";
      setOpenAIBaseUrl(
        "https://proxy.example.com/openai/deployments/test-model",
      );

      const fetchMock = vi.fn(async (input: Request | URL | string) => {
        const url = input instanceof Request ? input.url : input.toString();

        expect(url).toBe(
          "https://proxy.example.com/openai/deployments/test-model/responses",
        );

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
      });

      vi.stubGlobal("fetch", fetchMock);

      await expect(
        generateText({
          model: getOpenAIModel("my-company-assistant"),
          prompt: "hello",
        }),
      ).rejects.toThrow();

      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("ignores OPENAI_API_VERSION for generic openai provider requests", async () => {
      process.env.OPENAI_API_KEY = "test-key";
      process.env.OPENAI_API_VERSION = "2024-02-15-preview";
      setOpenAIBaseUrl("https://proxy.example.com/v1");

      const fetchMock = vi.fn(async (input: Request | URL | string) => {
        const url = input instanceof Request ? input.url : input.toString();

        expect(url).toBe("https://proxy.example.com/v1/responses");
        expect(url).not.toContain("api-version=");

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
      });

      vi.stubGlobal("fetch", fetchMock);

      await expect(
        generateText({
          model: getOpenAIModel("my-company-assistant"),
          prompt: "hello",
        }),
      ).rejects.toThrow();

      expect(fetchMock).toHaveBeenCalledOnce();
    });
  });

  describe("model override", () => {
    it("uses default model when not specified", () => {
      const model = getOpenAIModel() as LanguageModelV3;

      expect(model.modelId).toBe("gpt-5");
    });

    it("uses specified model when provided", () => {
      const model = getOpenAIModel("gpt-4") as LanguageModelV3;

      expect(model.modelId).toBe("gpt-4");
    });

    it("uses OPENAI_MODEL env var when set", () => {
      process.env.OPENAI_MODEL = "gpt-4-turbo";

      const model = getOpenAIModel() as LanguageModelV3;

      expect(model.modelId).toBe("gpt-4-turbo");
    });
  });
});
