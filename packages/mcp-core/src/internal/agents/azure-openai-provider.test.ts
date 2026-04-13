import type { LanguageModelV3 } from "@ai-sdk/provider";
import { generateText } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigurationError } from "../../errors";
import {
  getAzureOpenAIApiSurface,
  getAzureOpenAIModel,
  setAzureOpenAIBaseUrl,
} from "./azure-openai-provider.js";

describe("azure-openai-provider", () => {
  const originalModel = process.env.OPENAI_MODEL;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalApiVersion = process.env.OPENAI_API_VERSION;

  beforeEach(() => {
    setAzureOpenAIBaseUrl(undefined);
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

  it("requires an explicit Azure base URL", () => {
    expect(() => getAzureOpenAIModel()).toThrow(ConfigurationError);
    expect(() => getAzureOpenAIModel()).toThrow(/requires --openai-base-url/);
  });

  it("rejects unsupported Azure base URL shapes", () => {
    setAzureOpenAIBaseUrl("https://proxy.example.com/v1");

    expect(() => getAzureOpenAIApiSurface()).toThrow(ConfigurationError);
    expect(() => getAzureOpenAIApiSurface()).toThrow(
      /requires an Azure v1 base URL ending in \/openai\/v1 or a deployment URL/,
    );
  });

  it("uses responses API for Azure v1 endpoints", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_API_VERSION = "2024-02-15-preview";
    setAzureOpenAIBaseUrl("https://proxy.example.com/openai/v1/");

    const fetchMock = vi.fn(async (input: Request | URL | string) => {
      const request =
        input instanceof Request ? input : new Request(input.toString());

      expect(request.url).toBe("https://proxy.example.com/openai/v1/responses");
      expect(request.url).not.toContain("api-version=");
      expect(request.headers.get("api-key")).toBe("test-key");

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
        model: getAzureOpenAIModel("my-assistant"),
        prompt: "hello",
      }),
    ).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("uses chat completions for deployment-style Azure endpoints", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_API_VERSION = "2024-02-15-preview";
    setAzureOpenAIBaseUrl(
      "https://proxy.example.com/openai/deployments/test-model",
    );

    const fetchMock = vi.fn(async (input: Request | URL | string) => {
      const request =
        input instanceof Request ? input : new Request(input.toString());

      expect(request.url).toBe(
        "https://proxy.example.com/openai/deployments/test-model/chat/completions?api-version=2024-02-15-preview",
      );
      expect(request.headers.get("api-key")).toBe("test-key");

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
        model: getAzureOpenAIModel("my-company-assistant"),
        prompt: "hello",
      }),
    ).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("treats deployment aliases as opaque model identifiers", () => {
    setAzureOpenAIBaseUrl("https://proxy.example.com/openai/v1/");

    const model = getAzureOpenAIModel(
      "my-company-assistant",
    ) as LanguageModelV3;

    expect(model.modelId).toBe("my-company-assistant");
  });
});
