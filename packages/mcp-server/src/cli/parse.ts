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
    "anthropic-base-url": { type: "string" as const },
    "anthropic-model": { type: "string" as const },
    "agent-provider": { type: "string" as const },
    "organization-slug": { type: "string" as const },
    "project-slug": { type: "string" as const },
    skills: { type: "string" as const },
    "disable-skills": { type: "string" as const },
    agent: { type: "boolean" as const },
    experimental: { type: "boolean" as const },
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
    anthropicBaseUrl: values["anthropic-base-url"] as string | undefined,
    anthropicModel: values["anthropic-model"] as string | undefined,
    agentProvider: values["agent-provider"] as string | undefined,
    organizationSlug: values["organization-slug"] as string | undefined,
    projectSlug: values["project-slug"] as string | undefined,
    skills: values.skills as string | undefined,
    disableSkills: values["disable-skills"] as string | undefined,
    agent: values.agent === true,
    experimental: values.experimental === true,
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
  if (env.ANTHROPIC_MODEL) fromEnv.anthropicModel = env.ANTHROPIC_MODEL;
  if (env.EMBEDDED_AGENT_PROVIDER)
    fromEnv.agentProvider = env.EMBEDDED_AGENT_PROVIDER;
  if (env.MCP_SKILLS) fromEnv.skills = env.MCP_SKILLS;
  if (env.MCP_DISABLE_SKILLS) fromEnv.disableSkills = env.MCP_DISABLE_SKILLS;
  return fromEnv;
}

export function merge(cli: CliArgs, env: EnvArgs): MergedArgs {
  // CLI wins over env
  return {
    accessToken: cli.accessToken ?? env.accessToken,
    // If CLI provided url/host, prefer those; else fall back to env
    url: cli.url ?? env.url,
    host: cli.host ?? env.host,
    mcpUrl: cli.mcpUrl ?? env.mcpUrl,
    sentryDsn: cli.sentryDsn ?? env.sentryDsn,
    openaiBaseUrl: cli.openaiBaseUrl,
    openaiModel: cli.openaiModel ?? env.openaiModel,
    anthropicBaseUrl: cli.anthropicBaseUrl,
    anthropicModel: cli.anthropicModel ?? env.anthropicModel,
    agentProvider: cli.agentProvider ?? env.agentProvider,
    // Skills precedence: CLI skills override env
    skills: cli.skills ?? env.skills,
    disableSkills: cli.disableSkills ?? env.disableSkills,
    agent: cli.agent === true,
    experimental: cli.experimental === true,
    organizationSlug: cli.organizationSlug,
    projectSlug: cli.projectSlug,
    help: cli.help === true,
    version: cli.version === true,
    unknownArgs: cli.unknownArgs,
  };
}
