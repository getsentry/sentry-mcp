import type { Scope } from "../permissions";

export type CliArgs = {
  accessToken?: string;
  host?: string;
  url?: string;
  mcpUrl?: string;
  sentryDsn?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
  scopes?: string;
  addScopes?: string;
  allScopes?: boolean;
  agent?: boolean;
  organizationSlug?: string;
  projectSlug?: string;
  help?: boolean;
  version?: boolean;
  unknownArgs: string[];
};

export type EnvArgs = {
  accessToken?: string;
  host?: string; // parsed from SENTRY_HOST or SENTRY_URL (raw value)
  url?: string; // raw URL if provided (SENTRY_URL)
  mcpUrl?: string;
  sentryDsn?: string;
  openaiModel?: string;
  scopes?: string;
  addScopes?: string;
};

export type MergedArgs = {
  accessToken?: string;
  host?: string;
  url?: string;
  mcpUrl?: string;
  sentryDsn?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
  scopes?: string;
  addScopes?: string;
  allScopes?: boolean;
  agent?: boolean;
  organizationSlug?: string;
  projectSlug?: string;
  help?: boolean;
  version?: boolean;
  unknownArgs: string[];
};

export type ResolvedConfig = {
  accessToken: string;
  sentryHost: string;
  mcpUrl?: string;
  sentryDsn?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
  finalScopes?: Set<Scope>;
  organizationSlug?: string;
  projectSlug?: string;
};
