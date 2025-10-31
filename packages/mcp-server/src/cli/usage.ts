import type { Scope } from "../permissions";

export function buildUsage(
  packageName: string,
  defaults: ReadonlyArray<Scope>,
  all: ReadonlyArray<Scope>,
): string {
  return `Usage: ${packageName} --access-token=<token> [--host=<host>]

Required:
  --access-token <token>  Sentry User Auth Token with API access

Common optional flags:
  --host <host>           Change Sentry host (self-hosted)
  --sentry-dsn <dsn>      Override DSN used for telemetry reporting
  --openai-base-url <url> Override OpenAI API base URL for embedded agents
  --openai-model <model>  Override OpenAI model (default: gpt-5, reasoning effort: low)
  --agent                 Agent mode: only expose use_sentry tool (for AI agents)

Session constraints:
  --organization-slug <slug>  Force all calls to an organization
  --project-slug <slug>       Optional project constraint

Scope controls:
  --scopes <list>     Override default scopes
  --add-scopes <list> Add scopes to defaults
  --all-scopes        Grant every available scope

Defaults: ${defaults.join(", ")}
All scopes: ${all.join(", ")}

Examples:
  ${packageName} --access-token=TOKEN
  ${packageName} --access-token=TOKEN --host=sentry.example.com
  ${packageName} --access-token=TOKEN --openai-model=o1-mini
  ${packageName} --access-token=TOKEN --openai-base-url=https://proxy.example.com/v1`;
}
