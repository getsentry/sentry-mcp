import type { Scope } from "../permissions";
import type { Skill } from "../skills";

export type CliArgs = {
  accessToken?: string;
  host?: string;
  url?: string;
  mcpUrl?: string;
  sentryDsn?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
  scopes?: string; // LEGACY - for backward compatibility
  addScopes?: string; // LEGACY - for backward compatibility
  allScopes?: boolean; // LEGACY - for backward compatibility
  skills?: string; // NEW - primary authorization method
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
  scopes?: string; // LEGACY - for backward compatibility
  addScopes?: string; // LEGACY - for backward compatibility
  skills?: string; // NEW - primary authorization method
};

export type MergedArgs = {
  accessToken?: string;
  host?: string;
  url?: string;
  mcpUrl?: string;
  sentryDsn?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
  scopes?: string; // LEGACY - for backward compatibility
  addScopes?: string; // LEGACY - for backward compatibility
  allScopes?: boolean; // LEGACY - for backward compatibility
  skills?: string; // NEW - primary authorization method
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
  finalScopes?: Set<Scope>; // LEGACY - for backward compatibility
  finalSkills?: Set<Skill>; // NEW - primary authorization method
  organizationSlug?: string;
  projectSlug?: string;
};
