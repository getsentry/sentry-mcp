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
requires that it is still the tip of `main`, and reads the authenticated
deployment journal before touching Cloudflare. It builds one frozen artifact,
uploads a production-scoped version, records the previous active version, and
appends the recovery journal. It activates the candidate at zero percent
traffic and smoke-tests that exact version through a Worker version override.
Only then does it promote the version to production and smoke-test live traffic.
Failed deployments restore the captured version only after an exact ownership
check. External or ambiguous state stops recovery.

### recover-cloudflare-deployment.yml
Runs after deployment to verify or reconcile the newest authenticated journal.
It never selects a recovery version from mutable deployment history.

### bootstrap-cloudflare-journal.yml
Initializes the protected journal branch once, from a reviewed `main` revision
and a verified deployment that failed before mutating Cloudflare. Follow the
[journal bootstrap procedure](../cloudflare-deployment.md); never create the
branch by hand or dispatch bootstrap after initialization.

### migrate-cloudflare-token.yml
Moves the Cloudflare API token from a repository secret into the protected
`production` environment. Only `main` in the Toolkit repository can run it.
Copy and removal are separate dispatches so a normal production deployment can
prove that the environment copy works before the repository copy is deleted.

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

During migration, the same name also exists as a repository secret. A temporary
`CLOUDFLARE_MIGRATION_PAT` environment secret gives the migration workflow
permission to write environment secrets and delete the repository copy. The
workflow deletes this PAT secret after successful cleanup.

Other configuration:

- **`CLOUDFLARE_ACCOUNT_ID`** - ID of the account owning the Workers
- **`SENTRY_AUTH_TOKEN`** - For Sentry release tracking
- **`SENTRY_CLIENT_SECRET`** - Sentry OAuth client secret
- **`COOKIE_SECRET`** - Session cookie encryption secret
- **`OPENAI_API_KEY`** - For AI-powered search features
- **`AI_GATEWAY_API_KEY`** - Vercel AI Gateway key for Jev PR risk classification

## Deployment Architecture

### Worker
**`sentry-mcp`** serves production at `https://mcp.sentry.dev`. The candidate
is a version of this same Worker, tested through a version override while
production traffic still uses the preceding version.

### Deployment Flow

The workflow never deploys an untested revision or a stale `main` commit.
Failure to identify the prior active version, verify deployment ownership, or
confirm the restored version fails the job rather than guessing a recovery.
The [durable journal](../cloudflare-deployment.md) binds deployment and recovery
to reviewed code and authenticated Git history.

## Manual Deployment

Manual production dispatch is unavailable. Use a reviewed change and its
passing `Test` run to deploy. Never run bare `wrangler rollback` against
production; that command chooses from mutable history.

## Cloudflare token migration

1. Merge the reviewed migration workflow into `main`. Create a fine-grained PAT
   for `getsentry/toolkit` with repository **Secrets: read/write** permission.
   Store it as `CLOUDFLARE_MIGRATION_PAT` in the protected `production`
   environment. Never pass the PAT in a workflow input or command argument.
2. Dispatch `Move Cloudflare token to production environment` on `main` with
   `operation=copy`. Confirm success and check that `CLOUDFLARE_API_TOKEN`
   appears in both repository and `production` environment secret-name lists.
3. Wait for a normal `Test` push on `main` to trigger `Deploy to Cloudflare`.
   Confirm that the deployment passed canary and production smoke tests and
   served the intended revision. Record its workflow run ID; its start time
   must be after the environment secret was copied.
4. Dispatch the migration workflow again on `main` with `operation=remove` and
   that successful deployment run ID. The workflow checks the run's identity,
   result, timing, and successful canary and production deployment and smoke-test
   steps, then deletes the repository-scoped Cloudflare token.
   Check that only the environment copy remains and the temporary PAT secret
   has been removed. Revoke the PAT after use.

If a step fails, keep the repository copy until a successful post-copy
deployment has been verified. Never print either credential while diagnosing
the failure.

## Troubleshooting

1. **Authentication failed** - Check `CLOUDFLARE_API_TOKEN` permissions
2. **Build failures** - Review TypeScript/build logs
3. **Smoke test failures** - Check worker logs in Cloudflare dashboard
