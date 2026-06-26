import type { MCPConfig, RequestedTransportMode } from "./types.js";

export function resolveTransportMode(options: {
  requestedTransport?: RequestedTransportMode;
  accessToken?: string;
}): "stdio" | "http" {
  const requestedTransport = options.requestedTransport || "auto";

  if (requestedTransport === "auto") {
    return options.accessToken ? "stdio" : "http";
  }

  return requestedTransport;
}

export function buildStdioServerLaunchConfig(
  config: MCPConfig,
  baseEnv: NodeJS.ProcessEnv = process.env,
): {
  args: string[];
  env: Record<string, string>;
} {
  const args: string[] = [];

  if (config.accessToken) {
    args.push(`--access-token=${config.accessToken}`);
  }
  if (config.host) {
    args.push(`--host=${config.host}`);
  }
  if (config.sentryDsn) {
    args.push(`--sentry-dsn=${config.sentryDsn}`);
  }
  if (config.useAgentEndpoint) {
    args.push("--agent");
  }
  if (config.useExperimental) {
    args.push("--experimental");
  }

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }

  if (config.accessToken) {
    env.SENTRY_ACCESS_TOKEN = config.accessToken;
  }
  if (config.host) {
    env.SENTRY_HOST = config.host;
  }
  if (config.sentryDsn) {
    env.SENTRY_DSN = config.sentryDsn;
  }

  return { args, env };
}
