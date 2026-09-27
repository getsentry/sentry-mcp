import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateRecoveryRun } from "./validate-recovery-run.mjs";

const HEAD_SHA = "0123456789abcdef0123456789abcdef01234567";

function recoveryState(overrides = {}) {
  const run = {
    conclusion: "failure",
    event: "workflow_run",
    head_branch: "main",
    head_repository: { full_name: "getsentry/sentry-mcp" },
    head_sha: HEAD_SHA,
    id: 101,
    run_attempt: 2,
    status: "completed",
    workflow_id: 303,
    ...overrides,
  };
  return {
    apiRun: structuredClone(run),
    eventRun: structuredClone(run),
    repository: {
      default_branch: "main",
      full_name: "getsentry/sentry-mcp",
    },
  };
}

describe("validateRecoveryRun", () => {
  it("binds a completed deployment run to its repository and attempt", () => {
    const state = recoveryState();
    assert.deepEqual(
      validateRecoveryRun(state.eventRun, state.apiRun, state.repository, 303),
      {
        conclusion: "failure",
        headSha: HEAD_SHA,
        runAttempt: 2,
        runId: 101,
      },
    );
  });

  it("rejects rerun and workflow identity mismatches", () => {
    const rerun = recoveryState();
    rerun.apiRun.run_attempt = 3;
    assert.throws(
      () =>
        validateRecoveryRun(
          rerun.eventRun,
          rerun.apiRun,
          rerun.repository,
          303,
        ),
      /attempt mismatch/,
    );

    const workflow = recoveryState();
    assert.throws(
      () =>
        validateRecoveryRun(
          workflow.eventRun,
          workflow.apiRun,
          workflow.repository,
          404,
        ),
      /canonical deployment workflow/,
    );
  });

  it("rejects cross-repository and non-default-branch runs", () => {
    const repository = recoveryState();
    repository.apiRun.head_repository.full_name = "attacker/fork";
    repository.eventRun.head_repository.full_name = "attacker/fork";
    assert.throws(
      () =>
        validateRecoveryRun(
          repository.eventRun,
          repository.apiRun,
          repository.repository,
          303,
        ),
      /different repository/,
    );

    const branch = recoveryState({ head_branch: "feature" });
    assert.throws(
      () =>
        validateRecoveryRun(
          branch.eventRun,
          branch.apiRun,
          branch.repository,
          303,
        ),
      /default branch/,
    );
  });

  it("accepts a runner startup failure", () => {
    const state = recoveryState({ conclusion: "startup_failure" });
    assert.deepEqual(
      validateRecoveryRun(state.eventRun, state.apiRun, state.repository, 303),
      {
        conclusion: "startup_failure",
        headSha: HEAD_SHA,
        runAttempt: 2,
        runId: 101,
      },
    );
  });

  it("accepts a successful deployment run for ownership verification", () => {
    const state = recoveryState({ conclusion: "success" });
    assert.deepEqual(
      validateRecoveryRun(state.eventRun, state.apiRun, state.repository, 303),
      {
        conclusion: "success",
        headSha: HEAD_SHA,
        runAttempt: 2,
        runId: 101,
      },
    );
  });
});
