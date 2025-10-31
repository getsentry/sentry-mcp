import {
  ALL_SCOPES,
  parseScopes,
  resolveScopes,
  type Scope,
} from "../permissions";
import { parseSkills, SKILLS, type Skill } from "../skills";
import { DEFAULT_SCOPES } from "../constants";
import {
  validateAndParseSentryUrlThrows,
  validateOpenAiBaseUrlThrows,
  validateSentryHostThrows,
} from "../utils/url-utils";
import type { MergedArgs, ResolvedConfig } from "./types";

export function formatInvalid(invalid: string[], envName?: string): string {
  const where = envName ? `${envName} provided` : "Invalid scopes provided";
  return `Error: ${where}: ${invalid.join(", ")}\nAvailable scopes: ${ALL_SCOPES.join(", ")}`;
}

export function formatInvalidSkills(
  invalid: string[],
  envName?: string,
): string {
  const where = envName ? `${envName} provided` : "Invalid skills provided";
  const allSkills = Object.keys(SKILLS).join(", ");
  return `Error: ${where}: ${invalid.join(", ")}\nAvailable skills: ${allSkills}`;
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

  // Scopes resolution (LEGACY - deprecated in favor of skills)
  let finalScopes: Set<Scope> | undefined = undefined;
  if (input.allScopes) {
    console.warn(
      "⚠️  Warning: --all-scopes is deprecated. Consider using skills instead:",
    );
    console.warn("   --skills=inspect,triage,project-management,seer,docs");
    console.warn("   Learn more about skills in the documentation.");
    console.warn("");
    finalScopes = new Set<Scope>(ALL_SCOPES as ReadonlyArray<Scope>);
  } else if (input.scopes || input.addScopes) {
    // Show deprecation warning
    if (input.scopes) {
      console.warn(
        "⚠️  Warning: --scopes is deprecated. Consider using skills instead:",
      );
      console.warn(
        "   For example, instead of --scopes=event:write,project:write",
      );
      console.warn("   Use: --skills=triage,project-management");
      console.warn("   Learn more about skills in the documentation.");
      console.warn("");
    } else if (input.addScopes) {
      console.warn(
        "⚠️  Warning: --add-scopes is deprecated. Consider using --skills instead:",
      );
      console.warn("   For example, instead of --add-scopes=event:write");
      console.warn("   Use: --skills=triage");
      console.warn("   Learn more about skills in the documentation.");
      console.warn("");
    }

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

  // Skills resolution
  //
  // IMPORTANT: stdio (CLI) intentionally defaults to ALL skills when no --skills flag is provided
  //
  // This differs from the OAuth flow, which requires explicit user selection:
  // - stdio/CLI: Non-interactive, defaults to ALL skills (inspect, docs, seer, triage, project-management)
  // - OAuth: Interactive, requires user to explicitly select skills (with sensible defaults pre-checked)
  //
  // Rationale:
  // We don't want the MCP to break if users don't specify skills. stdio is typically used in
  // local development and CI/CD environments where maximum access by default is expected.
  // OAuth is used in multi-tenant hosted environments where users should consciously grant
  // permissions on a per-app basis.
  //
  // For OAuth validation that enforces minimum 1 skill selection, see:
  // packages/mcp-cloudflare/src/server/oauth/routes/callback.ts (lines 234-248)
  //
  let finalSkills: Set<Skill> | undefined = undefined;
  if (input.skills) {
    // Override: use only the specified skills
    const { valid, invalid } = parseSkills(input.skills);
    if (invalid.length > 0) {
      throw new Error(formatInvalidSkills(invalid));
    }
    if (valid.size === 0) {
      throw new Error("Error: Invalid skills provided. No valid skills found.");
    }
    finalSkills = valid;
  } else {
    // Default: grant ALL skills when no flag is provided (see comment block above for rationale)
    const allSkills = Object.keys(SKILLS) as Skill[];
    finalSkills = new Set<Skill>(allSkills);
  }

  const resolvedOpenAiBaseUrl = input.openaiBaseUrl
    ? validateOpenAiBaseUrlThrows(input.openaiBaseUrl)
    : undefined;

  return {
    accessToken: input.accessToken,
    sentryHost,
    mcpUrl: input.mcpUrl,
    sentryDsn: input.sentryDsn,
    openaiBaseUrl: resolvedOpenAiBaseUrl,
    openaiModel: input.openaiModel,
    finalScopes,
    finalSkills,
    organizationSlug: input.organizationSlug,
    projectSlug: input.projectSlug,
  };
}
