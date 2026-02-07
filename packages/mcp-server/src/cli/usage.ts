import type { Skill } from "@sentry/mcp-core/skills";

export function buildUsage(
  packageName: string,
  allSkills: ReadonlyArray<Skill>,
): string {
  return `Usage: ${packageName} --access-token=<token> [--host=<host>]

Required:
  --access-token <token>  Sentry User Auth Token with API access

Common optional flags:
  --host <host>           Change Sentry host (self-hosted)
  --sentry-dsn <dsn>      Override DSN used for telemetry reporting
  --agent                 Agent mode: only expose use_sentry tool (for AI agents)
  --experimental          Enable experimental tools (hidden by default)

Embedded agent configuration:
  --agent-provider <provider>   LLM provider: openai or anthropic (auto-detects from API keys)
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
  OPENAI_API_KEY          OpenAI API key for AI-powered search tools
  ANTHROPIC_API_KEY       Anthropic API key for AI-powered search tools
  EMBEDDED_AGENT_PROVIDER Provider override: openai or anthropic
  MCP_DISABLE_SKILLS      Disable specific skills (comma-separated)

Examples:
  ${packageName} --access-token=TOKEN
  ${packageName} --access-token=TOKEN --skills=inspect,triage
  ${packageName} --access-token=TOKEN --host=sentry.example.com
  ${packageName} --access-token=TOKEN --host=sentry.example.com --disable-skills=seer
  ${packageName} --access-token=TOKEN --agent-provider=anthropic`;
}
