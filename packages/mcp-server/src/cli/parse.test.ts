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
      "--scopes=org:read",
      "--add-scopes=event:write",
      "--all-scopes",
      "-h",
      "-v",
    ]);
    expect(parsed.accessToken).toBe("tok");
    expect(parsed.host).toBe("sentry.io");
    expect(parsed.url).toBe("https://example.com");
    expect(parsed.mcpUrl).toBe("https://mcp.example.com");
    expect(parsed.sentryDsn).toBe("dsn");
    expect(parsed.openaiBaseUrl).toBe("https://api.example.com/v1");
    expect(parsed.scopes).toBe("org:read");
    expect(parsed.addScopes).toBe("event:write");
    expect(parsed.allScopes).toBe(true);
    expect(parsed.help).toBe(true);
    expect(parsed.version).toBe(true);
    expect(parsed.unknownArgs).toEqual([]);
  });

  it("parses skills flags", () => {
    const parsed = parseArgv(["--access-token=tok", "--skills=inspect,triage"]);
    expect(parsed.accessToken).toBe("tok");
    expect(parsed.skills).toBe("inspect,triage");
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
      MCP_SCOPES: "org:read",
      MCP_ADD_SCOPES: "event:write",
      MCP_SKILLS: "inspect,triage",
    } as any);
    expect(env.accessToken).toBe("envtok");
    expect(env.host).toBe("envhost");
    expect(env.mcpUrl).toBe("envmcp");
    expect(env.sentryDsn).toBe("envdsn");
    expect(env.scopes).toBe("org:read");
    expect(env.addScopes).toBe("event:write");
    expect(env.skills).toBe("inspect,triage");
  });
});

describe("cli/merge", () => {
  it("applies precedence: CLI over env", () => {
    const env = parseEnv({
      SENTRY_ACCESS_TOKEN: "envtok",
      SENTRY_HOST: "envhost",
      MCP_URL: "envmcp",
      SENTRY_DSN: "envdsn",
      MCP_SCOPES: "org:read",
      MCP_ADD_SCOPES: "event:write",
    } as any);
    const cli = parseArgv([
      "--access-token=clitok",
      "--host=clihost",
      "--mcp-url=climcp",
      "--sentry-dsn=clidsn",
      "--openai-base-url=https://api.cli/v1",
      "--scopes=org:admin",
      "--add-scopes=project:write",
    ]);
    const merged = merge(cli, env);
    expect(merged.accessToken).toBe("clitok");
    expect(merged.host).toBe("clihost");
    expect(merged.mcpUrl).toBe("climcp");
    expect(merged.sentryDsn).toBe("clidsn");
    expect(merged.openaiBaseUrl).toBe("https://api.cli/v1");
    expect(merged.scopes).toBe("org:admin");
    expect(merged.addScopes).toBe("project:write");
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
});
