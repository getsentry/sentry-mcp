#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const CONCLUSIONS = new Set([
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
const SHA_PATTERN = /^[0-9a-f]{40}$/;

function requireObject(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value;
}

function requirePositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

function requireString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a nonempty string`);
  }
  return value;
}

/** Validate that a recovery trigger and fresh API result describe one trusted deploy run. */
export function validateRecoveryRun(
  eventRunValue,
  apiRunValue,
  repositoryValue,
  expectedWorkflowIdValue,
) {
  const eventRun = requireObject(eventRunValue, "event workflow run");
  const apiRun = requireObject(apiRunValue, "API workflow run");
  const repository = requireObject(repositoryValue, "repository");
  const expectedWorkflowId = requirePositiveInteger(
    expectedWorkflowIdValue,
    "expected workflow ID",
  );
  const repositoryName = requireString(
    repository.full_name,
    "repository full name",
  );
  const defaultBranch = requireString(
    repository.default_branch,
    "default branch",
  );

  const matchedFields = [
    "id",
    "workflow_id",
    "run_attempt",
    "status",
    "conclusion",
    "event",
    "head_branch",
    "head_sha",
  ];
  for (const field of matchedFields) {
    if (eventRun[field] !== apiRun[field]) {
      throw new Error(`Recovery workflow run ${field} mismatch`);
    }
  }

  const runId = requirePositiveInteger(apiRun.id, "workflow run ID");
  const runAttempt = requirePositiveInteger(apiRun.run_attempt, "run attempt");
  if (apiRun.workflow_id !== expectedWorkflowId) {
    throw new Error(
      "Recovery trigger is not the canonical deployment workflow",
    );
  }
  if (apiRun.status !== "completed") {
    throw new Error("Deployment workflow run must be completed");
  }
  if (!CONCLUSIONS.has(apiRun.conclusion)) {
    throw new Error("Deployment workflow run has an unexpected conclusion");
  }
  if (apiRun.event !== "workflow_run") {
    throw new Error(
      "Deployment workflow must have been triggered by workflow_run",
    );
  }
  if (apiRun.head_branch !== defaultBranch) {
    throw new Error("Deployment workflow did not run on the default branch");
  }
  if (!SHA_PATTERN.test(apiRun.head_sha)) {
    throw new Error("Deployment workflow head SHA is invalid");
  }

  const eventRepository = requireObject(
    eventRun.head_repository,
    "event head repository",
  );
  const apiRepository = requireObject(
    apiRun.head_repository,
    "API head repository",
  );
  if (
    eventRepository.full_name !== repositoryName ||
    apiRepository.full_name !== repositoryName
  ) {
    throw new Error("Deployment workflow belongs to a different repository");
  }

  return {
    conclusion: apiRun.conclusion,
    headSha: apiRun.head_sha,
    runAttempt,
    runId,
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 6) {
      throw new Error(
        "Usage: validate-recovery-run.mjs <event-run> <api-run> <repository> <workflow-id>",
      );
    }
    const result = validateRecoveryRun(
      readJson(process.argv[2]),
      readJson(process.argv[3]),
      readJson(process.argv[4]),
      Number(process.argv[5]),
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
