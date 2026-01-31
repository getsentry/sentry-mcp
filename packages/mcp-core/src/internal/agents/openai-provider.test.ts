import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { getOpenAIModel, setOpenAIBaseUrl } from "./openai-provider.js";

describe("openai-provider", () => {
  const originalModel = process.env.OPENAI_MODEL;

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
