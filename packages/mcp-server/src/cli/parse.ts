import { parseArgs } from "node:util";
import type { CliArgs, EnvArgs, MergedArgs } from "./types";

export function parseArgv(argv: string[]): CliArgs {
  const options = {
    "access-token": { type: "string" as const },
    host: { type: "string" as const },
    url: { type: "string" as const },
    "mcp-url": { type: "string" as const },
    "sentry-dsn": { type: "string" as const },
    "openai-base-url": { type: "string" as const },
    "openai-model": { type: "string" as const },
    "organization-slug": { type: "string" as const },
    "project-slug": { type: "string" as const },
    scopes: { type: "string" as const },
    "add-scopes": { type: "string" as const },
    "all-scopes": { type: "boolean" as const },
    skills: { type: "string" as const },
    agent: { type: "boolean" as const },
    help: { type: "boolean" as const, short: "h" as const },
    version: { type: "boolean" as const, short: "v" as const },
  };

  const { values, positionals, tokens } = parseArgs({
    args: argv,
    options,
    allowPositionals: false,
    strict: false,
    tokens: true,
  });

  const knownLong = new Set(Object.keys(options));
  const knownShort = new Set([
    ...(Object.values(options)
      .map((o) => ("short" in o ? (o.short as string | undefined) : undefined))
      .filter(Boolean) as string[]),
  ]);

  const unknownArgs: string[] = [];
  for (const t of (tokens as any[]) || []) {
    if (t.kind === "option") {
      const name = t.name as string | undefined;
      if (name && !(knownLong.has(name) || knownShort.has(name))) {
        unknownArgs.push((t.raw as string) ?? `--${name}`);
      }
    } else if (t.kind === "positional") {
      unknownArgs.push((t.raw as string) ?? String(t.value ?? ""));
    }
  }

  return {
    accessToken: values["access-token"] as string | undefined,
    host: values.host as string | undefined,
    url: values.url as string | undefined,
    mcpUrl: values["mcp-url"] as string | undefined,
    sentryDsn: values["sentry-dsn"] as string | undefined,
    openaiBaseUrl: values["openai-base-url"] as string | undefined,
    openaiModel: values["openai-model"] as string | undefined,
    organizationSlug: values["organization-slug"] as string | undefined,
    projectSlug: values["project-slug"] as string | undefined,
    scopes: values.scopes as string | undefined,
    addScopes: values["add-scopes"] as string | undefined,
    allScopes: (values["all-scopes"] as boolean | undefined) === true,
    skills: values.skills as string | undefined,
    agent: (values.agent as boolean | undefined) === true,
    help: (values.help as boolean | undefined) === true,
    version: (values.version as boolean | undefined) === true,
    unknownArgs:
      unknownArgs.length > 0 ? unknownArgs : (positionals as string[]) || [],
  };
}

export function parseEnv(env: NodeJS.ProcessEnv): EnvArgs {
  const fromEnv: EnvArgs = {};
  if (env.SENTRY_ACCESS_TOKEN) fromEnv.accessToken = env.SENTRY_ACCESS_TOKEN;
  if (env.SENTRY_URL) fromEnv.url = env.SENTRY_URL;
  if (env.SENTRY_HOST) fromEnv.host = env.SENTRY_HOST;
  if (env.MCP_URL) fromEnv.mcpUrl = env.MCP_URL;
  if (env.SENTRY_DSN || env.DEFAULT_SENTRY_DSN)
    fromEnv.sentryDsn = env.SENTRY_DSN || env.DEFAULT_SENTRY_DSN;

  if (env.OPENAI_MODEL) fromEnv.openaiModel = env.OPENAI_MODEL;

  // LEGACY - deprecated environment variables
  if (env.MCP_SCOPES) {
    fromEnv.scopes = env.MCP_SCOPES;
    console.warn("⚠️  Warning: MCP_SCOPES environment variable is deprecated.");
    console.warn("   Consider using MCP_SKILLS instead.");
    console.warn("");
  }
  if (env.MCP_ADD_SCOPES) {
    fromEnv.addScopes = env.MCP_ADD_SCOPES;
    console.warn(
      "⚠️  Warning: MCP_ADD_SCOPES environment variable is deprecated.",
    );
    console.warn("   Consider using MCP_SKILLS instead.");
    console.warn("");
  }

  // NEW - primary authorization method
  if (env.MCP_SKILLS) fromEnv.skills = env.MCP_SKILLS;
  return fromEnv;
}

export function merge(cli: CliArgs, env: EnvArgs): MergedArgs {
  // CLI wins over env
  const merged: MergedArgs = {
    accessToken: cli.accessToken ?? env.accessToken,
    // If CLI provided url/host, prefer those; else fall back to env
    url: cli.url ?? env.url,
    host: cli.host ?? env.host,
    mcpUrl: cli.mcpUrl ?? env.mcpUrl,
    sentryDsn: cli.sentryDsn ?? env.sentryDsn,
    openaiBaseUrl: cli.openaiBaseUrl,
    openaiModel: cli.openaiModel ?? env.openaiModel,
    // Scopes precedence: CLI scopes/add-scopes override their env counterparts
    scopes: cli.scopes ?? env.scopes,
    addScopes: cli.addScopes ?? env.addScopes,
    allScopes: cli.allScopes === true,
    // Skills precedence: CLI skills override env
    skills: cli.skills ?? env.skills,
    agent: cli.agent === true,
    organizationSlug: cli.organizationSlug,
    projectSlug: cli.projectSlug,
    help: cli.help === true,
    version: cli.version === true,
    unknownArgs: cli.unknownArgs,
  };

  // If CLI provided scopes, ignore additive env var
  if (cli.scopes) merged.addScopes = cli.addScopes;
  // If CLI provided add-scopes, ensure scopes override isn't pulled from env
  if (cli.addScopes) merged.scopes = cli.scopes;

  return merged;
}
