import type { Skill } from "@sentry/mcp-core/skills";

export function buildUsage(
  packageName: string,
  allSkills: ReadonlyArray<Skill>,
): string {
  return `Usage: ${packageName} [--access-token=<token>] [--host=<host>]
       ${packageName} auth [login|logout|status]

Commands:
  auth login              Authenticate via device code flow (sentry.io only)
  auth logout             Clear cached authentication
  auth status             Show current authentication state

Authentication:
  --access-token <token>  Sentry User Auth Token with API access
                          Optional for sentry.io (device code flow is used if omitted)
                          Required for self-hosted instances

Common optional flags:
  --host <host>           Change Sentry host (self-hosted)
  --sentry-dsn <dsn>      Override DSN used for telemetry reporting
  --agent                 Agent mode: only expose use_sentry tool (for AI agents)
  --experimental          Enable forward-looking tool variants and experimental features

Embedded agent configuration:
  --agent-provider <provider>   LLM provider: openai, azure-openai, or anthropic (auto-detects from API keys)
  --openai-base-url <url>       Override OpenAI API base URL
  --openai-model <model>        Override OpenAI model (default: gpt-5)
  --anthropic-base-url <url>    Override Anthropic API base URL
  --anthropic-model <model>     Override Anthropic model (default: claude-sonnet-4-5)

Session constraints:
  --organization-slug <slug>  Force all calls to an organization
  --project-slug <slug>       Optional project constraint

Skill controls:
  --skills <list>           Specify which skills to grant (default: all skills)
  --disable-skills <list>   Remove specific skills (e.g. --disable-skills=seer)

All skills: ${allSkills.join(", ")}

Environment variables:
  SENTRY_ACCESS_TOKEN     Sentry auth token (alternative to --access-token)
  SENTRY_CLIENT_ID        Override OAuth client ID for device code flow
  OPENAI_API_KEY          OpenAI API key for AI-powered search tools
  ANTHROPIC_API_KEY       Anthropic API key for AI-powered search tools
  EMBEDDED_AGENT_PROVIDER Provider override: openai, azure-openai, or anthropic
  MCP_DISABLE_SKILLS      Disable specific skills (comma-separated)

Examples:
  ${packageName}                                        # device code auth (sentry.io only)
  ${packageName} --access-token=TOKEN
  ${packageName} --access-token=TOKEN --skills=inspect,triage
  ${packageName} --access-token=TOKEN --host=sentry.example.com
  ${packageName} --access-token=TOKEN --host=sentry.example.com --disable-skills=seer
  ${packageName} --access-token=TOKEN --agent-provider=azure-openai --openai-base-url=https://example.openai.azure.com/openai/v1/
  ${packageName} --access-token=TOKEN --agent-provider=anthropic`;
}
