import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import {
  buildMatrix,
  buildProjects,
  buildRuntimeMatrix,
  findProjectsByRole,
  selectAffectedProjects,
} from "./ci-projects.mjs";
import { normalizeLcovPaths } from "./normalize-lcov.mjs";
import { validateDeployment } from "./validate-deployment.mjs";
import { validateWorkflowRun } from "./validate-workflow-run.mjs";

function entry(name, path, manifest = {}) {
  return {
    path,
    manifest: {
      name,
      ...manifest,
    },
  };
}

describe("CI project discovery", () => {
  it("infers checks and coverage from package scripts", () => {
    const [project] = buildProjects([
      entry("@example/core", "packages/core", {
        scripts: {
          build: "tsc",
          lint: "biome check .",
          check: "tsc --noEmit",
          tsc: "tsc --noEmit",
          "test:ci":
            "vitest run --coverage --reporter=junit --outputFile=tests.junit.xml",
          "test:e2e": "vitest run test/e2e",
          "ci:policy": "node check-policy.mjs",
        },
      }),
    ]);

    assert.deepEqual(buildMatrix([project]), {
      include: [
        {
          name: "@example/core",
          path: "packages/core",
          slug: "example-core",
          build: "build",
          lint: "lint",
          typecheck: "tsc",
          test: "test:ci",
          e2e: "test:e2e",
          policy: "ci:policy",
          npmRuntime: "",
          runtimeBin: "",
          coverage: "packages/core/coverage/lcov.info",
          coverageDirectory: "packages/core/coverage",
          junit: "packages/core/tests.junit.xml",
        },
      ],
    });
  });

  it("selects transitive dependents from package and semantic edges", () => {
    const projects = buildProjects([
      entry("core", "packages/core"),
      entry("server", "packages/server", {
        dependencies: { core: "workspace:*" },
      }),
      entry("docs", "apps/docs", {
        sentryCi: { dependencies: ["server"] },
      }),
      entry("unrelated", "packages/unrelated"),
    ]);

    assert.deepEqual(
      selectAffectedProjects(
        projects,
        ["packages/core/src/index.ts"],
        "pull_request",
      ).map((project) => project.name),
      ["docs", "core", "server"],
    );
  });

  it("runs every enabled project for workspace-global changes and non-PR events", () => {
    const projects = buildProjects([
      entry("first", "packages/first"),
      entry("second", "packages/second"),
      entry("external-smoke", "packages/smoke", {
        sentryCi: { enabled: false },
      }),
    ]);

    assert.deepEqual(
      selectAffectedProjects(projects, ["pnpm-lock.yaml"], "pull_request").map(
        (project) => project.name,
      ),
      ["first", "second"],
    );
    assert.deepEqual(
      selectAffectedProjects(projects, [], "push").map(
        (project) => project.name,
      ),
      ["first", "second"],
    );
  });

  it("supports explicit test exclusion for externally configured suites", () => {
    const [project] = buildProjects([
      entry("smoke", "packages/smoke", {
        scripts: { "test:ci": "vitest run" },
        sentryCi: { test: false },
      }),
    ]);

    assert.equal(project.test, "");
  });

  it("supports package-local coverage paths", () => {
    const [project] = buildProjects([
      entry("service", "packages/service", {
        sentryCi: { coverage: "reports/lcov.info" },
      }),
    ]);

    assert.equal(project.coverage, "packages/service/reports/lcov.info");
    assert.equal(
      buildMatrix([project]).include[0].coverageDirectory,
      "packages/service/reports",
    );
  });

  it("supports safe paths with spaces and rejects action path delimiters", () => {
    const [project] = buildProjects([
      entry("core", "packages/core package", {
        scripts: { test: "vitest run" },
        sentryCi: { coverage: "coverage report/lcov.info" },
      }),
    ]);
    assert.equal(
      project.coverage,
      "packages/core package/coverage report/lcov.info",
    );

    for (const coverage of [
      "coverage\nother",
      "coverage,other",
      "coverage\\other",
      "C:/coverage/lcov.info",
      "coverage/**/lcov.info",
      "coverage/[generated]/lcov.info",
    ]) {
      assert.throws(
        () =>
          buildProjects([
            entry("core", "packages/core", {
              scripts: { test: "vitest run" },
              sentryCi: { coverage },
            }),
          ]),
        /must be a safe relative path/,
      );
    }
    assert.throws(
      () =>
        buildProjects([
          entry("core", "packages/core\nother", {
            scripts: { test: "vitest run --coverage" },
          }),
        ]),
      /workspace project path must be a safe relative path/,
    );
  });

  it("supports explicit JUnit report paths", () => {
    const [project] = buildProjects([
      entry("core", "packages/core", {
        scripts: { test: "vitest run" },
        sentryCi: { junit: "reports/unit.xml" },
      }),
    ]);

    assert.equal(project.junit, "packages/core/reports/unit.xml");
  });

  it("discovers packaged npm runtime checks", () => {
    const [project] = buildProjects([
      entry("sentry", "packages/cli", {
        bin: { sentry: "dist/bin.cjs" },
        scripts: { bundle: "node build.mjs" },
        sentryCi: { npmRuntime: "bundle" },
      }),
    ]);

    assert.deepEqual(
      {
        npmRuntime: project.npmRuntime,
        runtimeBin: project.runtimeBin,
      },
      {
        npmRuntime: "bundle",
        runtimeBin: "sentry",
      },
    );
  });

  it("omits projects with no runnable checks from the matrix", () => {
    const projects = buildProjects([
      entry("config-only", "packages/config-only"),
      entry("service", "packages/service", {
        scripts: { build: "tsc" },
      }),
    ]);

    assert.deepEqual(
      buildMatrix(projects).include.map((project) => project.name),
      ["service"],
    );
  });

  it("uses the most specific project path for nested workspaces", () => {
    const projects = buildProjects([
      entry("parent", "packages/parent"),
      entry("child", "packages/parent/child"),
    ]);

    assert.deepEqual(
      selectAffectedProjects(
        projects,
        ["packages/parent/child/src/index.ts"],
        "pull_request",
      ).map((project) => project.name),
      ["child"],
    );
  });

  it("rejects unsafe coverage paths and unknown configuration", () => {
    assert.throws(
      () =>
        buildProjects([
          entry("service", "packages/service", {
            sentryCi: { coverage: "../secret" },
          }),
        ]),
      /must be a safe relative path/,
    );
    assert.throws(
      () =>
        buildProjects([
          entry("service", "packages/service", {
            sentryCi: { typo: false },
          }),
        ]),
      /Unknown package\.json#sentryCi field: typo/,
    );
  });

  it("rejects unknown semantic dependencies", () => {
    assert.throws(
      () =>
        buildProjects([
          entry("docs", "apps/docs", {
            sentryCi: { dependencies: ["missing"] },
          }),
        ]),
      /unknown CI dependency 'missing'/,
    );
  });

  it("rejects packaged runtime checks without one safe binary", () => {
    assert.throws(
      () =>
        buildProjects([
          entry("service", "packages/service", {
            scripts: { bundle: "node build.mjs" },
            sentryCi: { npmRuntime: "bundle" },
          }),
        ]),
      /exactly one safe package binary/,
    );
    assert.throws(
      () =>
        buildProjects([
          entry("service", "packages/service", {
            bin: { "unsafe/bin": "dist/bin.cjs" },
            scripts: { bundle: "node build.mjs" },
            sentryCi: { npmRuntime: "bundle" },
          }),
        ]),
      /exactly one safe package binary/,
    );
  });

  it("caps the expanded packaged-runtime matrix", () => {
    const runtimeProjects = (count) => ({
      include: Array.from({ length: count }, (_, index) => ({
        name: `runtime-${index}`,
      })),
    });
    const nodeVersions = ["20.20.2", "22.23.1", "24.18.0"];

    assert.equal(
      buildRuntimeMatrix(runtimeProjects(85), nodeVersions).include.length,
      255,
    );
    assert.throws(
      () => buildRuntimeMatrix(runtimeProjects(86), nodeVersions),
      /at most 256 runtime jobs/,
    );
    assert.throws(
      () => buildRuntimeMatrix(runtimeProjects(1), ["20", "22.23.1"]),
      /unique exact versions/,
    );
  });

  it("resolves each specialized workflow role to exactly one project", () => {
    const projects = buildProjects([
      entry("worker", "packages/renamed-worker", {
        sentryCi: { roles: ["cloudflare"] },
      }),
      entry("smoke", "packages/renamed-smoke", {
        sentryCi: { enabled: false, roles: ["smoke"] },
      }),
    ]);

    assert.deepEqual(findProjectsByRole(projects, ["cloudflare", "smoke"]), {
      cloudflare: { name: "worker", path: "packages/renamed-worker" },
      smoke: { name: "smoke", path: "packages/renamed-smoke" },
    });
    const roleCommand = spawnSync(
      process.execPath,
      [
        resolve(import.meta.dirname, "../scripts/ci-projects.mjs"),
        "--roles",
        "cloudflare,smoke",
      ],
      { encoding: "utf8" },
    );
    assert.equal(roleCommand.status, 0, roleCommand.stderr);
    assert.deepEqual(Object.keys(JSON.parse(roleCommand.stdout)).sort(), [
      "cloudflare",
      "smoke",
    ]);
    assert.throws(
      () =>
        buildProjects([
          entry("first", "packages/first", {
            sentryCi: { roles: ["cloudflare"] },
          }),
          entry("second", "packages/second", {
            sentryCi: { roles: ["cloudflare"] },
          }),
        ]),
      /belongs to both first and second/,
    );
  });
});

describe("CI workflow contracts", () => {
  const root = resolve(import.meta.dirname, "..");
  const testWorkflow = readFileSync(
    resolve(root, ".github/workflows/test.yml"),
    "utf8",
  );
  const smokeWorkflow = readFileSync(
    resolve(root, ".github/workflows/smoke-tests.yml"),
    "utf8",
  );
  const publisherWorkflow = readFileSync(
    resolve(root, ".github/workflows/publish-test-results.yml"),
    "utf8",
  );
  const deployWorkflow = readFileSync(
    resolve(root, ".github/workflows/deploy.yml"),
    "utf8",
  );
  const recoveryWorkflow = readFileSync(
    resolve(root, ".github/workflows/recover-cloudflare-deployment.yml"),
    "utf8",
  );
  const mergeWorkflow = readFileSync(
    resolve(root, ".github/workflows/merge-jobs.yml"),
    "utf8",
  );
  const liveDeploymentAdapter = readFileSync(
    resolve(root, "scripts/cloudflare-deployment-live.sh"),
    "utf8",
  );
  const cloudflareReconciler = readFileSync(
    resolve(root, "scripts/cloudflare-reconcile.sh"),
    "utf8",
  );
  const smokeTestSource = readFileSync(
    resolve(root, "packages/smoke-tests/src/smoke.test.ts"),
    "utf8",
  );
  const productionWrangler = readFileSync(
    resolve(root, "packages/mcp-cloudflare/wrangler.jsonc"),
    "utf8",
  );
  const testWrangler = readFileSync(
    resolve(root, "packages/mcp-cloudflare/wrangler.test.jsonc"),
    "utf8",
  );

  it("pins every external action in the changed workflows", () => {
    for (const workflow of [
      testWorkflow,
      smokeWorkflow,
      publisherWorkflow,
      deployWorkflow,
      recoveryWorkflow,
    ]) {
      const actionReferences = [...workflow.matchAll(/uses:\s+([^\s#]+)/g)].map(
        (match) => match[1],
      );
      assert.ok(actionReferences.length > 0);
      for (const reference of actionReferences) {
        assert.match(reference, /@[0-9a-f]{40}$/);
      }
    }
  });

  it("uses the current Cloudflare compatibility date in production and tests", () => {
    for (const config of [productionWrangler, testWrangler]) {
      assert.match(config, /"compatibility_date": "2026-09-27"/);
    }
  });

  it("pins the JUnit publisher to the GHES-compatible release", () => {
    const junitRevision =
      "mikepenz/action-junit-report@a83fd2b5d58d4fc702e690c1ea688d702d28d281 # v5.6.1";
    assert.equal(
      publisherWorkflow.match(/mikepenz\/action-junit-report@/g)?.length,
      1,
    );
    assert.equal(
      deployWorkflow.match(/mikepenz\/action-junit-report@/g)?.length,
      2,
    );
    assert.equal(
      mergeWorkflow.match(/mikepenz\/action-junit-report@/g)?.length,
      1,
    );
    assert.match(publisherWorkflow, new RegExp(junitRevision));
    assert.equal(
      deployWorkflow.match(new RegExp(junitRevision, "g"))?.length,
      2,
    );
    assert.match(mergeWorkflow, new RegExp(junitRevision));
  });

  it("isolates privileged publication in a trusted workflow_run", () => {
    assert.doesNotMatch(testWorkflow, /id-token: write|checks: write/);
    assert.doesNotMatch(smokeWorkflow, /id-token: write|checks: write/);
    assert.match(publisherWorkflow, /workflow_run:/);
    assert.doesNotMatch(publisherWorkflow, /workflow_dispatch:/);
    assert.match(publisherWorkflow, /scripts\/validate-workflow-run\.mjs/);
    assert.match(
      publisherWorkflow,
      /WORKFLOW_SHA: \$\{\{ github\.workflow_sha \}\}/,
    );
    assert.match(publisherWorkflow, /-f ref="\$trusted_commit"/);
    assert.doesNotMatch(
      publisherWorkflow,
      /repos\/\$REPOSITORY\/commits\/\$default_branch/,
    );
    assert.match(publisherWorkflow, /for page in \{1\.\.8\}/);
    assert.match(publisherWorkflow, /all\(\.digest \| test\("\^sha256:/);
    assert.match(publisherWorkflow, /actions\/artifacts\/\$artifact_id\/zip/);
    assert.match(
      publisherWorkflow,
      /\[\[ "\$actual_digest" == "\$expected_digest" \]\]/,
    );
    assert.match(
      publisherWorkflow,
      /--download "\$archive" "\$download_limit"/,
    );
    assert.match(
      publisherWorkflow,
      /downloaded_bytes=\$\(\(downloaded_bytes \+ artifact_bytes\)\)/,
    );
    assert.match(
      publisherWorkflow,
      /RUN_ATTEMPT: \$\{\{ steps\.run\.outputs\.run-attempt \}\}/,
    );
    assert.match(
      publisherWorkflow,
      /remaining_bytes=\$\(\(104857600 - extracted_bytes\)\)/,
    );
    assert.match(publisherWorkflow, /scripts\/extract-ci-artifact\.py/);
    assert.doesNotMatch(publisherWorkflow, /actions\/checkout@/);
  });

  it("binds published reports to the exact validated workflow attempt", () => {
    assert.match(
      testWorkflow,
      /name: coverage-\$\{\{ matrix\.slug \}\}-attempt-\$\{\{ github\.run_attempt \}\}/,
    );
    assert.match(
      testWorkflow,
      /name: junit-\$\{\{ matrix\.slug \}\}-attempt-\$\{\{ github\.run_attempt \}\}/,
    );
    assert.match(
      smokeWorkflow,
      /name: smoke-junit-node-\$\{\{ matrix\.node \}\}-attempt-\$\{\{ github\.run_attempt \}\}/,
    );
    assert.ok(
      publisherWorkflow.includes('attempt_suffix="-attempt-$RUN_ATTEMPT"'),
    );
    assert.ok(
      publisherWorkflow.includes(
        '[[ "$current_report_set" == "$expected_report_set" ]]',
      ),
    );
    assert.match(
      publisherWorkflow,
      /capture\("-attempt-\(\?<attempt>\[1-9\]\[0-9\]\*\)\$"\)/,
    );
    assert.match(publisherWorkflow, /select\(\.name \| endswith\(\$suffix\)\)/);
    assert.equal(
      [...publisherWorkflow.matchAll(/\(\.name \| endswith\(\$suffix\)\)/g)]
        .length,
      4,
    );
  });

  it("keeps coverage publication advisory after validating the local report", () => {
    assert.match(
      publisherWorkflow,
      /- id: codecov\n\s+continue-on-error: true\n\s+uses: codecov\/codecov-action@[0-9a-f]{40}/,
    );
    assert.match(testWorkflow, /test -s "\$COVERAGE_FILE"/);
    assert.match(testWorkflow, /node scripts\/normalize-lcov\.mjs/);
    assert.match(
      publisherWorkflow,
      /- name: Summarize coverage upload\n\s+if: always\(\)/,
    );
    assert.doesNotMatch(publisherWorkflow, /override_build_url:/);
    assert.match(
      publisherWorkflow,
      /binary: \$\{\{ runner\.temp \}\}\/codecov/,
    );
    assert.match(
      publisherWorkflow,
      /ca1d64196d2d34771084afe76ea657d581bf628e31d993ff8e52ea09cc88a56d/,
    );
    assert.ok(
      publisherWorkflow.indexOf("Download verified Codecov CLI") <
        publisherWorkflow.indexOf("uses: codecov/codecov-action@"),
      "the verified uploader must exist before the action mints OIDC",
    );
    assert.doesNotMatch(publisherWorkflow, /\n\s+version: v11\.3\.1/);
  });

  it("publishes JUnit artifacts even when project tests fail", () => {
    assert.match(
      testWorkflow,
      /- name: Upload JUnit artifact\n\s+if: always\(\) && matrix\.junit != ''/,
    );
    assert.match(publisherWorkflow, /name: Publish JUnit results/);
  });

  it("always cleans up the Wrangler process group", () => {
    const smokeTriggers = smokeWorkflow.split("\njobs:", 1)[0];
    assert.match(smokeTriggers, /\n {2}pull_request:\s*$/m);
    assert.doesNotMatch(smokeTriggers, /paths(?:-ignore)?:/);
    assert.match(smokeWorkflow, /setsid bash -c/);
    assert.match(smokeWorkflow, /WRANGLER_PGID_FILE/);
    assert.match(smokeWorkflow, /source scripts\/wrangler-cleanup\.sh/);
    assert.match(smokeWorkflow, /trap cleanup_wrangler EXIT/);
    assert.match(smokeWorkflow, /trap 'force_wrangler_cleanup 129' HUP/);
    assert.match(smokeWorkflow, /trap 'force_wrangler_cleanup 130' INT/);
    assert.match(smokeWorkflow, /trap 'force_wrangler_cleanup 143' TERM/);
    assert.match(smokeWorkflow, /wrangler_launch_in_progress=true/);
    assert.match(smokeWorkflow, /wrangler_launch_in_progress=false/);
    assert.match(
      smokeWorkflow,
      /if \[\[ -n "\$\{wrangler_signal_status:-\}" \]\]; then\s+force_wrangler_cleanup "\$wrangler_signal_status"/,
    );
    assert.ok(
      smokeWorkflow.indexOf("trap cleanup_wrangler EXIT") <
        smokeWorkflow.indexOf("setsid bash -c"),
      "cleanup traps must be installed before Wrangler starts",
    );
    assert.match(
      smokeWorkflow,
      /curl .*--connect-timeout 2 --max-time "\$request_timeout"/,
    );
    assert.match(smokeWorkflow, /rm -f -- tests\.junit\.xml/);
    assert.match(smokeWorkflow, /test -s tests\.junit\.xml/);
    assert.match(smokeWorkflow, /ET\.parse\(sys\.argv\[1\]\)/);
  });

  it("requires one non-empty smoke-test report per supported runtime", () => {
    assert.match(smokeWorkflow, /node: \[20, 22, 24\]/);
    assert.match(
      smokeWorkflow,
      /name: smoke-junit-node-\$\{\{ matrix\.node \}\}-attempt-\$\{\{ github\.run_attempt \}\}/,
    );
    assert.match(smokeWorkflow, /if-no-files-found: error/);
    for (const node of [20, 22, 24]) {
      assert.match(publisherWorkflow, new RegExp(`smoke-junit-node-${node}`));
    }
  });

  it("keeps the stable smoke-test status fail-closed", () => {
    const statusJob = smokeWorkflow.slice(
      smokeWorkflow.indexOf("  smoke-tests-status:"),
    );
    assert.match(statusJob, /name: Run Smoke Tests Against Local Server/);
    assert.match(statusJob, /if: always\(\)/);
    assert.match(statusJob, /if \[\[ "\$SMOKE_RESULT" != "success" \]\]/);
    assert.doesNotMatch(statusJob, /REPORT_RESULT|REPORT_EXPECTED/);
  });

  it("requires exact aggregate results for conditional jobs", () => {
    const statusJob = testWorkflow.slice(testWorkflow.indexOf("  test:"));
    assert.match(statusJob, /expected_project_result=success/);
    assert.match(
      statusJob,
      /\[\[ "\$PROJECT_RESULT" == "\$expected_project_result" \]\]/,
    );
    assert.match(statusJob, /expected_runtime_result=success/);
    assert.match(
      statusJob,
      /\[\[ "\$NPM_BUILD_RESULT" == "\$expected_runtime_result" \]\]/,
    );
    assert.match(
      statusJob,
      /\[\[ "\$NPM_RUNTIME_RESULT" == "\$expected_runtime_result" \]\]/,
    );
  });

  it("checks packaged authentication startup on every runtime", () => {
    assert.match(testWorkflow, /"\$binary" auth status/);
    assert.match(testWorkflow, /\[\[ "\$auth_status" == "10" \]\]/);
    assert.match(testWorkflow, /grep -Fqi "not authenticated"/);
  });

  it("loads both packaged library entry points on every runtime", () => {
    assert.match(
      testWorkflow,
      /RUNTIME_PACKAGE: \$\{\{ matrix\.project\.name \}\}/,
    );
    assert.match(testWorkflow, /await import\(packageName\)/);
    assert.match(testWorkflow, /require\(packageName\)/);
    assert.doesNotMatch(testWorkflow, /(?:import|require)\("sentry"\)/);
    assert.match(testWorkflow, /typeof sdk\.default !== "function"/);
    assert.match(testWorkflow, /typeof sdk\.createSentrySDK !== "function"/);
  });

  it("bounds and verifies the canonical NPM package artifact", () => {
    assert.match(testWorkflow, /MAX_NPM_ARCHIVE_BYTES: [0-9]+/);
    assert.match(testWorkflow, /MAX_NPM_ARTIFACT_BYTES: [0-9]+/);
    assert.match(testWorkflow, /MAX_NPM_ENTRIES: [0-9]+/);
    assert.match(testWorkflow, /MAX_NPM_UNPACKED_BYTES: [0-9]+/);
    assert.match(testWorkflow, /npm-package\/package\.tgz/);
    assert.match(testWorkflow, /compression-level: 0/);
    assert.match(testWorkflow, /actions\/artifacts\/\$artifact_id\/zip/);
    assert.match(testWorkflow, /\[\[ "\$download_result" == "\$artifact_size"/);
    assert.match(testWorkflow, /scripts\/validate-npm-package\.py/);
    assert.doesNotMatch(testWorkflow, /actions\/download-artifact@/);
  });

  it("has no direct deployment dispatch or unprotected parallel deployment", () => {
    assert.doesNotMatch(testWorkflow, /workflow_dispatch:/);
    assert.match(deployWorkflow, /workflow_run:/);
    assert.match(deployWorkflow, /branches: \[main\]/);
    assert.doesNotMatch(deployWorkflow, /workflow_dispatch:/);
    assert.match(deployWorkflow, /group: deploy-cloudflare-production/);
    assert.match(deployWorkflow, /cancel-in-progress: false/);
    assert.match(deployWorkflow, /environment: production/);
    assert.match(deployWorkflow, /contents: write/);
    assert.match(
      deployWorkflow,
      /RUN_ATTEMPT: \$\{\{ github\.run_attempt \}\}/,
    );
    assert.doesNotMatch(
      deployWorkflow,
      /RUN_ATTEMPT: \$\{\{ steps\.validate\.outputs\.run-attempt \}\}/,
    );
  });

  it("revalidates the exact current Test revision before every mutation", () => {
    assert.match(deployWorkflow, /actions: read/);
    assert.match(deployWorkflow, /actions\/workflows\/test\.yml/);
    assert.match(deployWorkflow, /scripts\/validate-deployment\.mjs/);
    assert.match(
      deployWorkflow,
      /ref: \$\{\{ steps\.validate\.outputs\.head-sha \}\}/,
    );
    assert.match(deployWorkflow, /before version upload/);
    assert.match(deployWorkflow, /before candidate activation/);
    assert.match(deployWorkflow, /before promotion/);
    assert.equal(
      [
        ...deployWorkflow.matchAll(
          /node "\$RUNNER_TEMP\/validate-deployment\.mjs"/g,
        ),
      ].length,
      4,
    );
    assert.match(deployWorkflow, /pnpm install --frozen-lockfile/);
    assert.match(deployWorkflow, /persist-credentials: false/);
  });

  it("uses a durable exact-version journal for cancellation-safe recovery", () => {
    assert.match(
      deployWorkflow,
      /versions upload --experimental-auto-create=false --message/,
    );
    assert.match(deployWorkflow, /schemaVersion: 1/);
    assert.match(deployWorkflow, /workerName/);
    assert.match(deployWorkflow, /originalDeploymentId/);
    assert.match(deployWorkflow, /previousVersionId/);
    assert.match(deployWorkflow, /candidateVersionId/);
    assert.match(deployWorkflow, /cloudflare-deployment-live\.sh transition/);
    assert.match(deployWorkflow, /cloudflare-reconcile\.sh restore/);
    assert.match(deployWorkflow, /CLOUDFLARE_VERSION_OVERRIDE/);
    assert.match(deployWorkflow, /EXPECTED_VERSION_ID/);
    assert.match(smokeTestSource, /Cloudflare-Workers-Version-Overrides/);
    assert.match(smokeTestSource, /process\.env\.EXPECTED_VERSION_ID/);
    assert.match(recoveryWorkflow, /workflows: \[Deploy to Cloudflare\]/);
    assert.match(recoveryWorkflow, /scripts\/validate-recovery-run\.mjs/);
    assert.match(recoveryWorkflow, /cloudflare-reconcile\.sh/);
    assert.match(recoveryWorkflow, /contents: write/);
    assert.match(recoveryWorkflow, /group: deploy-cloudflare-production/);
    assert.match(
      deployWorkflow,
      /cloudflare-journal-store\.mjs append[\s\S]*?before candidate activation/,
    );
    assert.match(
      recoveryWorkflow,
      /cloudflare-journal-store\.mjs state[\s\S]*?journal-run\.outputs\.conclusion/,
    );
    assert.equal(
      [
        ...recoveryWorkflow.matchAll(
          /node scripts\/cloudflare-journal-store\.mjs state/g,
        ),
      ].length,
      1,
    );
    assert.doesNotMatch(recoveryWorkflow, /actions\/artifacts/);
    assert.doesNotMatch(recoveryWorkflow, /extract-ci-artifact/);
    assert.doesNotMatch(deployWorkflow, /journal-artifact/);
    assert.doesNotMatch(
      recoveryWorkflow,
      /github\.event\.workflow_run\.conclusion != 'success'/,
    );
    assert.doesNotMatch(deployWorkflow, /wrangler rollback/);
    assert.doesNotMatch(recoveryWorkflow, /wrangler rollback/);
  });

  it("claims every Cloudflare reconciliation before mutation", () => {
    const claimIndex = cloudflareReconciler.indexOf('node "$store" claim');
    const verifyIndex = cloudflareReconciler.indexOf('bash "$live" verify');
    const restoreIndex = cloudflareReconciler.indexOf('bash "$live" restore');
    const completeIndex = cloudflareReconciler.indexOf(
      'node "$store" complete',
    );
    assert.ok(claimIndex > 0);
    assert.ok(verifyIndex > claimIndex);
    assert.ok(restoreIndex > claimIndex);
    assert.ok(completeIndex > verifyIndex);
    assert.ok(completeIndex > restoreIndex);
    assert.match(
      cloudflareReconciler,
      /actions\/runs\/\$prior_run_id\/attempts\/\$prior_run_attempt/,
    );
    assert.match(cloudflareReconciler, /cmp -s -- "\$journal_path"/);
    assert.match(
      cloudflareReconciler,
      /--arg claimantHeadSha "\$claimant_head_sha"/,
    );
    assert.doesNotMatch(cloudflareReconciler, /GITHUB_SHA/);
    assert.match(deployWorkflow, /cloudflare-reconcile\.sh[\s\S]*?github\.sha/);
    assert.match(
      recoveryWorkflow,
      /cloudflare-reconcile\.sh[\s\S]*?github\.sha/,
    );
    assert.doesNotMatch(
      deployWorkflow,
      /cloudflare-deployment-live\.sh (?:verify|restore)/,
    );
    assert.doesNotMatch(
      recoveryWorkflow,
      /cloudflare-deployment-live\.sh (?:verify|restore)/,
    );
  });

  it("reconciles durable state before uploading one frozen build tree", () => {
    const reconcileIndex = deployWorkflow.indexOf(
      "Reconcile the newest durable deployment journal",
    );
    const buildIndex = deployWorkflow.indexOf("Build production artifact once");
    const uploadIndex = deployWorkflow.indexOf(
      "Upload production-scoped candidate and create journal",
    );
    const persistIndex = deployWorkflow.indexOf(
      "Persist deployment recovery journal",
    );
    const activationIndex = deployWorkflow.indexOf(
      "Revalidate Test revision before candidate activation",
    );
    assert.ok(reconcileIndex > 0);
    assert.ok(buildIndex > reconcileIndex);
    assert.ok(uploadIndex > buildIndex);
    assert.ok(persistIndex > uploadIndex);
    assert.ok(activationIndex > persistIndex);
    assert.match(deployWorkflow, /cloudflare-journal-store\.mjs state/);
    assert.match(deployWorkflow, /cloudflare-journal-store\.mjs append/);
    assert.match(
      deployWorkflow,
      /branch_head_sha="\$\{branch_head_sha:-\$\(jq -er '\.branchHeadSha' "\$state"\)\}"/,
    );
    assert.match(deployWorkflow, /steps\.reconcile\.outputs\.branch-head-sha/);
    assert.doesNotMatch(deployWorkflow, /select-cloudflare-journal\.mjs/);
    const priorRunGate = deployWorkflow.slice(
      deployWorkflow.indexOf("Reconcile the newest durable deployment journal"),
      deployWorkflow.indexOf("Build production artifact once"),
    );
    assert.doesNotMatch(priorRunGate, /cloudflare-deployment-live\.sh/);
    assert.match(priorRunGate, /cloudflare-reconcile\.sh/);
    assert.match(priorRunGate, /reconciliation_action="verify-promoted"/);
    assert.match(priorRunGate, /reconciliation_action="restore"/);
    assert.match(
      deployWorkflow,
      /cp -a -- "\$CLOUDFLARE_PROJECT_PATH\/dist\/\."/,
    );
    assert.match(deployWorkflow, /--config "\$CLOUDFLARE_UPLOAD_CONFIG"/);
    assert.match(
      deployWorkflow,
      /frozen_artifact="\/opt\/sentry-mcp-cloudflare-upload-/,
    );
    assert.match(deployWorkflow, /sudo chown -R root:root/);
    assert.match(deployWorkflow, /\(has\("base_dir"\) \| not\)/);
    for (const unsafeUploadOption of [
      "build",
      "tsconfig",
      "alias",
      "site",
      "wasm_modules",
      "text_blobs",
      "data_blobs",
    ]) {
      assert.match(
        deployWorkflow,
        new RegExp(`has\\("${unsafeUploadOption}"\\) \\| not`),
      );
    }
    assert.match(
      deployWorkflow,
      /run-wrangler-command\.sh[\s\S]*?versions upload/,
    );
    assert.match(
      deployWorkflow,
      /hash-directory\.mjs "\$FROZEN_ARTIFACT_PATH"/,
    );
    assert.match(deployWorkflow, /upload-config-digest=\$upload_config_digest/);
    assert.match(deployWorkflow, /uploadConfigDigest: \$uploadConfigDigest/);
    assert.doesNotMatch(
      deployWorkflow,
      /hash-directory\.mjs "\$CLOUDFLARE_PROJECT_PATH\/dist"/,
    );
    assert.match(
      deployWorkflow,
      /cloudflare-deployment-live\.sh snapshot \\\n+\s+"\$CLOUDFLARE_PROJECT_PATH" "\$CLOUDFLARE_UPLOAD_CONFIG"/,
    );
    assert.match(
      liveDeploymentAdapter,
      /deployments status --json --config "\$config_path"/,
    );
    assert.match(
      liveDeploymentAdapter,
      /deployments list --json --config "\$config_path"/,
    );
    assert.match(liveDeploymentAdapter, /observability: null/);
    assert.match(liveDeploymentAdapter, /tail_consumers: null/);
    assert.match(liveDeploymentAdapter, /streaming_tail_consumers: null/);
    assert.match(liveDeploymentAdapter, /run-wrangler-command\.sh/);
  });

  it("resolves specialized package names and paths from workspace metadata", () => {
    for (const workflow of [smokeWorkflow, deployWorkflow]) {
      assert.match(workflow, /--roles cloudflare,smoke/);
      assert.doesNotMatch(workflow, /packages\/mcp-cloudflare/);
      assert.doesNotMatch(workflow, /packages\/smoke-tests/);
      assert.doesNotMatch(workflow, /@sentry\/mcp-cloudflare/);
      assert.doesNotMatch(workflow, /@sentry\/mcp-smoke-tests/);
    }
    assert.doesNotMatch(smokeWorkflow, /packages\/\*\*/);
  });
});

describe("CI publisher helpers", () => {
  const root = resolve(import.meta.dirname, "..");
  const repository = {
    default_branch: "main",
    full_name: "example/repository",
    url: "https://api.github.com/repos/example/repository",
  };
  const sha = "a".repeat(40);

  function workflowRun(event, overrides = {}) {
    return {
      actor: { login: "octocat" },
      event,
      head_branch: "main",
      head_repository: { full_name: repository.full_name },
      head_sha: sha,
      id: 42,
      name: "Test",
      pull_requests: [],
      run_attempt: 1,
      status: "completed",
      workflow_id: 7,
      ...overrides,
    };
  }

  it("validates push, pull-request, and merge-queue provenance", () => {
    const common = {
      eventRun: workflowRun("push"),
      expectedRunId: 42,
      repository,
      workflowId: 7,
    };
    assert.deepEqual(
      validateWorkflowRun({ ...common, run: workflowRun("push") }),
      {
        headSha: sha,
        prNumber: "",
        runAttempt: 1,
        source: "Test",
      },
    );
    assert.throws(
      () =>
        validateWorkflowRun({
          ...common,
          eventRun: workflowRun("push", { head_branch: "feature" }),
          run: workflowRun("push", { head_branch: "feature" }),
        }),
      /default branch/,
    );

    const associatedPullRequest = {
      base: { ref: "main" },
      head: { repo: { url: repository.url }, sha },
      number: 123,
    };
    const pullRequest = {
      base: { repo: { full_name: repository.full_name } },
      head: { repo: { full_name: repository.full_name }, sha },
      number: 123,
    };
    assert.equal(
      validateWorkflowRun({
        ...common,
        eventRun: workflowRun("pull_request", {
          head_branch: "feature",
          pull_requests: [associatedPullRequest],
        }),
        pullRequest,
        run: workflowRun("pull_request", {
          head_branch: "feature",
          pull_requests: [associatedPullRequest],
        }),
      }).prNumber,
      123,
    );
    assert.throws(
      () =>
        validateWorkflowRun({
          ...common,
          eventRun: workflowRun("pull_request", {
            head_branch: "feature",
            pull_requests: [associatedPullRequest],
          }),
          pullRequest: {
            ...pullRequest,
            head: { ...pullRequest.head, sha: "b".repeat(40) },
          },
          run: workflowRun("pull_request", {
            head_branch: "feature",
            pull_requests: [associatedPullRequest],
          }),
        }),
      /head SHA mismatch/,
    );

    assert.equal(
      validateWorkflowRun({
        ...common,
        eventRun: workflowRun("merge_group", {
          head_branch: `gh-readonly-queue/main/pr-123-${"c".repeat(40)}`,
        }),
        run: workflowRun("merge_group", {
          head_branch: `gh-readonly-queue/main/pr-123-${"c".repeat(40)}`,
        }),
      }).headSha,
      sha,
    );
    assert.throws(
      () =>
        validateWorkflowRun({
          ...common,
          eventRun: workflowRun("merge_group", { head_branch: "main" }),
          run: workflowRun("merge_group", { head_branch: "main" }),
        }),
      /queue branch/,
    );

    assert.throws(
      () =>
        validateWorkflowRun({
          ...common,
          run: workflowRun("push", { run_attempt: 2 }),
        }),
      /attempt mismatch/,
    );
  });

  it("rejects stale, mismatched, and non-Test deployment runs", () => {
    const eventRun = workflowRun("push", {
      conclusion: "success",
      run_attempt: 1,
    });
    const apiRun = structuredClone(eventRun);
    const input = {
      apiRun,
      currentHeadSha: sha,
      eventRun,
      expectedWorkflowId: 7,
      repository,
    };

    assert.deepEqual(validateDeployment(input), { headSha: sha });
    assert.throws(
      () => validateDeployment({ ...input, currentHeadSha: "b".repeat(40) }),
      /stale relative to the default branch/,
    );
    assert.throws(
      () =>
        validateDeployment({
          ...input,
          apiRun: { ...apiRun, workflow_id: 8 },
        }),
      /expected Test workflow/,
    );
    assert.throws(
      () =>
        validateDeployment({
          ...input,
          apiRun: { ...apiRun, run_attempt: 2 },
        }),
      /run_attempt mismatch/,
    );
  });

  it("bounds compressed package size, entries, and unpacked bytes", () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "npm-package-"));
    const validator = resolve(root, "scripts/validate-npm-package.py");
    const packagePath = join(temporaryDirectory, "package.tgz");
    const metadataBombPath = join(temporaryDirectory, "metadata-bomb.tgz");
    try {
      const createPackage = spawnSync(
        "python3",
        [
          "-c",
          "import io, sys, tarfile; archive=tarfile.open(sys.argv[1], 'w:gz'); data=b'x'*2048; first=tarfile.TarInfo('package/index.js'); first.size=len(data); archive.addfile(first, io.BytesIO(data)); second=tarfile.TarInfo('package/other.js'); second.size=1; archive.addfile(second, io.BytesIO(b'y')); archive.close()",
          packagePath,
        ],
        { encoding: "utf8" },
      );
      assert.equal(createPackage.status, 0, createPackage.stderr);

      const valid = spawnSync(
        "python3",
        [validator, packagePath, "1048576", "10", "4096"],
        { encoding: "utf8" },
      );
      assert.equal(valid.status, 0, valid.stderr);
      assert.match(valid.stdout, /^[0-9]+\t2\t2049\n$/);

      const oversized = spawnSync(
        "python3",
        [validator, packagePath, "1048576", "10", "1024"],
        { encoding: "utf8" },
      );
      assert.notEqual(oversized.status, 0);
      assert.match(oversized.stderr, /unpacked size limit/);

      const tooManyEntries = spawnSync(
        "python3",
        [validator, packagePath, "1048576", "1", "4096"],
        { encoding: "utf8" },
      );
      assert.notEqual(tooManyEntries.status, 0);
      assert.match(tooManyEntries.stderr, /entry limit/);

      const createMetadataBomb = spawnSync(
        "python3",
        [
          "-c",
          "import io, sys, tarfile; archive=tarfile.open(sys.argv[1], 'w:gz', format=tarfile.PAX_FORMAT); info=tarfile.TarInfo('package/index.js'); info.size=1; info.pax_headers={'comment': 'x'*100000}; archive.addfile(info, io.BytesIO(b'x')); archive.close()",
          metadataBombPath,
        ],
        { encoding: "utf8" },
      );
      assert.equal(createMetadataBomb.status, 0, createMetadataBomb.stderr);
      const metadataBomb = spawnSync(
        "python3",
        [validator, metadataBombPath, "1048576", "10", "4096"],
        { encoding: "utf8" },
      );
      assert.notEqual(metadataBomb.status, 0);
      assert.match(metadataBomb.stderr, /decompression limit/);
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  it("extracts one canonical report and rejects non-canonical archives", () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "ci-artifact-"));
    const extractor = resolve(root, "scripts/extract-ci-artifact.py");
    try {
      const validArchive = join(temporaryDirectory, "valid.zip");
      const validOutput = join(temporaryDirectory, "valid", "lcov.info");
      const createValid = spawnSync(
        "python3",
        [
          "-c",
          "import sys, zipfile; z=zipfile.ZipFile(sys.argv[1], 'w'); z.writestr('lcov.info', 'SF:src/index.ts\\n'); z.close()",
          validArchive,
        ],
        { encoding: "utf8" },
      );
      assert.equal(createValid.status, 0, createValid.stderr);
      const valid = spawnSync(
        "python3",
        [extractor, validArchive, validOutput, "lcov.info", "1048576"],
        { encoding: "utf8" },
      );
      assert.equal(valid.status, 0, valid.stderr);
      assert.equal(readFileSync(validOutput, "utf8"), "SF:src/index.ts\n");

      const downloadedArchive = join(temporaryDirectory, "downloaded.zip");
      const downloaded = spawnSync(
        "python3",
        [extractor, "--download", downloadedArchive, "4"],
        { encoding: "utf8", input: "data" },
      );
      assert.equal(downloaded.status, 0, downloaded.stderr);
      assert.match(downloaded.stdout, /^4\tsha256:[0-9a-f]{64}\n$/);
      assert.equal(readFileSync(downloadedArchive, "utf8"), "data");

      const oversizedArchive = join(temporaryDirectory, "oversized.zip");
      const oversized = spawnSync(
        "python3",
        [extractor, "--download", oversizedArchive, "4"],
        { encoding: "utf8", input: "extra" },
      );
      assert.notEqual(oversized.status, 0);
      assert.throws(() => readFileSync(oversizedArchive));

      const existingArchive = join(temporaryDirectory, "existing.zip");
      writeFileSync(existingArchive, "keep");
      const existing = spawnSync(
        "python3",
        [extractor, "--download", existingArchive, "4"],
        { encoding: "utf8", input: "data" },
      );
      assert.notEqual(existing.status, 0);
      assert.equal(readFileSync(existingArchive, "utf8"), "keep");

      const maliciousArchive = join(temporaryDirectory, "malicious.zip");
      const maliciousOutput = join(
        temporaryDirectory,
        "malicious",
        "lcov.info",
      );
      const createMalicious = spawnSync(
        "python3",
        [
          "-c",
          "import sys, zipfile; z=zipfile.ZipFile(sys.argv[1], 'w'); z.writestr('prefix,/proc/self/environ,suffix/lcov.info', 'secret'); z.close()",
          maliciousArchive,
        ],
        { encoding: "utf8" },
      );
      assert.equal(createMalicious.status, 0, createMalicious.stderr);
      const malicious = spawnSync(
        "python3",
        [extractor, maliciousArchive, maliciousOutput, "lcov.info", "1048576"],
        { encoding: "utf8" },
      );
      assert.notEqual(malicious.status, 0);
      assert.throws(() => readFileSync(maliciousOutput));

      const duplicateArchive = join(temporaryDirectory, "duplicate.zip");
      const duplicateOutput = join(
        temporaryDirectory,
        "duplicate",
        "lcov.info",
      );
      const createDuplicate = spawnSync(
        "python3",
        [
          "-c",
          "import sys, zipfile; z=zipfile.ZipFile(sys.argv[1], 'w'); z.writestr('lcov.info', 'first'); z.writestr('lcov.info', 'second'); z.close()",
          duplicateArchive,
        ],
        { encoding: "utf8" },
      );
      assert.equal(createDuplicate.status, 0, createDuplicate.stderr);
      const duplicate = spawnSync(
        "python3",
        [extractor, duplicateArchive, duplicateOutput, "lcov.info", "1048576"],
        { encoding: "utf8" },
      );
      assert.notEqual(duplicate.status, 0);
      assert.throws(() => readFileSync(duplicateOutput));

      const corruptArchive = join(temporaryDirectory, "corrupt.zip");
      const corruptOutput = join(temporaryDirectory, "corrupt", "lcov.info");
      const createCorrupt = spawnSync(
        "python3",
        [
          "-c",
          "import sys, zipfile; p=sys.argv[1]; z=zipfile.ZipFile(p, 'w'); z.writestr('lcov.info', 'coverage'); z.close(); data=bytearray(open(p, 'rb').read()); offset=data.index(b'coverage'); data[offset] ^= 1; open(p, 'wb').write(data)",
          corruptArchive,
        ],
        { encoding: "utf8" },
      );
      assert.equal(createCorrupt.status, 0, createCorrupt.stderr);
      const corrupt = spawnSync(
        "python3",
        [extractor, corruptArchive, corruptOutput, "lcov.info", "1048576"],
        { encoding: "utf8" },
      );
      assert.notEqual(corrupt.status, 0);
      assert.throws(() => readFileSync(corruptOutput));

      const entryBombArchive = join(temporaryDirectory, "entry-bomb.zip");
      const entryBombOutput = join(
        temporaryDirectory,
        "entry-bomb",
        "lcov.info",
      );
      const createEntryBomb = spawnSync(
        "python3",
        [
          "-c",
          "import sys, zipfile; z=zipfile.ZipFile(sys.argv[1], 'w'); [z.writestr(f'{index}.txt', '') for index in range(2000)]; z.close()",
          entryBombArchive,
        ],
        { encoding: "utf8" },
      );
      assert.equal(createEntryBomb.status, 0, createEntryBomb.stderr);
      const entryBomb = spawnSync(
        "python3",
        [extractor, entryBombArchive, entryBombOutput, "lcov.info", "1048576"],
        { encoding: "utf8" },
      );
      assert.notEqual(entryBomb.status, 0);
      assert.match(entryBomb.stderr, /invalid directory metadata/);
      assert.throws(() => readFileSync(entryBombOutput));
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  it("normalizes LCOV source paths to the repository root", () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "normalize-lcov-"));
    const projectPath = "packages/example";
    const reportPath = "packages/example/coverage/lcov.info";
    try {
      mkdirSync(resolve(temporaryDirectory, "packages/example/coverage"), {
        recursive: true,
      });
      writeFileSync(
        resolve(temporaryDirectory, reportPath),
        "TN:\nSF:src/index.ts\nSF:../../node_modules/dependency/index.js\nend_of_record\n",
      );
      normalizeLcovPaths(temporaryDirectory, projectPath, reportPath);
      assert.equal(
        readFileSync(resolve(temporaryDirectory, reportPath), "utf8"),
        "TN:\nSF:packages/example/src/index.ts\nSF:node_modules/dependency/index.js\nend_of_record\n",
      );
      writeFileSync(
        resolve(temporaryDirectory, reportPath),
        "SF:../../../outside.ts\n",
      );
      assert.throws(
        () => normalizeLcovPaths(temporaryDirectory, projectPath, reportPath),
        /within the repository/,
      );
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  it("uses valid Codecov informational status keys", () => {
    const requireFromMcpCore = createRequire(
      resolve(root, "packages/mcp-core/package.json"),
    );
    const { parse } = requireFromMcpCore("yaml");
    const config = parse(readFileSync(resolve(root, "codecov.yml"), "utf8"));
    assert.equal(config.config, undefined);
    assert.equal(config.coverage.status.project.default.informational, true);
    assert.equal(config.coverage.status.patch.default.informational, true);
  });
});

describe("Wrangler process-group cleanup", () => {
  it("kills delayed descendants after a Wrangler launcher exits", async () => {
    const root = resolve(import.meta.dirname, "..");
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "wrangler-command-"));
    const markerFile = join(temporaryDirectory, "late-mutation");
    const descendantFile = join(temporaryDirectory, "descendant");
    const wrapper = resolve(root, "scripts/run-wrangler-command.sh");
    try {
      const result = spawnSync(
        "bash",
        [
          wrapper,
          "bash",
          "-c",
          '(sleep 0.3; touch "$MARKER_FILE") & printf "%s" "$!" > "$DESCENDANT_FILE"',
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            DESCENDANT_FILE: descendantFile,
            MARKER_FILE: markerFile,
          },
          timeout: 5_000,
        },
      );
      assert.equal(result.status, 0, result.stderr);
      const descendant = Number(readFileSync(descendantFile, "utf8"));
      assert.ok(Number.isSafeInteger(descendant));
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
      assert.equal(existsSync(markerFile), false);
      assert.throws(() => process.kill(descendant, 0), { code: "ESRCH" });
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  it("kills delayed descendants when the Wrangler wrapper is cancelled", async () => {
    const root = resolve(import.meta.dirname, "..");
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "wrangler-cancel-"));
    const markerFile = join(temporaryDirectory, "late-mutation");
    const readyFile = join(temporaryDirectory, "ready");
    const descendantFile = join(temporaryDirectory, "descendant");
    const wrapper = resolve(root, "scripts/run-wrangler-command.sh");
    const child = spawn(
      "bash",
      [
        wrapper,
        "bash",
        "-c",
        'trap "" HUP INT TERM; (trap "" HUP INT TERM; sleep 0.3; touch "$MARKER_FILE") & printf "%s" "$!" > "$DESCENDANT_FILE"; touch "$READY_FILE"; while :; do sleep 1; done',
      ],
      {
        env: {
          ...process.env,
          DESCENDANT_FILE: descendantFile,
          MARKER_FILE: markerFile,
          READY_FILE: readyFile,
        },
        stdio: "ignore",
      },
    );
    let descendant;
    try {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (existsSync(readyFile)) {
          descendant = Number(readFileSync(descendantFile, "utf8"));
          break;
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
      }
      assert.ok(Number.isSafeInteger(descendant));
      child.kill("SIGTERM");
      const exitCode = await new Promise((resolvePromise, rejectPromise) => {
        const timeout = setTimeout(
          () => rejectPromise(new Error("Wrangler wrapper cleanup timed out")),
          5_000,
        );
        child.once("exit", (code) => {
          clearTimeout(timeout);
          resolvePromise(code);
        });
      });
      assert.equal(exitCode, 143);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
      assert.equal(existsSync(markerFile), false);
      assert.throws(() => process.kill(descendant, 0), { code: "ESRCH" });
    } finally {
      child.kill("SIGKILL");
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  for (const expectedStatus of [0, 23]) {
    it(`preserves status ${expectedStatus} during normal EXIT cleanup`, () => {
      const root = resolve(import.meta.dirname, "..");
      const temporaryDirectory = mkdtempSync(join(tmpdir(), "wrangler-exit-"));
      const pidFile = join(temporaryDirectory, "pgid");
      const logFile = join(temporaryDirectory, "wrangler.log");
      const helper = resolve(root, "scripts/wrangler-cleanup.sh");
      const script = `
        wrangler_pid=""
        wrangler_pgid=""
        WRANGLER_LOG="$LOG_FILE"
        source "$HELPER"
        trap cleanup_wrangler EXIT
        trap 'force_wrangler_cleanup 129' HUP
        trap 'force_wrangler_cleanup 130' INT
        trap 'force_wrangler_cleanup 143' TERM
        setsid sleep 1000 > "$WRANGLER_LOG" 2>&1 &
        wrangler_pid=$!
        wrangler_pgid=$wrangler_pid
        printf '%s' "$wrangler_pgid" > "$PID_FILE"
        exit "$EXPECTED_STATUS"
      `;
      try {
        const result = spawnSync("bash", ["-c", script], {
          encoding: "utf8",
          env: {
            ...process.env,
            EXPECTED_STATUS: String(expectedStatus),
            HELPER: helper,
            LOG_FILE: logFile,
            PID_FILE: pidFile,
          },
          timeout: 5_000,
        });
        assert.equal(result.status, expectedStatus, result.stderr);
        const processGroup = Number(readFileSync(pidFile, "utf8"));
        assert.ok(Number.isSafeInteger(processGroup));
        assert.throws(() => process.kill(-processGroup, 0), { code: "ESRCH" });
      } finally {
        const processGroup = Number(readFileSync(pidFile, "utf8"));
        try {
          process.kill(-processGroup, "SIGKILL");
        } catch (_error) {
          // Best-effort fallback after the assertion above verifies normal cleanup.
        } finally {
          rmSync(temporaryDirectory, { force: true, recursive: true });
        }
      }
    });
  }

  it("kills an active TERM-ignoring group and preserves cancellation status", async () => {
    const root = resolve(import.meta.dirname, "..");
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "wrangler-cleanup-"));
    const pidFile = join(temporaryDirectory, "pgid");
    const logFile = join(temporaryDirectory, "wrangler.log");
    const helper = resolve(root, "scripts/wrangler-cleanup.sh");
    const script = `
      wrangler_pid=""
      wrangler_pgid=""
      WRANGLER_LOG="$LOG_FILE"
      source "$HELPER"
      trap cleanup_wrangler EXIT
      trap 'force_wrangler_cleanup 129' HUP
      trap 'force_wrangler_cleanup 130' INT
      trap 'force_wrangler_cleanup 143' TERM
      setsid bash -c 'trap "" HUP INT TERM; while :; do sleep 1; done' > "$WRANGLER_LOG" 2>&1 &
      wrangler_pid=$!
      wrangler_pgid=$wrangler_pid
      printf '%s' "$wrangler_pgid" > "$PID_FILE"
      while :; do sleep 1; done
    `;
    const child = spawn("bash", ["-c", script], {
      env: {
        ...process.env,
        HELPER: helper,
        LOG_FILE: logFile,
        PID_FILE: pidFile,
      },
      stdio: "ignore",
    });
    let processGroup;
    let cleanupError;
    try {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
          processGroup = Number(readFileSync(pidFile, "utf8"));
          break;
        } catch (_error) {
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
        }
      }
      assert.ok(Number.isSafeInteger(processGroup));
      child.kill("SIGTERM");
      child.kill("SIGTERM");
      const exitCode = await new Promise((resolvePromise, rejectPromise) => {
        const timeout = setTimeout(
          () =>
            rejectPromise(
              new Error("cleanup did not finish within five seconds"),
            ),
          5_000,
        );
        child.once("exit", (code) => {
          clearTimeout(timeout);
          resolvePromise(code);
        });
      });
      assert.equal(exitCode, 143);
      assert.throws(() => process.kill(-processGroup, 0), { code: "ESRCH" });
    } finally {
      if (Number.isSafeInteger(processGroup)) {
        try {
          process.kill(-processGroup, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH") {
            cleanupError = error;
          }
        }
      }
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
    if (cleanupError) {
      throw cleanupError;
    }
  });

  for (const [signal, expectedStatus] of [
    ["SIGHUP", 129],
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ]) {
    it(`replays ${signal} cleanup after the launch-to-PID assignment section`, async () => {
      const root = resolve(import.meta.dirname, "..");
      const temporaryDirectory = mkdtempSync(join(tmpdir(), "wrangler-start-"));
      const groupFile = join(temporaryDirectory, "group");
      const descendantFile = join(temporaryDirectory, "descendant");
      const releaseFile = join(temporaryDirectory, "release");
      const logFile = join(temporaryDirectory, "wrangler.log");
      const helper = resolve(root, "scripts/wrangler-cleanup.sh");
      const script = `
        wrangler_pid=""
        wrangler_pgid=""
        wrangler_starting=false
        wrangler_launch_in_progress=false
        WRANGLER_LOG="$LOG_FILE"
        export GROUP_FILE DESCENDANT_FILE
        source "$HELPER"
        trap cleanup_wrangler EXIT
        trap 'force_wrangler_cleanup 129' HUP
        trap 'force_wrangler_cleanup 130' INT
        trap 'force_wrangler_cleanup 143' TERM
        wrangler_starting=true
        wrangler_launch_in_progress=true
        setsid bash -c '
          trap "" HUP INT TERM
          printf "%s" "$$" > "$GROUP_FILE"
          (trap "" HUP INT TERM; while :; do sleep 1; done) &
          printf "%s" "$!" > "$DESCENDANT_FILE"
          while :; do sleep 1; done
        ' > "$WRANGLER_LOG" 2>&1 &
        while [[ ! -e "$RELEASE_FILE" ]]; do :; done
        wrangler_pid=$!
        wrangler_launch_in_progress=false
        if [[ -n "\${wrangler_signal_status:-}" ]]; then
          force_wrangler_cleanup "$wrangler_signal_status"
        fi
      `;
      const child = spawn("bash", ["-c", script], {
        env: {
          ...process.env,
          DESCENDANT_FILE: descendantFile,
          GROUP_FILE: groupFile,
          HELPER: helper,
          LOG_FILE: logFile,
          RELEASE_FILE: releaseFile,
        },
        stdio: "ignore",
      });
      let processGroup;
      let descendant;
      try {
        for (let attempt = 0; attempt < 200; attempt += 1) {
          try {
            processGroup = Number(readFileSync(groupFile, "utf8"));
            descendant = Number(readFileSync(descendantFile, "utf8"));
            break;
          } catch (_error) {
            await new Promise((resolvePromise) =>
              setTimeout(resolvePromise, 10),
            );
          }
        }
        assert.ok(Number.isSafeInteger(processGroup));
        assert.ok(Number.isSafeInteger(descendant));
        child.kill(signal);
        writeFileSync(releaseFile, "release");
        const exitCode = await new Promise((resolvePromise, rejectPromise) => {
          const timeout = setTimeout(
            () => rejectPromise(new Error("startup cleanup did not finish")),
            5_000,
          );
          child.once("exit", (code) => {
            clearTimeout(timeout);
            resolvePromise(code);
          });
        });
        assert.equal(exitCode, expectedStatus);
        assert.throws(() => process.kill(-processGroup, 0), { code: "ESRCH" });
        assert.throws(() => process.kill(descendant, 0), { code: "ESRCH" });
      } finally {
        if (Number.isSafeInteger(processGroup)) {
          try {
            process.kill(-processGroup, "SIGKILL");
          } catch (_error) {
            // Best-effort fallback after assertions verify cleanup.
          }
        }
        rmSync(temporaryDirectory, { force: true, recursive: true });
      }
    });
  }
});
