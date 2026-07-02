import { describe, expect, it } from "vitest";
import { resolveAgentProvider } from "./agent-provider.js";

describe("resolveAgentProvider", () => {
  it("detects openrouter when only OPENROUTER_API_KEY is set", () => {
    expect(
      resolveAgentProvider({
        OPENROUTER_API_KEY: "sk-or-test",
      }),
    ).toBe("openrouter");
  });

  it("requires an explicit provider when multiple provider keys are set", () => {
    expect(
      resolveAgentProvider({
        OPENAI_API_KEY: "sk-test",
        OPENROUTER_API_KEY: "sk-or-test",
      }),
    ).toBeUndefined();
  });

  it("treats Anthropic as a conflicting provider key", () => {
    expect(
      resolveAgentProvider({
        ANTHROPIC_API_KEY: "sk-ant-test",
        OPENROUTER_API_KEY: "sk-or-test",
      }),
    ).toBeUndefined();
  });

  it("honors EMBEDDED_AGENT_PROVIDER=openrouter", () => {
    expect(
      resolveAgentProvider({
        EMBEDDED_AGENT_PROVIDER: "openrouter",
        OPENAI_API_KEY: "sk-test",
        OPENROUTER_API_KEY: "sk-or-test",
      }),
    ).toBe("openrouter");
  });

  it("requires the matching key for explicit providers", () => {
    expect(
      resolveAgentProvider({
        EMBEDDED_AGENT_PROVIDER: "openrouter",
        OPENAI_API_KEY: "sk-test",
      }),
    ).toBeUndefined();
    expect(
      resolveAgentProvider({
        EMBEDDED_AGENT_PROVIDER: "openai",
        OPENROUTER_API_KEY: "sk-or-test",
      }),
    ).toBeUndefined();
  });
});
