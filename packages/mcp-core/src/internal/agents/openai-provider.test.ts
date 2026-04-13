import type { LanguageModelV3 } from "@ai-sdk/provider";
import { generateText } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigurationError } from "../../errors";
import { getOpenAIModel, setOpenAIBaseUrl } from "./openai-provider.js";

describe("openai-provider", () => {
  const originalModel = process.env.OPENAI_MODEL;
  const originalApiKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    setOpenAIBaseUrl(undefined);
    // biome-ignore lint/performance/noDelete: Required to properly unset environment variable
    delete process.env.OPENAI_MODEL;
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

    it("uses chat completions for Azure-style deployment base URLs", async () => {
      process.env.OPENAI_API_KEY = "test-key";
      setOpenAIBaseUrl(
        "https://proxy.example.com/openai/deployments/test-model",
      );

      const fetchMock = vi.fn(async (input: Request | URL | string) => {
        const url = input instanceof Request ? input.url : input.toString();

        expect(url).toBe(
          "https://proxy.example.com/openai/deployments/test-model/chat/completions",
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
          model: getOpenAIModel(),
          prompt: "hello",
        }),
      ).rejects.toThrow();

      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("rejects unrecognized deployment aliases", () => {
      process.env.OPENAI_API_KEY = "test-key";
      setOpenAIBaseUrl(
        "https://proxy.example.com/openai/deployments/test-model",
      );

      expect(() => getOpenAIModel("my-company-assistant")).toThrow(
        ConfigurationError,
      );
      expect(() => getOpenAIModel("my-company-assistant")).toThrow(
        /canonical OPENAI_MODEL value/,
      );
    });

    it("keeps responses API for responses-only models on deployment base URLs", async () => {
      process.env.OPENAI_API_KEY = "test-key";
      setOpenAIBaseUrl(
        "https://proxy.example.com/openai/deployments/test-model",
      );
      const responsesOnlyModels = [
        "codex-mini-latest",
        "computer-use-preview",
        "gpt-5-codex",
      ];

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

      for (const modelId of responsesOnlyModels) {
        await expect(
          generateText({
            model: getOpenAIModel(modelId),
            prompt: "hello",
          }),
        ).rejects.toThrow();
      }

      expect(fetchMock).toHaveBeenCalledTimes(responsesOnlyModels.length);
    });

    it("uses responses API when custom base URL is not configured", async () => {
      process.env.OPENAI_API_KEY = "test-key";

      const fetchMock = vi.fn(async (input: Request | URL | string) => {
        const url = input instanceof Request ? input.url : input.toString();

        expect(url).toBe("https://api.openai.com/v1/responses");

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
