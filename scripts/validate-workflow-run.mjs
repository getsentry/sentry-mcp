import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SOURCES = {
  "Smoke Tests (Local)": "smoke",
  Test: "test",
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function validateWorkflowRun({
  eventRun,
  expectedRunId,
  run,
  repository,
  workflowId,
  pullRequest = null,
}) {
  const source = SOURCES[run.name];
  assert(source, "Unexpected triggering workflow");
  assert(
    isPositiveInteger(expectedRunId) &&
      eventRun.id === expectedRunId &&
      run.id === expectedRunId,
    "Workflow run ID mismatch",
  );
  assert(
    isPositiveInteger(eventRun.run_attempt) &&
      run.run_attempt === eventRun.run_attempt,
    "Workflow run attempt mismatch",
  );
  for (const field of [
    "conclusion",
    "event",
    "head_branch",
    "head_sha",
    "name",
    "status",
    "workflow_id",
  ]) {
    assert(eventRun[field] === run[field], `Workflow run ${field} mismatch`);
  }
  assert(
    eventRun.actor?.login === run.actor?.login &&
      eventRun.head_repository?.full_name === run.head_repository?.full_name,
    "Workflow run identity mismatch",
  );
  assert(run.workflow_id === workflowId, "Workflow ID mismatch");
  assert(run.status === "completed", "Workflow run is not complete");
  assert(
    run.head_repository?.full_name === repository.full_name,
    "Workflow run must originate from this repository",
  );
  assert(
    run.actor?.login !== "dependabot[bot]",
    "Dependabot runs are excluded",
  );
  assert(
    typeof run.head_sha === "string" && /^[0-9a-f]{40}$/.test(run.head_sha),
    "Invalid workflow head SHA",
  );
  assert(
    ["merge_group", "pull_request", "push"].includes(run.event),
    "Unexpected workflow event",
  );
  assert(
    typeof repository.default_branch === "string" &&
      repository.default_branch.length > 0,
    "Repository default branch is missing",
  );

  if (run.event === "push") {
    assert(
      run.head_branch === repository.default_branch,
      "Push runs must target the default branch",
    );
    assert(
      pullRequest === null,
      "Push runs must not provide pull request data",
    );
  }

  if (run.event === "pull_request") {
    assert(
      Array.isArray(run.pull_requests) && run.pull_requests.length === 1,
      "Pull request runs must identify exactly one pull request",
    );
    const associatedPullRequest = run.pull_requests[0];
    assert(pullRequest !== null, "Pull request data is required");
    assert(
      associatedPullRequest.number === pullRequest.number,
      "Pull request number mismatch",
    );
    assert(
      associatedPullRequest.head?.sha === run.head_sha &&
        pullRequest.head?.sha === run.head_sha,
      "Pull request head SHA mismatch",
    );
    assert(
      associatedPullRequest.head?.repo?.url === repository.url &&
        pullRequest.head?.repo?.full_name === repository.full_name,
      "Pull request head repository mismatch",
    );
    assert(
      associatedPullRequest.base?.ref === repository.default_branch &&
        pullRequest.base?.repo?.full_name === repository.full_name,
      "Pull request base mismatch",
    );
  }

  if (run.event === "merge_group") {
    const queueBranch = new RegExp(
      `^gh-readonly-queue/${escapeRegExp(repository.default_branch)}/pr-[0-9]+-[0-9a-f]{40}$`,
    );
    assert(
      typeof run.head_branch === "string" && queueBranch.test(run.head_branch),
      "Merge-group run does not have the expected queue branch",
    );
    assert(
      pullRequest === null,
      "Merge-group runs must not provide pull request data",
    );
  }

  return {
    headSha: run.head_sha,
    prNumber: pullRequest?.number ?? "",
    runAttempt: run.run_attempt,
    source: run.name,
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main() {
  const [
    eventRunPath,
    runPath,
    repositoryPath,
    expectedRunIdValue,
    workflowIdValue,
    pullRequestPath,
  ] = process.argv.slice(2);
  if (
    !eventRunPath ||
    !runPath ||
    !repositoryPath ||
    !expectedRunIdValue ||
    !workflowIdValue
  ) {
    throw new Error(
      "Usage: validate-workflow-run.mjs <event-run-json> <run-json> <repository-json> <run-id> <workflow-id> [pull-request-json]",
    );
  }
  const expectedRunId = Number(expectedRunIdValue);
  const workflowId = Number(workflowIdValue);
  assert(isPositiveInteger(expectedRunId), "Invalid expected workflow run ID");
  assert(isPositiveInteger(workflowId), "Invalid workflow ID");
  const result = validateWorkflowRun({
    eventRun: readJson(eventRunPath),
    expectedRunId,
    run: readJson(runPath),
    repository: readJson(repositoryPath),
    workflowId,
    pullRequest: pullRequestPath ? readJson(pullRequestPath) : null,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
