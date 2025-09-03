import {
  ALL_SCOPES,
  parseScopes,
  resolveScopes,
  type Scope,
} from "../permissions";
import { DEFAULT_SCOPES } from "../constants";
import {
  validateAndParseSentryUrlThrows,
  validateSentryHostThrows,
} from "../utils/url-utils";
import type { MergedArgs, ResolvedConfig } from "./types";

export function formatInvalid(invalid: string[], envName?: string): string {
  const where = envName ? `${envName} provided` : "Invalid scopes provided";
  return `Error: ${where}: ${invalid.join(", ")}\nAvailable scopes: ${ALL_SCOPES.join(", ")}`;
}

export function finalize(input: MergedArgs): ResolvedConfig {
  // Access token required
  if (!input.accessToken) {
    throw new Error(
      "Error: No access token was provided. Pass one with `--access-token` or via `SENTRY_ACCESS_TOKEN`.",
    );
  }

  // Determine host from url/host with validation
  let sentryHost = "sentry.io";
  if (input.url) {
    sentryHost = validateAndParseSentryUrlThrows(input.url);
  } else if (input.host) {
    validateSentryHostThrows(input.host);
    sentryHost = input.host;
  }

  // Scopes resolution
  let finalScopes: Set<Scope> | undefined = undefined;
  if (input.allScopes) {
    finalScopes = new Set<Scope>(ALL_SCOPES as ReadonlyArray<Scope>);
  } else if (input.scopes || input.addScopes) {
    // Strict validation: any invalid token is an error
    if (input.scopes) {
      const { valid, invalid } = parseScopes(input.scopes);
      if (invalid.length > 0) {
        throw new Error(formatInvalid(invalid));
      }
      if (valid.size === 0) {
        throw new Error(
          "Error: Invalid scopes provided. No valid scopes found.",
        );
      }
      finalScopes = resolveScopes({
        override: valid,
        defaults: DEFAULT_SCOPES,
      });
    } else if (input.addScopes) {
      const { valid, invalid } = parseScopes(input.addScopes);
      if (invalid.length > 0) {
        throw new Error(formatInvalid(invalid));
      }
      if (valid.size === 0) {
        throw new Error(
          "Error: Invalid additional scopes provided. No valid scopes found.",
        );
      }
      finalScopes = resolveScopes({ add: valid, defaults: DEFAULT_SCOPES });
    }
  }

  return {
    accessToken: input.accessToken,
    sentryHost,
    mcpUrl: input.mcpUrl,
    sentryDsn: input.sentryDsn,
    finalScopes,
    organizationSlug: input.organizationSlug,
    projectSlug: input.projectSlug,
  };
}
