# GitHub Actions

CI/CD workflows for the Sentry MCP project.

## Workflows

### test.yml
Runs on all pushes to main and pull requests:
- Build, lint, unit tests
- Code coverage reporting

### deploy.yml
Runs after the canonical Test workflow passes on the current `main` revision:
- Claims and reconciles the newest durable journal before any new build or upload
- Builds the production worker once and records the artifact and traffic-config digests
- Uploads one production-scoped candidate version without changing traffic
- Persists a recovery journal before the first traffic change
- Assigns the candidate 0% traffic and smoke-tests that exact version through the production route
- Promotes the same candidate version to 100% traffic
- Restores the captured previous version after any later failure

### recover-cloudflare-deployment.yml
Runs after every deployment workflow attempt. It reads the newest journal from the protected `cloudflare-deployment-journal` branch, then verifies that journal's exact deployment run. Before any Cloudflare operation, it atomically claims that journal at the exact branch head. Successful deployments must still own production. Failed, cancelled, and timed-out deployments restore only the journal's captured previous version, and only while Cloudflare remains in a state owned by that run. The triggering run never selects recovery order.

### eval.yml
Runs evaluation tests against the MCP server.

## Required Secrets

The `production` environment, restricted to `main`, must contain:

- **`CLOUDFLARE_API_TOKEN`** - Cloudflare API token with Workers deployment permissions

Verify that the environment secret works, then delete any repository-level copy. The production token must never be stored as a repository secret.

Repository secrets:

- **`CLOUDFLARE_ACCOUNT_ID`** - Your Cloudflare account ID  
- **`SENTRY_AUTH_TOKEN`** - For Sentry release tracking
- **`SENTRY_CLIENT_SECRET`** - Sentry OAuth client secret
- **`COOKIE_SECRET`** - Session cookie encryption secret
- **`OPENAI_API_KEY`** - For AI-powered search features

### Deployment Flow
1. **Validate** - Bind the trigger to the canonical successful Test run and current default-branch SHA.
2. **Prior-run gate** - Claim the latest journal through a non-forced Git reference update, reclassify live Cloudflare state, then verify or restore it. A takeover first proves through the Actions API that the previous claimant terminated.
3. **Build and freeze** - Build `sentry-mcp` once, copy the complete upload tree to an immutable temporary directory, resolve its generated config and referenced entry points inside that tree, and hash that exact directory.
4. **Upload** - Create one Worker version from the frozen tree through its explicit generated config without assigning traffic or rebuilding source.
5. **Journal** - Record the artifact and traffic-only config digests, validated Worker name and GUID, original deployment, previous version, candidate version, run identity, and exact deployment messages in one atomic commit on the protected `cloudflare-deployment-journal` branch.
6. **Candidate deployment** - Create an exact two-version deployment with the previous version at 100% and the candidate at 0%. Traffic-only Wrangler calls use a minimal config that omits non-versioned settings, so they never change observability or tail consumers.
7. **Candidate smoke test** - Send `Cloudflare-Workers-Version-Overrides` for the candidate UUID through `https://mcp.sentry.dev` and require the response version metadata to match.
8. **Promotion** - Assign the same tested candidate UUID 100% traffic.
9. **Production smoke test** - Test normal production traffic and require the same candidate UUID.
10. **Reconciliation** - Claim the current journal, verify successful ownership or explicitly deploy the captured previous version at 100% after failure, then atomically complete the claim with the observed state.

Never use bare `wrangler rollback`. It searches history and can restore a version unrelated to the failed run. Recovery always uses the journal's exact previous version and refuses to overwrite an external deployment.

Cloudflare has no conditional deployment or compare-and-swap API. A dashboard or external API deployment can occur between the final ownership check and a recovery deployment. The workflow detects observed interference and refuses restoration, but it cannot close that final server-side race. Never deploy this Worker outside the GitHub workflow while deployment or recovery is active.

### Durable Journal Store

The `cloudflare-deployment-journal` branch is an append-only recovery log. Each deployment adds an immutable `.github/cloudflare-deployment-journals/<run-id>-<attempt>.json` file and updates `latest.json` in the same Git commit. Every verification or restoration first adds an immutable claim under `.github/cloudflare-deployment-journals/reconciliations/` and updates `reconciliation.json`; after observing the required live state, it adds an immutable completion and advances the pointer again. Every change requires the exact prior branch head and uses one non-forced Git reference update. A concurrent writer makes the update fail; the workflow never appends onto or retries against newer state.

An incomplete claim blocks journal appends and other reconcilers. A later workflow may take it over only after the GitHub Actions API proves the recorded claimant run and attempt completed unsuccessfully. The takeover then captures a new claim before re-reading Cloudflare, so only the claim winner may mutate traffic.

This branch is independent of workflow-run artifacts and their retention. Never merge it into `main`, delete it, force-push it, or edit its journal files. Repository collaborators are trusted, but the branch must still have an active ruleset that blocks deletion and non-fast-forward updates.

Bootstrap the store once after this workflow reaches `main`:

1. Create an active branch ruleset for `refs/heads/cloudflare-deployment-journal` with the `deletion` and `non_fast_forward` rules. Do not add a rule that blocks ordinary fast-forward updates from GitHub Actions.
2. Let the first trusted post-merge deployment fail with `The durable Cloudflare journal branch is not initialized`. This failure happens before build, upload, or traffic mutation.
3. Check out that exact trusted `main` revision locally and set `GH_TOKEN` to a token with repository contents write and Actions read access, plus `GITHUB_REPOSITORY=getsentry/sentry-mcp`.
4. Run `node scripts/cloudflare-journal-store.mjs bootstrap <failed-deploy-run-id> <run-attempt>`. The command derives the trusted SHA from fresh GitHub API data. It requires the canonical deployment attempt to be the current default-branch head, to have failed at the pre-mutation journal gate, and to have skipped every later workflow step.
5. Verify `node scripts/cloudflare-journal-store.mjs state <new-output-file>` reports `initialized`. The output path must not already exist.
6. Rerun the failed deployment. Its new attempt will see an initialized empty store, append the first journal before traffic changes, and proceed.

Bootstrap always fails if the journal branch already exists. Deployment and recovery always fail closed if the branch is absent, uninitialized, malformed, deleted, or rewritten into an invalid layout.

## Manual Deployment

Manual deployment is disabled. Push the intended revision to `main`; the trusted Test workflow triggers deployment after it passes.

## Troubleshooting

1. **Authentication failed** - Check `CLOUDFLARE_API_TOKEN` permissions
2. **Build failures** - Review TypeScript/build logs
3. **Smoke test failures** - Check worker logs in Cloudflare dashboard
4. **Recovery refused** - Stop all external deployment activity, inspect the journal and Cloudflare deployment history, and identify the external state change. Never run bare rollback.
