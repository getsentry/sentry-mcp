import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getAgentProvider,
  setAgentProvider,
  getResolvedProviderType,
} from "./provider-factory.js";
import { ConfigurationError } from "../../errors.js";

describe("provider-factory", () => {
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const originalOpenAIKey = process.env.OPENAI_API_KEY;
  const originalProviderEnv = process.env.EMBEDDED_AGENT_PROVIDER;

  beforeEach(() => {
    // Reset module state
    setAgentProvider(undefined);
    // Clear environment variables
    // biome-ignore lint/performance/noDelete: Required to properly unset environment variable
    delete process.env.ANTHROPIC_API_KEY;
    // biome-ignore lint/performance/noDelete: Required to properly unset environment variable
    delete process.env.OPENAI_API_KEY;
    // biome-ignore lint/performance/noDelete: Required to properly unset environment variable
    delete process.env.EMBEDDED_AGENT_PROVIDER;
  });

  afterEach(() => {
    // Restore original environment
    if (originalAnthropicKey === undefined) {
      // biome-ignore lint/performance/noDelete: Required to properly unset environment variable
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    }
    if (originalOpenAIKey === undefined) {
      // biome-ignore lint/performance/noDelete: Required to properly unset environment variable
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAIKey;
    }
    if (originalProviderEnv === undefined) {
      // biome-ignore lint/performance/noDelete: Required to properly unset environment variable
      delete process.env.EMBEDDED_AGENT_PROVIDER;
    } else {
      process.env.EMBEDDED_AGENT_PROVIDER = originalProviderEnv;
    }
    setAgentProvider(undefined);
  });

  describe("single API key auto-detection", () => {
    it("detects anthropic when only ANTHROPIC_API_KEY is set", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";

      const provider = getAgentProvider();
      expect(provider.type).toBe("anthropic");
    });

    it("detects openai when only OPENAI_API_KEY is set", () => {
      process.env.OPENAI_API_KEY = "sk-test";

      const provider = getAgentProvider();
      expect(provider.type).toBe("openai");
    });

    it("returns undefined from getResolvedProviderType when no API keys", () => {
      const providerType = getResolvedProviderType();
      expect(providerType).toBeUndefined();
    });

    it("throws ConfigurationError when no API keys", () => {
      expect(() => getAgentProvider()).toThrow(ConfigurationError);
      expect(() => getAgentProvider()).toThrow(
        /No embedded agent provider configured/,
      );
    });
  });

  describe("multiple API keys with explicit provider", () => {
    it("uses openai when both keys present and EMBEDDED_AGENT_PROVIDER=openai", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";
      process.env.OPENAI_API_KEY = "sk-test";
      process.env.EMBEDDED_AGENT_PROVIDER = "openai";

      const provider = getAgentProvider();
      expect(provider.type).toBe("openai");
    });

    it("uses anthropic when both keys present and EMBEDDED_AGENT_PROVIDER=anthropic", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";
      process.env.OPENAI_API_KEY = "sk-test";
      process.env.EMBEDDED_AGENT_PROVIDER = "anthropic";

      const provider = getAgentProvider();
      expect(provider.type).toBe("anthropic");
    });

    it("uses openai when both keys present and setAgentProvider called", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";
      process.env.OPENAI_API_KEY = "sk-test";
      setAgentProvider("openai");

      const provider = getAgentProvider();
      expect(provider.type).toBe("openai");
    });

    it("returns correct provider from getResolvedProviderType with explicit config", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";
      process.env.OPENAI_API_KEY = "sk-test";
      process.env.EMBEDDED_AGENT_PROVIDER = "openai";

      const providerType = getResolvedProviderType();
      expect(providerType).toBe("openai");
    });
  });

  describe("multiple API keys without explicit provider", () => {
    it("throws ConfigurationError when both keys present", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";
      process.env.OPENAI_API_KEY = "sk-test";

      expect(() => getAgentProvider()).toThrow(ConfigurationError);
    });

    it("provides helpful error message about setting EMBEDDED_AGENT_PROVIDER", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";
      process.env.OPENAI_API_KEY = "sk-test";

      expect(() => getAgentProvider()).toThrow(
        /Both ANTHROPIC_API_KEY and OPENAI_API_KEY are set/,
      );
      expect(() => getAgentProvider()).toThrow(
        /EMBEDDED_AGENT_PROVIDER environment variable/,
      );
      expect(() => getAgentProvider()).toThrow(/'openai' or 'anthropic'/);
    });

    it("returns undefined from getResolvedProviderType when both keys present", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";
      process.env.OPENAI_API_KEY = "sk-test";

      const providerType = getResolvedProviderType();
      expect(providerType).toBeUndefined();
    });
  });

  describe("explicit provider validation", () => {
    it("throws ConfigurationError when explicit provider lacks API key", () => {
      process.env.EMBEDDED_AGENT_PROVIDER = "openai";
      // No OPENAI_API_KEY set

      expect(() => getAgentProvider()).toThrow(ConfigurationError);
      expect(() => getAgentProvider()).toThrow(/OPENAI_API_KEY is not set/);
    });

    it("returns undefined from getResolvedProviderType when explicit provider lacks API key", () => {
      process.env.EMBEDDED_AGENT_PROVIDER = "openai";
      // No OPENAI_API_KEY set

      const providerType = getResolvedProviderType();
      expect(providerType).toBeUndefined();
    });
  });

  describe("provider precedence", () => {
    it("prefers setAgentProvider over EMBEDDED_AGENT_PROVIDER", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";
      process.env.OPENAI_API_KEY = "sk-test";
      process.env.EMBEDDED_AGENT_PROVIDER = "anthropic";
      setAgentProvider("openai");

      const provider = getAgentProvider();
      expect(provider.type).toBe("openai");
    });

    it("prefers EMBEDDED_AGENT_PROVIDER over auto-detection", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";
      process.env.OPENAI_API_KEY = "sk-test";
      process.env.EMBEDDED_AGENT_PROVIDER = "openai";

      const provider = getAgentProvider();
      expect(provider.type).toBe("openai");
    });
  });
});
