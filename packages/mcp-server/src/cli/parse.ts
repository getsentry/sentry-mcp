import type { CliArgs, EnvArgs, MergedArgs } from "./types";

export function parseArgv(argv: string[]): CliArgs {
  const out: CliArgs = { unknownArgs: [] };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--version" || arg === "-v") {
      out.version = true;
      continue;
    }
    if (arg.startsWith("--access-token=")) {
      out.accessToken = arg.split("=")[1];
    } else if (arg.startsWith("--host=")) {
      out.host = arg.split("=")[1];
    } else if (arg.startsWith("--url=")) {
      out.url = arg.split("=")[1];
    } else if (arg.startsWith("--mcp-url=")) {
      out.mcpUrl = arg.split("=")[1];
    } else if (arg.startsWith("--sentry-dsn=")) {
      out.sentryDsn = arg.split("=")[1];
    } else if (arg.startsWith("--scopes=")) {
      out.scopes = arg.split("=")[1];
    } else if (arg.startsWith("--add-scopes=")) {
      out.addScopes = arg.split("=")[1];
    } else if (arg === "--all-scopes") {
      out.allScopes = true;
    } else {
      out.unknownArgs.push(arg);
    }
  }
  return out;
}

export function parseEnv(env: NodeJS.ProcessEnv): EnvArgs {
  const fromEnv: EnvArgs = {};
  if (env.SENTRY_ACCESS_TOKEN) fromEnv.accessToken = env.SENTRY_ACCESS_TOKEN;
  if (env.SENTRY_URL) fromEnv.url = env.SENTRY_URL;
  if (env.SENTRY_HOST) fromEnv.host = env.SENTRY_HOST;
  if (env.MCP_URL) fromEnv.mcpUrl = env.MCP_URL;
  if (env.SENTRY_DSN || env.DEFAULT_SENTRY_DSN)
    fromEnv.sentryDsn = env.SENTRY_DSN || env.DEFAULT_SENTRY_DSN;
  if (env.MCP_SCOPES) fromEnv.scopes = env.MCP_SCOPES;
  if (env.MCP_ADD_SCOPES) fromEnv.addScopes = env.MCP_ADD_SCOPES;
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
    // Scopes precedence: CLI scopes/add-scopes override their env counterparts
    scopes: cli.scopes ?? env.scopes,
    addScopes: cli.addScopes ?? env.addScopes,
    allScopes: cli.allScopes === true,
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
