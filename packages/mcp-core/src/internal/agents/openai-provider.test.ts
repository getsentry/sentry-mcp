import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getOpenAIModel, setOpenAIBaseUrl } from "./openai-provider.js";

describe("openai-provider", () => {
  const originalEnv = process.env.OPENAI_REASONING_EFFORT;

  beforeEach(() => {
    setOpenAIBaseUrl(undefined);
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      // biome-ignore lint/performance/noDelete: Required to properly unset environment variable
      delete process.env.OPENAI_REASONING_EFFORT;
    } else {
      process.env.OPENAI_REASONING_EFFORT = originalEnv;
    }
  });

  describe("reasoning effort configuration", () => {
    it("uses default reasoning effort when env var is not set", () => {
      // biome-ignore lint/performance/noDelete: Required to properly unset environment variable
      delete process.env.OPENAI_REASONING_EFFORT;

      const model = getOpenAIModel();

      // The model object should be created with default reasoning effort
      expect(model).toBeDefined();
      expect(model.modelId).toBe("gpt-5");
    });

    it("disables reasoning effort when env var is empty string", () => {
      process.env.OPENAI_REASONING_EFFORT = "";

      const model = getOpenAIModel();

      // The model object should be created without reasoning effort
      expect(model).toBeDefined();
      expect(model.modelId).toBe("gpt-5");
    });

    it("uses specified reasoning effort when env var is set", () => {
      process.env.OPENAI_REASONING_EFFORT = "high";

      const model = getOpenAIModel();

      // The model object should be created with high reasoning effort
      expect(model).toBeDefined();
      expect(model.modelId).toBe("gpt-5");
    });

    it("throws error for invalid reasoning effort value", () => {
      process.env.OPENAI_REASONING_EFFORT = "invalid";

      expect(() => getOpenAIModel()).toThrow(
        'Invalid OPENAI_REASONING_EFFORT value: "invalid". Must be one of: "low", "medium", "high", or "" (empty string to disable). Default is "low".',
      );
    });
  });

  describe("base URL configuration", () => {
    it("uses default base URL when not configured", () => {
      const model = getOpenAIModel();

      expect(model).toBeDefined();
      expect(model.modelId).toBe("gpt-5");
    });

    it("uses configured base URL", () => {
      setOpenAIBaseUrl("https://custom-openai.example.com");

      const model = getOpenAIModel();

      expect(model).toBeDefined();
      expect(model.modelId).toBe("gpt-5");
    });
  });

  describe("model override", () => {
    it("uses default model when not specified", () => {
      const model = getOpenAIModel();

      expect(model.modelId).toBe("gpt-5");
    });

    it("uses specified model when provided", () => {
      const model = getOpenAIModel("gpt-4");

      expect(model.modelId).toBe("gpt-4");
    });

    it("uses OPENAI_MODEL env var when set", () => {
      process.env.OPENAI_MODEL = "gpt-4o";

      const model = getOpenAIModel();

      expect(model.modelId).toBe("gpt-4o");

      // biome-ignore lint/performance/noDelete: Required to properly unset environment variable
      delete process.env.OPENAI_MODEL;
    });
  });
});
