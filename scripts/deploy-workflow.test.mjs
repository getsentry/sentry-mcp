import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/deploy.yml", import.meta.url),
  "utf8",
);

test("production deploy requires a successful Test run on this repository's main branch", () => {
  assert.doesNotMatch(workflow, /if:\s*\$\{\{\s*false\s*\}\}/);
  assert.match(workflow, /workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /workflow_run\.event == 'push'/);
  assert.match(
    workflow,
    /workflow_run\.head_repository\.id == github\.event\.repository\.id/,
  );
  assert.match(workflow, /workflow_run\.head_branch == 'main'/);
  assert.doesNotMatch(workflow, /^\s*workflow_dispatch:/m);
  assert.match(
    workflow,
    /ref:\s*\$\{\{ github\.event\.workflow_run\.head_sha \}\}/,
  );
  assert.match(workflow, /environment:\s*production/);
  assert.match(workflow, /group:\s*mcp-production-deploy/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /cloudflare-deployment\.mjs capture/);
  assert.match(workflow, /cloudflare-deployment\.mjs verify/);
  assert.match(workflow, /cloudflare-deployment\.mjs recover/);
  assert.match(workflow, /wrangler deploy --message "toolkit-mcp:/);
});

test("deployment failures never invoke an unqualified rollback", () => {
  assert.doesNotMatch(workflow, /(?:command:|pnpm exec wrangler)\s+rollback\b/);
  assert.match(workflow, /steps\.production_smoke_tests\.outcome == 'failure'/);
  assert.match(workflow, /exit 1/);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
});

test("external actions use immutable commit pins", () => {
  for (const [, action] of workflow.matchAll(
    /^\s*(?:- )?uses:\s*([^\s#]+)/gm,
  )) {
    assert.match(action, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, action);
  }
});
