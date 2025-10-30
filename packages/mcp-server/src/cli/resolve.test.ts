import { describe, it, expect } from "vitest";
import { finalize } from "./resolve";
import { ALL_SCOPES } from "../permissions";

describe("cli/finalize", () => {
  it("throws on missing access token", () => {
    expect(() => finalize({ unknownArgs: [] } as any)).toThrow(
      /No access token was provided/,
    );
  });

  it("throws on invalid scopes", () => {
    expect(() =>
      finalize({ accessToken: "tok", scopes: "foo", unknownArgs: [] }),
    ).toThrow(/Invalid scopes provided: foo/);
  });

  it("expands implied scopes for --scopes", () => {
    const cfg = finalize({
      accessToken: "tok",
      scopes: "event:write",
      unknownArgs: [],
    });
    expect(cfg.finalScopes?.has("event:write")).toBe(true);
    expect(cfg.finalScopes?.has("event:read")).toBe(true);
  });

  it("merges defaults for --add-scopes and expands", () => {
    const cfg = finalize({
      accessToken: "tok",
      addScopes: "project:write",
      unknownArgs: [],
    });
    expect(cfg.finalScopes?.has("project:write")).toBe(true);
    // Defaults include project:read
    expect(cfg.finalScopes?.has("project:read")).toBe(true);
  });

  it("grants all scopes with --all-scopes", () => {
    const cfg = finalize({
      accessToken: "tok",
      allScopes: true,
      unknownArgs: [],
    });
    expect(cfg.finalScopes?.size).toBe(ALL_SCOPES.length);
    expect(cfg.finalScopes?.has("org:admin")).toBe(true);
  });

  it("normalizes host from URL", () => {
    const cfg = finalize({
      accessToken: "tok",
      url: "https://sentry.example.com",
      unknownArgs: [],
    });
    expect(cfg.sentryHost).toBe("sentry.example.com");
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

  it("throws on non-https URL", () => {
    expect(() =>
      finalize({ accessToken: "tok", url: "http://bad", unknownArgs: [] }),
    ).toThrow(/must be a full HTTPS URL/);
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
    expect(cfg.finalSkills?.has("inspect")).toBe(true);
    expect(cfg.finalSkills?.has("triage")).toBe(true);
    expect(cfg.finalSkills?.size).toBe(2);
    // Should not include defaults
    expect(cfg.finalSkills?.has("docs")).toBe(false);
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
    expect(cfg.finalSkills).toBeDefined();
    expect(cfg.finalSkills?.size).toBe(5); // All skills: inspect, triage, project-management, seer, docs
    expect(cfg.finalSkills?.has("inspect")).toBe(true);
    expect(cfg.finalSkills?.has("triage")).toBe(true);
    expect(cfg.finalSkills?.has("project-management")).toBe(true);
    expect(cfg.finalSkills?.has("seer")).toBe(true);
    expect(cfg.finalSkills?.has("docs")).toBe(true);
  });
});
