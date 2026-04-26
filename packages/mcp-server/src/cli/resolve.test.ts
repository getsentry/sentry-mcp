import { describe, it, expect } from "vitest";
import { finalize } from "./resolve";

describe("cli/finalize", () => {
  it("returns undefined accessToken when none provided", () => {
    const cfg = finalize({ unknownArgs: [] } as any);
    expect(cfg.accessToken).toBeUndefined();
  });

  it("uses DEFAULT_SENTRY_CLIENT_ID when no clientId provided", () => {
    const cfg = finalize({ accessToken: "tok", unknownArgs: [] });
    expect(cfg.clientId).toBeDefined();
    expect(typeof cfg.clientId).toBe("string");
  });

  it("uses provided clientId over default", () => {
    const cfg = finalize({
      accessToken: "tok",
      clientId: "custom-client-id",
      unknownArgs: [],
    });
    expect(cfg.clientId).toBe("custom-client-id");
  });

  it("normalizes host from URL", () => {
    const cfg = finalize({
      accessToken: "tok",
      url: "https://sentry.example.com",
      unknownArgs: [],
    });
    expect(cfg.sentryHost).toBe("sentry.example.com");
    expect(cfg.sentryProtocol).toBe("https");
  });

  it("uses http protocol for self-hosted hosts when --insecure-http is enabled", () => {
    const cfg = finalize({
      accessToken: "tok",
      host: "sentry.internal:9000",
      insecureHttp: true,
      unknownArgs: [],
    });
    expect(cfg.sentryHost).toBe("sentry.internal:9000");
    expect(cfg.sentryProtocol).toBe("http");
  });

  it("accepts valid OpenAI base URL", () => {
    const cfg = finalize({
      accessToken: "tok",
      openaiBaseUrl: "https://api.proxy.example/v1",
      unknownArgs: [],
    });
    expect(cfg.openaiBaseUrl).toBe(
      new URL("https://api.proxy.example/v1").toString(),
    );
  });

  it("rejects invalid OpenAI base URL", () => {
    expect(() =>
      finalize({
        accessToken: "tok",
        openaiBaseUrl: "ftp://example.com",
        unknownArgs: [],
      }),
    ).toThrow(/OPENAI base URL must use http or https scheme/);
  });

  it("accepts azure-openai as a valid explicit provider", () => {
    const cfg = finalize({
      accessToken: "tok",
      agentProvider: "azure-openai",
      unknownArgs: [],
    });
    expect(cfg.agentProvider).toBe("azure-openai");
  });

  it("rejects invalid explicit provider values", () => {
    expect(() =>
      finalize({
        accessToken: "tok",
        agentProvider: "openrouter",
        unknownArgs: [],
      }),
    ).toThrow(/Must be "openai", "azure-openai", or "anthropic"/);
  });

  it("throws on non-https URL", () => {
    expect(() =>
      finalize({ accessToken: "tok", url: "http://bad", unknownArgs: [] }),
    ).toThrow(/must be a full HTTPS URL/);
  });

  it("throws when --insecure-http is used with --url", () => {
    expect(() =>
      finalize({
        accessToken: "tok",
        url: "https://sentry.example.com",
        insecureHttp: true,
        unknownArgs: [],
      }),
    ).toThrow(/cannot be used with --url or SENTRY_URL/);
  });

  it("surfaces the --insecure-http + --url conflict before URL validation", () => {
    // Even with a non-HTTPS --url, the --insecure-http conflict should win
    // so the user gets the actionable guidance rather than the generic
    // "must be a full HTTPS URL" error.
    expect(() =>
      finalize({
        accessToken: "tok",
        url: "http://sentry.internal:9000",
        insecureHttp: true,
        unknownArgs: [],
      }),
    ).toThrow(/cannot be used with --url or SENTRY_URL/);
  });

  it("throws when --insecure-http targets sentry.io", () => {
    expect(() =>
      finalize({
        accessToken: "tok",
        host: "sentry.io",
        insecureHttp: true,
        unknownArgs: [],
      }),
    ).toThrow(/only supported for self-hosted Sentry hosts/);
  });

  // Skills tests
  it("throws on invalid skills", () => {
    expect(() =>
      finalize({
        accessToken: "tok",
        skills: "invalid-skill",
        unknownArgs: [],
      }),
    ).toThrow(/Invalid skills provided: invalid-skill/);
  });

  it("validates multiple skills and reports all invalid ones", () => {
    expect(() =>
      finalize({
        accessToken: "tok",
        skills: "inspect,invalid1,triage,invalid2",
        unknownArgs: [],
      }),
    ).toThrow(/Invalid skills provided: invalid1, invalid2/);
  });

  it("resolves valid skills in override mode (--skills)", () => {
    const cfg = finalize({
      accessToken: "tok",
      skills: "inspect,triage",
      unknownArgs: [],
    });
    expect(cfg.finalSkills.has("inspect")).toBe(true);
    expect(cfg.finalSkills.has("triage")).toBe(true);
    expect(cfg.finalSkills.size).toBe(2);
    // Should not include defaults
    expect(cfg.finalSkills.has("docs")).toBe(false);
  });

  it("throws on empty skills after validation", () => {
    expect(() =>
      finalize({
        accessToken: "tok",
        skills: "invalid1,invalid2",
        unknownArgs: [],
      }),
    ).toThrow(/Invalid skills provided/);
  });

  it("grants all skills when no skills specified", () => {
    const cfg = finalize({
      accessToken: "tok",
      unknownArgs: [],
    });
    expect(cfg.finalSkills.size).toBe(5); // All skills: inspect, triage, project-management, seer, docs
    expect(cfg.finalSkills.has("inspect")).toBe(true);
    expect(cfg.finalSkills.has("triage")).toBe(true);
    expect(cfg.finalSkills.has("project-management")).toBe(true);
    expect(cfg.finalSkills.has("seer")).toBe(true);
    expect(cfg.finalSkills.has("docs")).toBe(true);
  });

  // --disable-skills tests
  it("removes disabled skills from default all-skills set", () => {
    const cfg = finalize({
      accessToken: "tok",
      disableSkills: "seer",
      unknownArgs: [],
    });
    expect(cfg.finalSkills.has("seer")).toBe(false);
    expect(cfg.finalSkills.size).toBe(4);
    expect(cfg.finalSkills.has("inspect")).toBe(true);
    expect(cfg.finalSkills.has("triage")).toBe(true);
    expect(cfg.finalSkills.has("project-management")).toBe(true);
    expect(cfg.finalSkills.has("docs")).toBe(true);
  });

  it("removes disabled skills when combined with --skills", () => {
    const cfg = finalize({
      accessToken: "tok",
      skills: "inspect,triage,seer",
      disableSkills: "seer",
      unknownArgs: [],
    });
    expect(cfg.finalSkills.has("seer")).toBe(false);
    expect(cfg.finalSkills.size).toBe(2);
    expect(cfg.finalSkills.has("inspect")).toBe(true);
    expect(cfg.finalSkills.has("triage")).toBe(true);
  });

  it("throws on invalid skill names in --disable-skills", () => {
    expect(() =>
      finalize({
        accessToken: "tok",
        disableSkills: "invalid-skill",
        unknownArgs: [],
      }),
    ).toThrow(/--disable-skills provided: invalid-skill/);
  });

  it("throws when all skills would be disabled", () => {
    expect(() =>
      finalize({
        accessToken: "tok",
        skills: "seer",
        disableSkills: "seer",
        unknownArgs: [],
      }),
    ).toThrow(/All skills have been disabled/);
  });

  it("supports multiple comma-separated disabled skills", () => {
    const cfg = finalize({
      accessToken: "tok",
      disableSkills: "seer,docs",
      unknownArgs: [],
    });
    expect(cfg.finalSkills.has("seer")).toBe(false);
    expect(cfg.finalSkills.has("docs")).toBe(false);
    expect(cfg.finalSkills.size).toBe(3);
  });

  it("silently ignores disabling a skill not in the active set", () => {
    const cfg = finalize({
      accessToken: "tok",
      skills: "inspect,triage",
      disableSkills: "seer",
      unknownArgs: [],
    });
    expect(cfg.finalSkills.size).toBe(2);
    expect(cfg.finalSkills.has("inspect")).toBe(true);
    expect(cfg.finalSkills.has("triage")).toBe(true);
  });
});
