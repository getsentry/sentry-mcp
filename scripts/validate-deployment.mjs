import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const COMMIT_SHA = /^[0-9a-f]{40}$/;
const TERMINAL_CONCLUSIONS = new Set([
  "action_required",
  "cancelled",
  "failure",
  "neutral",
  "skipped",
  "stale",
  "startup_failure",
  "success",
  "timed_out",
]);

/** Validate that a Test run still represents the deployable default-branch head. */
export function validateDeployment({
  apiRun,
  currentHeadSha,
  eventRun,
  expectedWorkflowId,
  repository,
}) {
  if (!Number.isSafeInteger(expectedWorkflowId) || expectedWorkflowId <= 0) {
    throw new Error("Expected workflow ID must be a positive safe integer");
  }
  if (
    !repository ||
    typeof repository.full_name !== "string" ||
    typeof repository.default_branch !== "string" ||
    repository.default_branch === ""
  ) {
    throw new Error("Repository metadata is invalid");
  }
  if (!eventRun || !apiRun || eventRun.id !== apiRun.id) {
    throw new Error("Deployment run ID mismatch");
  }
  if (
    !Number.isSafeInteger(apiRun.id) ||
    apiRun.id <= 0 ||
    apiRun.workflow_id !== expectedWorkflowId ||
    eventRun.workflow_id !== expectedWorkflowId
  ) {
    throw new Error("Deployment source is not the expected Test workflow");
  }
  for (const field of [
    "conclusion",
    "event",
    "head_branch",
    "head_sha",
    "run_attempt",
    "status",
  ]) {
    if (eventRun[field] !== apiRun[field]) {
      throw new Error(`Deployment run ${field} mismatch`);
    }
  }
  if (
    apiRun.status !== "completed" ||
    apiRun.conclusion !== "success" ||
    apiRun.event !== "push"
  ) {
    throw new Error("Deployment requires a successful completed push run");
  }
  if (
    apiRun.head_repository?.full_name !== repository.full_name ||
    eventRun.head_repository?.full_name !== repository.full_name
  ) {
    throw new Error("Deployment run must originate from this repository");
  }
  if (apiRun.head_branch !== repository.default_branch) {
    throw new Error("Deployment run must target the default branch");
  }
  if (!COMMIT_SHA.test(apiRun.head_sha)) {
    throw new Error("Deployment head SHA must be a lowercase commit SHA");
  }
  if (currentHeadSha !== apiRun.head_sha) {
    throw new Error("Deployment run is stale relative to the default branch");
  }
  return { headSha: apiRun.head_sha };
}

/** Validate the completed deployment run that triggered trusted recovery. */
export function validateDeploymentRecovery({
  apiRun,
  eventRun,
  expectedWorkflowId,
  repository,
}) {
  if (!Number.isSafeInteger(expectedWorkflowId) || expectedWorkflowId <= 0) {
    throw new Error("Expected workflow ID must be a positive safe integer");
  }
  if (
    !repository ||
    typeof repository.full_name !== "string" ||
    typeof repository.default_branch !== "string" ||
    repository.default_branch === ""
  ) {
    throw new Error("Repository metadata is invalid");
  }
  if (!eventRun || !apiRun || eventRun.id !== apiRun.id) {
    throw new Error("Deployment run ID mismatch");
  }
  if (
    !Number.isSafeInteger(apiRun.id) ||
    apiRun.id <= 0 ||
    apiRun.workflow_id !== expectedWorkflowId ||
    eventRun.workflow_id !== expectedWorkflowId
  ) {
    throw new Error("Deployment source is not the expected workflow");
  }
  for (const field of [
    "conclusion",
    "event",
    "head_branch",
    "head_sha",
    "run_attempt",
    "status",
  ]) {
    if (eventRun[field] !== apiRun[field]) {
      throw new Error(`Deployment run ${field} mismatch`);
    }
  }
  if (!Number.isSafeInteger(apiRun.run_attempt) || apiRun.run_attempt <= 0) {
    throw new Error("Deployment run attempt must be a positive safe integer");
  }
  if (
    apiRun.status !== "completed" ||
    !TERMINAL_CONCLUSIONS.has(apiRun.conclusion) ||
    apiRun.event !== "workflow_run"
  ) {
    throw new Error("Recovery requires a completed workflow_run deployment");
  }
  if (
    apiRun.head_repository?.full_name !== repository.full_name ||
    eventRun.head_repository?.full_name !== repository.full_name
  ) {
    throw new Error("Deployment run must originate from this repository");
  }
  if (apiRun.head_branch !== repository.default_branch) {
    throw new Error("Deployment run must target the default branch");
  }
  if (!COMMIT_SHA.test(apiRun.head_sha)) {
    throw new Error("Deployment head SHA must be a lowercase commit SHA");
  }
  return {
    conclusion: apiRun.conclusion,
    headSha: apiRun.head_sha,
    runAttempt: apiRun.run_attempt,
    runId: apiRun.id,
  };
}

function main() {
  if (process.argv[2] === "--recovery") {
    if (process.argv.length !== 7) {
      throw new Error(
        "Usage: validate-deployment.mjs --recovery <event-run> <api-run> <repository> <workflow-id>",
      );
    }
    const [, , , eventRunPath, apiRunPath, repositoryPath, workflowId] =
      process.argv;
    const result = validateDeploymentRecovery({
      eventRun: JSON.parse(readFileSync(eventRunPath, "utf8")),
      apiRun: JSON.parse(readFileSync(apiRunPath, "utf8")),
      repository: JSON.parse(readFileSync(repositoryPath, "utf8")),
      expectedWorkflowId: Number(workflowId),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (process.argv.length !== 7) {
    throw new Error(
      "Usage: validate-deployment.mjs <event-run> <api-run> <repository> <workflow-id> <current-head-sha>",
    );
  }
  const [
    ,
    ,
    eventRunPath,
    apiRunPath,
    repositoryPath,
    workflowId,
    currentHeadSha,
  ] = process.argv;
  const result = validateDeployment({
    eventRun: JSON.parse(readFileSync(eventRunPath, "utf8")),
    apiRun: JSON.parse(readFileSync(apiRunPath, "utf8")),
    repository: JSON.parse(readFileSync(repositoryPath, "utf8")),
    expectedWorkflowId: Number(workflowId),
    currentHeadSha,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
