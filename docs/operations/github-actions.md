# GitHub Actions

CI/CD workflows for the Sentry MCP project.

**Toolkit import landing:** The `Deploy to Cloudflare` job is disabled while
the CLI and docs import lands. A passing `Test` run on `main` cannot change the
production Worker. Restore deployments only through a separately reviewed
workflow change. `pnpm build` builds the MCP workspace; `pnpm build:cli` builds
the imported CLI and docs when `SENTRY_CLIENT_ID` is available.

## Workflows

### test.yml
Runs on pushes to `main`, pull requests, and merge queue entries. Discovery
reads pnpm workspace projects and their package scripts. Pull requests check
changed projects, their workspace consumers, and semantic dependencies (the CLI
docs depend on `sentry`). Root-level changes and non-PR events check every
enabled project. Each project has its own build, lint, typecheck, test, policy,
and E2E steps when those scripts exist. The always-present `test` job checks
discovery, installation, repository quality, and every selected project.
Package-specific exceptions live in `package.json#sentryCi`; the standalone
smoke-test suite remains in its own workflow.

### deploy.yml
Currently disabled. Its old canary, production, and rollback steps must not
run until a separately reviewed workflow replaces them.

### eval.yml
Runs evaluation tests against the MCP server.

### pr-risk-jev.yml
Classifies PR risk with Jev and publishes one `risk: low`, `risk: medium`, or
`risk: high` label. Runs when a non-draft PR is opened, updated with a push,
reopened, marked ready for review, or edited. Manual dispatch accepts a PR number
and also supports drafts.

The pinned risk Action reads PR metadata and Git diffs without checking out or
executing PR code. Labels are only published for the analyzed revision; unrelated
labels are preserved. An unchanged classification makes no label changes.
If a current-revision analysis fails, previous risk labels
are cleared and the PR stays unclassified. Results are retained as workflow
artifacts for 30 days.

### pr-risk-labels-test.yml
Runs the label publisher's regression tests when its workflow or tests change.
Covers label replacement, stale revisions, failed classifications, and concurrent
label creation.

## Required Secrets

Repository secrets (no environment needed):

- **`CLOUDFLARE_API_TOKEN`** - Cloudflare API token with Workers deployment permissions
- **`CLOUDFLARE_ACCOUNT_ID`** - Your Cloudflare account ID  
- **`SENTRY_AUTH_TOKEN`** - For Sentry release tracking
- **`SENTRY_CLIENT_SECRET`** - Sentry OAuth client secret
- **`COOKIE_SECRET`** - Session cookie encryption secret
- **`OPENAI_API_KEY`** - For AI-powered search features
- **`AI_GATEWAY_API_KEY`** - Vercel AI Gateway key for Jev PR risk classification

## Deployment Architecture

### Workers
- **`sentry-mcp`** - Production worker at `https://mcp.sentry.dev`
- **`sentry-mcp-canary`** - Canary worker at `https://sentry-mcp-canary.getsentry.workers.dev`

### Resource Isolation
Canary and production use separate resources for complete isolation:

| Resource | Production | Canary |
|----------|------------|---------|
| KV Namespace | `8dd5e9bafe1945298e2d5ca3b408a553` | `a3fe0d23b2d34416930e284362a88a3b` |
| Rate Limiter IDs | `1001`, `1002`, `1003`, `1004` | `2001`, `2002`, `2003`, `2004` |
| Wrangler Config | `wrangler.jsonc` | `wrangler.canary.jsonc` |

### Deployment Flow

No production deployment runs while the import lands. The disabled workflow's
old rollback step must not be used to recover production.

## Manual Deployment

The deployment job is also disabled for manual workflow dispatch. Do not use
the old rollback path to deploy or recover the production Worker.

## Troubleshooting

1. **Authentication failed** - Check `CLOUDFLARE_API_TOKEN` permissions
2. **Build failures** - Review TypeScript/build logs
3. **Smoke test failures** - Check worker logs in Cloudflare dashboard
