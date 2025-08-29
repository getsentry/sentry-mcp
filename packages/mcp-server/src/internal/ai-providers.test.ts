import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getConfiguredModel, createAIRegistry } from "./ai-providers";

describe("AI Providers Configuration", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("createAIRegistry", () => {
    it("should throw error when no provider is configured", () => {
      delete process.env.OPENAI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      delete process.env.OPENROUTER_API_KEY;

      expect(() => createAIRegistry()).toThrow(
        "No AI provider configured"
      );
    });

    it("should create registry with OpenAI provider", () => {
      process.env.OPENAI_API_KEY = "test-key";
      
      const registry = createAIRegistry();
      expect(registry).toBeDefined();
    });

    it("should create registry with OpenRouter configuration", () => {
      process.env.OPENROUTER_API_KEY = "test-router-key";
      
      const registry = createAIRegistry();
      expect(registry).toBeDefined();
    });

    it("should support custom base URL for OpenAI-compatible providers", () => {
      process.env.OPENAI_API_KEY = "test-key";
      process.env.AI_SDK_BASE_URL = "https://custom.api.com/v1";
      
      const registry = createAIRegistry();
      expect(registry).toBeDefined();
    });
  });

  describe("getConfiguredModel", () => {
    beforeEach(() => {
      process.env.OPENAI_API_KEY = "test-key";
    });

    it("should use default model when AI_SDK_MODEL is not set", () => {
      delete process.env.AI_SDK_MODEL;
      
      const model = getConfiguredModel();
      expect(model).toBeDefined();
    });

    it("should use specified model from environment", () => {
      process.env.AI_SDK_MODEL = "gpt-4-turbo";
      
      const model = getConfiguredModel();
      expect(model).toBeDefined();
    });

    it("should override environment model with parameter", () => {
      process.env.AI_SDK_MODEL = "gpt-4o";
      
      const model = getConfiguredModel("gpt-4-turbo");
      expect(model).toBeDefined();
    });

    it("should auto-detect Anthropic provider for claude models", () => {
      process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
      
      const model = getConfiguredModel("claude-3-5-sonnet");
      expect(model).toBeDefined();
    });

    it("should auto-detect Google provider for gemini models", () => {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google-key";
      
      const model = getConfiguredModel("gemini-1.5-pro");
      expect(model).toBeDefined();
    });

    it("should handle fully qualified model IDs", () => {
      const model = getConfiguredModel("openai:gpt-4o");
      expect(model).toBeDefined();
    });

    it("should throw meaningful error for missing provider", () => {
      delete process.env.ANTHROPIC_API_KEY;
      
      expect(() => getConfiguredModel("claude-3-5-sonnet")).toThrow(
        /Failed to load model.*anthropic:claude-3-5-sonnet/
      );
    });
  });
});