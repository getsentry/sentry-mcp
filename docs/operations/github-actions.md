# GitHub Actions

CI/CD workflows for the Sentry MCP project.

`pnpm build` builds the MCP workspace; `pnpm build:cli` builds the imported CLI
and docs when `SENTRY_CLIENT_ID` is available.

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
Runs after a successful `Test` push run on `main`. Checks out the tested commit,
requires that it is still the tip of `main`, then deploys and tests canary.
Records the active production version before changing traffic, deploys the
tested commit, and verifies the run-owned candidate before production smoke
tests. If those fail, restores the captured version only while this run's
candidate remains active. External changes stop recovery.

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

The `production` environment is restricted to `main` and holds:

- **`CLOUDFLARE_API_TOKEN`** - Cloudflare API token with Workers deployment permissions

Other configuration:

- **`CLOUDFLARE_ACCOUNT_ID`** - ID of the account owning the Workers
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

The workflow never deploys an untested revision or a stale `main` commit.
Failure to identify the prior active version, verify deployment ownership, or
confirm the restored version fails the job rather than guessing a recovery.

## Manual Deployment

Manual production dispatch is unavailable. Use a reviewed change and its
passing `Test` run to deploy. Never run bare `wrangler rollback` against
production; that command chooses from mutable history.

## Troubleshooting

1. **Authentication failed** - Check `CLOUDFLARE_API_TOKEN` permissions
2. **Build failures** - Review TypeScript/build logs
3. **Smoke test failures** - Check worker logs in Cloudflare dashboard
