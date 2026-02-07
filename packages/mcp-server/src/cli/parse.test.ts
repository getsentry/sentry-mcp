import { describe, it, expect } from "vitest";
import { parseArgv, parseEnv, merge } from "./parse";

describe("cli/parseArgv", () => {
  it("parses known flags and short aliases", () => {
    const parsed = parseArgv([
      "--access-token=tok",
      "--host=sentry.io",
      "--url=https://example.com",
      "--mcp-url=https://mcp.example.com",
      "--sentry-dsn=dsn",
      "--openai-base-url=https://api.example.com/v1",
      "--skills=inspect,triage",
      "-h",
      "-v",
    ]);
    expect(parsed.accessToken).toBe("tok");
    expect(parsed.host).toBe("sentry.io");
    expect(parsed.url).toBe("https://example.com");
    expect(parsed.mcpUrl).toBe("https://mcp.example.com");
    expect(parsed.sentryDsn).toBe("dsn");
    expect(parsed.openaiBaseUrl).toBe("https://api.example.com/v1");
    expect(parsed.skills).toBe("inspect,triage");
    expect(parsed.help).toBe(true);
    expect(parsed.version).toBe(true);
    expect(parsed.unknownArgs).toEqual([]);
  });

  it("parses skills flags", () => {
    const parsed = parseArgv(["--access-token=tok", "--skills=inspect,triage"]);
    expect(parsed.accessToken).toBe("tok");
    expect(parsed.skills).toBe("inspect,triage");
  });

  it("parses --disable-skills", () => {
    const parsed = parseArgv(["--access-token=tok", "--disable-skills=seer"]);
    expect(parsed.disableSkills).toBe("seer");
  });

  it("collects unknown args", () => {
    const parsed = parseArgv(["--unknown", "--another=1"]);
    expect(parsed.unknownArgs.length).toBeGreaterThan(0);
  });
});

describe("cli/parseEnv", () => {
  it("parses environment variables including skills", () => {
    const env = parseEnv({
      SENTRY_ACCESS_TOKEN: "envtok",
      SENTRY_HOST: "envhost",
      MCP_URL: "envmcp",
      SENTRY_DSN: "envdsn",
      MCP_SKILLS: "inspect,triage",
    } as any);
    expect(env.accessToken).toBe("envtok");
    expect(env.host).toBe("envhost");
    expect(env.mcpUrl).toBe("envmcp");
    expect(env.sentryDsn).toBe("envdsn");
    expect(env.skills).toBe("inspect,triage");
  });

  it("reads MCP_DISABLE_SKILLS", () => {
    const env = parseEnv({
      SENTRY_ACCESS_TOKEN: "envtok",
      MCP_DISABLE_SKILLS: "seer",
    } as any);
    expect(env.disableSkills).toBe("seer");
  });
});

describe("cli/merge", () => {
  it("applies precedence: CLI over env", () => {
    const env = parseEnv({
      SENTRY_ACCESS_TOKEN: "envtok",
      SENTRY_HOST: "envhost",
      MCP_URL: "envmcp",
      SENTRY_DSN: "envdsn",
    } as any);
    const cli = parseArgv([
      "--access-token=clitok",
      "--host=clihost",
      "--mcp-url=climcp",
      "--sentry-dsn=clidsn",
      "--openai-base-url=https://api.cli/v1",
    ]);
    const merged = merge(cli, env);
    expect(merged.accessToken).toBe("clitok");
    expect(merged.host).toBe("clihost");
    expect(merged.mcpUrl).toBe("climcp");
    expect(merged.sentryDsn).toBe("clidsn");
    expect(merged.openaiBaseUrl).toBe("https://api.cli/v1");
  });

  it("applies precedence for skills: CLI over env", () => {
    const env = parseEnv({
      SENTRY_ACCESS_TOKEN: "envtok",
      MCP_SKILLS: "inspect",
    } as any);
    const cli = parseArgv(["--access-token=clitok", "--skills=inspect,triage"]);
    const merged = merge(cli, env);
    expect(merged.skills).toBe("inspect,triage");
  });

  it("falls back to env when CLI skills not provided", () => {
    const env = parseEnv({
      SENTRY_ACCESS_TOKEN: "envtok",
      MCP_SKILLS: "inspect,triage",
    } as any);
    const cli = parseArgv(["--access-token=clitok"]);
    const merged = merge(cli, env);
    expect(merged.skills).toBe("inspect,triage");
  });

  it("applies precedence for disableSkills: CLI over env", () => {
    const env = parseEnv({
      SENTRY_ACCESS_TOKEN: "envtok",
      MCP_DISABLE_SKILLS: "docs",
    } as any);
    const cli = parseArgv(["--access-token=clitok", "--disable-skills=seer"]);
    const merged = merge(cli, env);
    expect(merged.disableSkills).toBe("seer");
  });

  it("falls back to env when CLI disableSkills not provided", () => {
    const env = parseEnv({
      SENTRY_ACCESS_TOKEN: "envtok",
      MCP_DISABLE_SKILLS: "seer",
    } as any);
    const cli = parseArgv(["--access-token=clitok"]);
    const merged = merge(cli, env);
    expect(merged.disableSkills).toBe("seer");
  });
});
