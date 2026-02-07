import { ALL_SKILLS, parseSkills, type Skill } from "@sentry/mcp-core/skills";
import {
  validateAndParseSentryUrlThrows,
  validateOpenAiBaseUrlThrows,
  validateSentryHostThrows,
} from "@sentry/mcp-core/utils/url-utils";
import type { MergedArgs, ResolvedConfig } from "./types";

export function formatInvalidSkills(
  invalid: string[],
  source?: string,
): string {
  const prefix = source ? `${source} provided` : "Invalid skills provided";
  return `Error: ${prefix}: ${invalid.join(", ")}\nAvailable skills: ${ALL_SKILLS.join(", ")}`;
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
  let finalSkills: Set<Skill>;
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
    finalSkills = new Set<Skill>(ALL_SKILLS);
  }

  // Disable-skills: remove specific skills from the active set
  if (input.disableSkills) {
    const { valid: skillsToDisable, invalid } = parseSkills(
      input.disableSkills,
    );
    if (invalid.length > 0) {
      throw new Error(formatInvalidSkills(invalid, "--disable-skills"));
    }
    for (const skill of skillsToDisable) {
      finalSkills.delete(skill);
    }
    if (finalSkills.size === 0) {
      throw new Error(
        "Error: All skills have been disabled. At least one skill must remain enabled.",
      );
    }
  }

  const resolvedOpenAiBaseUrl = input.openaiBaseUrl
    ? validateOpenAiBaseUrlThrows(input.openaiBaseUrl)
    : undefined;

  // Validate anthropic base URL if provided (same validation as OpenAI)
  const resolvedAnthropicBaseUrl = input.anthropicBaseUrl
    ? validateOpenAiBaseUrlThrows(input.anthropicBaseUrl)
    : undefined;

  // Validate agent provider if explicitly set
  let agentProvider: "openai" | "anthropic" | undefined = undefined;
  if (input.agentProvider) {
    const provider = input.agentProvider.toLowerCase();
    if (provider !== "openai" && provider !== "anthropic") {
      throw new Error(
        `Error: Invalid agent provider "${input.agentProvider}". Must be "openai" or "anthropic".`,
      );
    }
    agentProvider = provider;
  }

  return {
    accessToken: input.accessToken,
    sentryHost,
    mcpUrl: input.mcpUrl,
    sentryDsn: input.sentryDsn,
    openaiBaseUrl: resolvedOpenAiBaseUrl,
    openaiModel: input.openaiModel,
    anthropicBaseUrl: resolvedAnthropicBaseUrl,
    anthropicModel: input.anthropicModel,
    agentProvider,
    finalSkills,
    organizationSlug: input.organizationSlug,
    projectSlug: input.projectSlug,
  };
}
