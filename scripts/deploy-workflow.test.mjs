import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/deploy.yml", import.meta.url),
  "utf8",
);
const recoveryWorkflow = readFileSync(
  new URL(
    "../.github/workflows/recover-cloudflare-deployment.yml",
    import.meta.url,
  ),
  "utf8",
);
const bootstrapWorkflow = readFileSync(
  new URL(
    "../.github/workflows/bootstrap-cloudflare-journal.yml",
    import.meta.url,
  ),
  "utf8",
);
const validateDeployment = readFileSync(
  new URL("./validate-deployment.mjs", import.meta.url),
  "utf8",
);

test("production deploy requires a successful Test run on this repository's main branch", () => {
  assert.doesNotMatch(workflow, /if:\s*\$\{\{\s*false\s*\}\}/);
  assert.match(workflow, /workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /node "\$RUNNER_TEMP\/validate-deployment\.mjs"/);
  assert.match(validateDeployment, /apiRun\.event !== "push"/);
  assert.match(
    validateDeployment,
    /apiRun\.head_repository\?\.full_name !== repository\.full_name/,
  );
  assert.match(
    validateDeployment,
    /apiRun\.head_branch !== repository\.default_branch/,
  );
  assert.doesNotMatch(workflow, /^\s*workflow_dispatch:/m);
  assert.match(
    workflow,
    /ref:\s*\$\{\{ steps\.validate\.outputs\.head-sha \}\}/,
  );
  assert.match(workflow, /environment:\s*production/);
  assert.match(workflow, /group:\s*deploy-cloudflare-production/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /cloudflare-journal-store\.mjs state/);
  assert.match(workflow, /cloudflare-journal-store\.mjs append/);
  assert.match(workflow, /transition candidate/);
  assert.match(workflow, /transition promoted/);
  assert.match(workflow, /cloudflare-reconcile\.sh restore/);
});

test("production build retains Sentry DSN and source-map upload credentials", () => {
  const buildStep = workflow
    .split("- name: Build production artifact once")[1]
    ?.split("- name:")[0];
  assert.ok(buildStep, "production build step must exist");
  assert.match(
    buildStep,
    /SENTRY_AUTH_TOKEN:\s*\$\{\{ secrets\.SENTRY_AUTH_TOKEN \}\}/,
  );
  assert.match(
    buildStep,
    /VITE_SENTRY_DSN:\s*\$\{\{ secrets\.VITE_SENTRY_DSN \}\}/,
  );
  assert.match(buildStep, /VITE_SENTRY_ENVIRONMENT:\s*production/);
});

test("deployment failures never invoke an unqualified rollback", () => {
  assert.doesNotMatch(
    workflow + recoveryWorkflow,
    /(?:command:|pnpm exec wrangler)\s+rollback\b/,
  );
  assert.match(
    workflow,
    /if: always\(\) && steps\.journal\.outputs\.ready == 'true'/,
  );
  assert.match(recoveryWorkflow, /cloudflare-journal-store\.mjs state/);
  assert.match(recoveryWorkflow, /cloudflare-reconcile\.sh/);
  assert.match(bootstrapWorkflow, /ref:\s*\$\{\{ github\.workflow_sha \}\}/);
  for (const candidate of [workflow, recoveryWorkflow, bootstrapWorkflow]) {
    assert.match(candidate, /group:\s*deploy-cloudflare-production/);
    assert.match(candidate, /environment:\s*production/);
  }
});

test("external actions use immutable commit pins", () => {
  for (const [, action] of (
    workflow +
    recoveryWorkflow +
    bootstrapWorkflow
  ).matchAll(/^\s*(?:- )?uses:\s*([^\s#]+)/gm)) {
    assert.match(action, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, action);
  }
});
