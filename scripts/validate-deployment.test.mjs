import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validateDeployment,
  validateDeploymentRecovery,
} from "./validate-deployment.mjs";

const headSha = "a".repeat(40);
const repository = { full_name: "getsentry/toolkit", default_branch: "main" };

function makeRun(overrides = {}) {
  return {
    id: 42,
    workflow_id: 7,
    run_attempt: 1,
    status: "completed",
    conclusion: "success",
    event: "push",
    head_branch: "main",
    head_sha: headSha,
    head_repository: { full_name: repository.full_name },
    ...overrides,
  };
}

function validate(overrides = {}) {
  const apiRun = makeRun(overrides);
  return validateDeployment({
    apiRun,
    eventRun: { ...apiRun },
    repository,
    expectedWorkflowId: 7,
    currentHeadSha: headSha,
  });
}

describe("validateDeployment", () => {
  it("accepts only a successful push for the current main revision", () => {
    assert.deepEqual(validate(), { headSha });
    for (const overrides of [
      { event: "pull_request" },
      { status: "in_progress" },
      { conclusion: "skipped" },
      { head_branch: "feature" },
      { head_sha: "b".repeat(40) },
      { head_repository: { full_name: "someone/toolkit" } },
    ]) {
      assert.throws(() => validate(overrides));
    }
  });

  it("rejects absent, invalid and mismatched run attempts", () => {
    for (const runAttempt of [undefined, null, 0, -1, 1.5, "1"]) {
      assert.throws(
        () => validate({ run_attempt: runAttempt }),
        String(runAttempt),
      );
    }
    const apiRun = makeRun();
    assert.throws(() =>
      validateDeployment({
        apiRun,
        eventRun: { ...apiRun, run_attempt: 2 },
        repository,
        expectedWorkflowId: 7,
        currentHeadSha: headSha,
      }),
    );
  });
});

describe("validateDeploymentRecovery", () => {
  it("accepts a completed failed deploy run, but rejects malformed attempts", () => {
    const apiRun = makeRun({ event: "workflow_run", conclusion: "failure" });
    assert.deepEqual(
      validateDeploymentRecovery({
        apiRun,
        eventRun: { ...apiRun },
        repository,
        expectedWorkflowId: 7,
      }),
      { conclusion: "failure", headSha, runAttempt: 1, runId: 42 },
    );
    assert.throws(() =>
      validateDeploymentRecovery({
        apiRun: { ...apiRun, run_attempt: 0 },
        eventRun: { ...apiRun, run_attempt: 0 },
        repository,
        expectedWorkflowId: 7,
      }),
    );
  });
});
