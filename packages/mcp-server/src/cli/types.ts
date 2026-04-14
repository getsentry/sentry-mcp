import type { Skill } from "@sentry/mcp-core/skills";

export type CliArgs = {
  accessToken?: string;
  host?: string;
  url?: string;
  mcpUrl?: string;
  sentryDsn?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
  anthropicBaseUrl?: string;
  anthropicModel?: string;
  agentProvider?: string;
  skills?: string;
  disableSkills?: string;
  agent?: boolean;
  experimental?: boolean;
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
  anthropicModel?: string;
  agentProvider?: string;
  clientId?: string;
  skills?: string;
  disableSkills?: string;
};

export type MergedArgs = {
  accessToken?: string;
  host?: string;
  url?: string;
  mcpUrl?: string;
  sentryDsn?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
  anthropicBaseUrl?: string;
  anthropicModel?: string;
  agentProvider?: string;
  clientId?: string; // env-only, carried from EnvArgs
  skills?: string;
  disableSkills?: string;
  agent?: boolean;
  experimental?: boolean;
  organizationSlug?: string;
  projectSlug?: string;
  help?: boolean;
  version?: boolean;
  unknownArgs: string[];
};

/**
 * Partially resolved config — accessToken may not yet be available
 * (will be resolved via device code flow or cache).
 */
export type PartiallyResolvedConfig = {
  accessToken?: string;
  clientId: string;
  sentryHost: string;
  mcpUrl?: string;
  sentryDsn?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
  anthropicBaseUrl?: string;
  anthropicModel?: string;
  agentProvider?: "openai" | "azure-openai" | "anthropic";
  /** Skills granted for this session (always populated by finalize()) */
  finalSkills: Set<Skill>;
  organizationSlug?: string;
  projectSlug?: string;
};

export type ResolvedConfig = Omit<PartiallyResolvedConfig, "accessToken"> & {
  accessToken: string;
};
