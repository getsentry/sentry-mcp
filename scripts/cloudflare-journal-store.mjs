#!/usr/bin/env node

import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { parseDeploymentJournal } from "./cloudflare-deployment.mjs";

const API_ORIGIN = "https://api.github.com";
const API_VERSION = "2022-11-28";
const BRANCH = "cloudflare-deployment-journal";
const JOURNAL_DIRECTORY = ".github/cloudflare-deployment-journals";
const BOOTSTRAP_PATH = `${JOURNAL_DIRECTORY}/bootstrap.json`;
const LATEST_PATH = `${JOURNAL_DIRECTORY}/latest.json`;
const RECONCILIATION_PATH = `${JOURNAL_DIRECTORY}/reconciliation.json`;
const RECONCILIATION_DIRECTORY = "reconciliations";
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_BLOB_BYTES = 64 * 1024;
const GIT_SHA = /^[0-9a-f]{40}$/;
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPOSITORY = /^[A-Za-z0-9._-]{1,100}$/;
const CANONICAL_INTEGER = /^[1-9][0-9]*$/;
const JOURNAL_FILE = /^([1-9][0-9]*)-([1-9][0-9]*)\.json$/;
const RECONCILIATION_FILE =
  /^([1-9][0-9]*)-([1-9][0-9]*)-([1-9][0-9]*)-([1-9][0-9]*)-(claim|completion)\.json$/;
const RECONCILIATION_ACTIONS = new Set(["restore", "verify-promoted"]);
const TAKEOVER_CONCLUSIONS = new Set([
  "action_required",
  "cancelled",
  "failure",
  "neutral",
  "skipped",
  "stale",
  "startup_failure",
  "timed_out",
]);
const BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * @typedef {object} BootstrapMarker
 * @property {1} schemaVersion
 * @property {string} repository
 * @property {string} trustedSha
 * @property {number} runId
 * @property {number} runAttempt
 */

/**
 * @typedef {object} GitTreeEntry
 * @property {string} path
 * @property {"blob" | "commit" | "tree"} type
 * @property {string} mode
 * @property {string} sha
 */

/** @typedef {ReturnType<typeof parseDeploymentJournal>} DeploymentJournal */

class JournalStoreError extends Error {}

function requireObject(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new JournalStoreError(`${name} must be an object`);
  }
  return value;
}

function requireString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new JournalStoreError(`${name} must be a non-empty string`);
  }
  return value;
}

function requireExactKeys(value, keys, name) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new JournalStoreError(`${name} has an invalid shape`);
  }
}

function parsePositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new JournalStoreError(`${name} must be a positive safe integer`);
  }
  return value;
}

function parsePositiveIntegerArgument(value, name) {
  if (typeof value !== "string" || !CANONICAL_INTEGER.test(value)) {
    throw new JournalStoreError(`${name} must be a canonical positive integer`);
  }
  return parsePositiveInteger(Number(value), name);
}

function parseGitSha(value, name) {
  if (typeof value !== "string" || !GIT_SHA.test(value)) {
    throw new JournalStoreError(
      `${name} must be a lowercase 40-character Git SHA`,
    );
  }
  return value;
}

function parseRepository(value) {
  if (typeof value !== "string") {
    throw new JournalStoreError("GITHUB_REPOSITORY must be owner/repository");
  }
  const parts = value.split("/");
  if (
    parts.length !== 2 ||
    !OWNER.test(parts[0]) ||
    !REPOSITORY.test(parts[1]) ||
    parts[1] === "." ||
    parts[1] === ".."
  ) {
    throw new JournalStoreError("GITHUB_REPOSITORY must be owner/repository");
  }
  return { owner: parts[0], name: parts[1], fullName: value };
}

function parseToken(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 4096 ||
    !/^[\x21-\x7e]+$/.test(value)
  ) {
    throw new JournalStoreError("GH_TOKEN must be a non-empty API token");
  }
  return value;
}

function parseJson(text, name) {
  if (typeof text !== "string" || text.length === 0) {
    throw new JournalStoreError(`${name} must be non-empty JSON`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new JournalStoreError(`${name} is malformed JSON`);
  }
}

function canonicalJson(value) {
  return `${JSON.stringify(value)}\n`;
}

function normalizeJournal(value) {
  try {
    return parseDeploymentJournal(value);
  } catch (error) {
    throw new JournalStoreError(
      error instanceof Error ? error.message : "deployment journal is invalid",
    );
  }
}

function parseCanonicalJournal(text, name) {
  const journal = normalizeJournal(parseJson(text, name));
  if (canonicalJson(journal) !== text) {
    throw new JournalStoreError(`${name} is not canonical JSON`);
  }
  return journal;
}

function normalizeBootstrapMarker(value, repository) {
  const marker = requireObject(value, "bootstrap marker");
  requireExactKeys(
    marker,
    ["repository", "runAttempt", "runId", "schemaVersion", "trustedSha"],
    "bootstrap marker",
  );
  if (marker.schemaVersion !== 1) {
    throw new JournalStoreError(
      "bootstrap marker schema version is unsupported",
    );
  }
  if (marker.repository !== repository) {
    throw new JournalStoreError("bootstrap marker repository does not match");
  }
  return {
    schemaVersion: 1,
    repository,
    trustedSha: parseGitSha(marker.trustedSha, "bootstrap marker trustedSha"),
    runId: parsePositiveInteger(marker.runId, "bootstrap marker runId"),
    runAttempt: parsePositiveInteger(
      marker.runAttempt,
      "bootstrap marker runAttempt",
    ),
  };
}

function parseCanonicalBootstrapMarker(text, repository) {
  const marker = normalizeBootstrapMarker(
    parseJson(text, "bootstrap marker"),
    repository,
  );
  if (canonicalJson(marker) !== text) {
    throw new JournalStoreError("bootstrap marker is not canonical JSON");
  }
  return marker;
}

function normalizeTakeover(value) {
  if (value === null) {
    return null;
  }
  const takeover = requireObject(value, "reconciliation takeover");
  requireExactKeys(
    takeover,
    ["claimantRunAttempt", "claimantRunId", "conclusion"],
    "reconciliation takeover",
  );
  if (!TAKEOVER_CONCLUSIONS.has(takeover.conclusion)) {
    throw new JournalStoreError(
      "reconciliation takeover conclusion is not terminal or safe",
    );
  }
  return {
    claimantRunId: parsePositiveInteger(
      takeover.claimantRunId,
      "reconciliation takeover claimantRunId",
    ),
    claimantRunAttempt: parsePositiveInteger(
      takeover.claimantRunAttempt,
      "reconciliation takeover claimantRunAttempt",
    ),
    conclusion: takeover.conclusion,
  };
}

function normalizeClaimInput(value) {
  const claim = requireObject(value, "reconciliation claim");
  requireExactKeys(
    claim,
    [
      "action",
      "claimantHeadSha",
      "claimantRunAttempt",
      "claimantRunId",
      "claimantWorkflowId",
      "schemaVersion",
      "takeover",
      "targetRunAttempt",
      "targetRunId",
    ],
    "reconciliation claim",
  );
  if (claim.schemaVersion !== 1) {
    throw new JournalStoreError(
      "reconciliation claim schema version is unsupported",
    );
  }
  if (!RECONCILIATION_ACTIONS.has(claim.action)) {
    throw new JournalStoreError("reconciliation claim action is invalid");
  }
  return {
    schemaVersion: 1,
    targetRunId: parsePositiveInteger(
      claim.targetRunId,
      "reconciliation claim targetRunId",
    ),
    targetRunAttempt: parsePositiveInteger(
      claim.targetRunAttempt,
      "reconciliation claim targetRunAttempt",
    ),
    claimantRunId: parsePositiveInteger(
      claim.claimantRunId,
      "reconciliation claim claimantRunId",
    ),
    claimantRunAttempt: parsePositiveInteger(
      claim.claimantRunAttempt,
      "reconciliation claim claimantRunAttempt",
    ),
    claimantWorkflowId: parsePositiveInteger(
      claim.claimantWorkflowId,
      "reconciliation claim claimantWorkflowId",
    ),
    claimantHeadSha: parseGitSha(
      claim.claimantHeadSha,
      "reconciliation claim claimantHeadSha",
    ),
    action: claim.action,
    takeover: normalizeTakeover(claim.takeover),
  };
}

function normalizeReconciliationResult(value, action) {
  const result = requireObject(value, "reconciliation result");
  requireExactKeys(result, ["decision", "state"], "reconciliation result");
  const valid =
    (action === "verify-promoted" &&
      result.state === "promoted" &&
      result.decision === "restore") ||
    (action === "restore" &&
      ((result.state === "unchanged" && result.decision === "unchanged") ||
        (result.state === "restored" && result.decision === "restored")));
  if (!valid) {
    throw new JournalStoreError(
      "reconciliation result does not prove the claimed action succeeded",
    );
  }
  return { state: result.state, decision: result.decision };
}

function normalizeCompletionInput(value) {
  const completion = requireObject(value, "reconciliation completion");
  requireExactKeys(
    completion,
    ["claimantRunAttempt", "claimantRunId", "result", "schemaVersion"],
    "reconciliation completion",
  );
  if (completion.schemaVersion !== 1) {
    throw new JournalStoreError(
      "reconciliation completion schema version is unsupported",
    );
  }
  return {
    claimantRunId: parsePositiveInteger(
      completion.claimantRunId,
      "reconciliation completion claimantRunId",
    ),
    claimantRunAttempt: parsePositiveInteger(
      completion.claimantRunAttempt,
      "reconciliation completion claimantRunAttempt",
    ),
    result: completion.result,
  };
}

function normalizeReconciliationRecord(value) {
  const record = requireObject(value, "reconciliation record");
  const commonKeys = [
    "action",
    "claimantHeadSha",
    "claimantRunAttempt",
    "claimantRunId",
    "claimantWorkflowId",
    "previousReconciliationSha",
    "schemaVersion",
    "status",
    "takeover",
    "targetRunAttempt",
    "targetRunId",
  ];
  if (record.status === "claimed") {
    requireExactKeys(record, commonKeys, "reconciliation claim record");
  } else if (record.status === "completed") {
    requireExactKeys(
      record,
      [...commonKeys, "claimSha", "result"],
      "reconciliation completion record",
    );
  } else {
    throw new JournalStoreError("reconciliation record status is invalid");
  }
  const claim = normalizeClaimInput({
    schemaVersion: record.schemaVersion,
    targetRunId: record.targetRunId,
    targetRunAttempt: record.targetRunAttempt,
    claimantRunId: record.claimantRunId,
    claimantRunAttempt: record.claimantRunAttempt,
    claimantWorkflowId: record.claimantWorkflowId,
    claimantHeadSha: record.claimantHeadSha,
    action: record.action,
    takeover: record.takeover,
  });
  const previousReconciliationSha =
    record.previousReconciliationSha === null
      ? null
      : parseGitSha(
          record.previousReconciliationSha,
          "reconciliation record previousReconciliationSha",
        );
  const normalized = {
    ...claim,
    status: record.status,
    previousReconciliationSha,
  };
  if (record.status === "claimed") {
    return normalized;
  }
  return {
    ...normalized,
    claimSha: parseGitSha(record.claimSha, "reconciliation record claimSha"),
    result: normalizeReconciliationResult(record.result, claim.action),
  };
}

function parseCanonicalReconciliationRecord(text) {
  const record = normalizeReconciliationRecord(
    parseJson(text, "reconciliation record"),
  );
  if (canonicalJson(record) !== text) {
    throw new JournalStoreError("reconciliation record is not canonical JSON");
  }
  return record;
}

function reconciliationFileName(record) {
  const suffix = record.status === "claimed" ? "claim" : "completion";
  return `${record.targetRunId}-${record.targetRunAttempt}-${record.claimantRunId}-${record.claimantRunAttempt}-${suffix}.json`;
}

function summarizeReconciliation(record) {
  if (record === null) {
    return null;
  }
  return {
    status: record.status,
    targetRunId: record.targetRunId,
    targetRunAttempt: record.targetRunAttempt,
    claimantRunId: record.claimantRunId,
    claimantRunAttempt: record.claimantRunAttempt,
    claimantWorkflowId: record.claimantWorkflowId,
    claimantHeadSha: record.claimantHeadSha,
    action: record.action,
  };
}

async function cancelResponseBody(response) {
  if (response?.body && response.bodyUsed === false) {
    try {
      await response.body.cancel();
    } catch {
      // Cancellation is cleanup and must not mask the request result.
    }
  }
}

async function readBoundedResponse(response, operation) {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(contentLength)) {
      await cancelResponseBody(response);
      throw new JournalStoreError(
        `GitHub API ${operation} returned an invalid Content-Length`,
      );
    }
    if (Number(contentLength) > MAX_RESPONSE_BYTES) {
      await cancelResponseBody(response);
      throw new JournalStoreError(
        `GitHub API ${operation} response exceeds the size limit`,
      );
    }
  }
  if (response.body === null) {
    throw new JournalStoreError(
      `GitHub API ${operation} returned an empty response body`,
    );
  }

  const reader = response.body.getReader();
  const chunks = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteLength = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      if (!(result.value instanceof Uint8Array)) {
        throw new JournalStoreError(
          `GitHub API ${operation} returned an invalid response body`,
        );
      }
      byteLength += result.value.byteLength;
      if (byteLength > MAX_RESPONSE_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // Cancellation is cleanup and must not mask the size failure.
        }
        throw new JournalStoreError(
          `GitHub API ${operation} response exceeds the size limit`,
        );
      }
      chunks.push(result.value);
    }

    const body = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return decoder.decode(body);
    } catch {
      throw new JournalStoreError(
        `GitHub API ${operation} response is not valid UTF-8`,
      );
    }
  } catch (error) {
    if (error instanceof JournalStoreError) {
      throw error;
    }
    throw new JournalStoreError(
      `GitHub API ${operation} response body could not be read`,
    );
  } finally {
    reader.releaseLock();
  }
}

function validateResponse(response, expectedUrl, operation) {
  if (
    response === null ||
    typeof response !== "object" ||
    typeof response.url !== "string" ||
    !Number.isInteger(response.status) ||
    response.status < 100 ||
    response.status > 599 ||
    response.headers === null ||
    typeof response.headers !== "object" ||
    typeof response.headers.get !== "function"
  ) {
    throw new JournalStoreError(
      `GitHub API ${operation} returned an invalid response`,
    );
  }

  let responseUrl;
  try {
    responseUrl = new URL(response.url);
  } catch {
    throw new JournalStoreError(
      `GitHub API ${operation} returned an invalid response URL`,
    );
  }
  if (
    responseUrl.origin !== API_ORIGIN ||
    responseUrl.href !== expectedUrl.href
  ) {
    throw new JournalStoreError(
      `GitHub API ${operation} returned a response from an unexpected origin`,
    );
  }
}

function createApi(fetchImpl, token, repository) {
  if (typeof fetchImpl !== "function") {
    throw new JournalStoreError("fetchImpl must be a function");
  }
  const repositoryPath = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;

  async function requestJson(
    method,
    path,
    body,
    expectedStatus,
    operation,
    allow404,
  ) {
    const url = new URL(`${repositoryPath}${path}`, API_ORIGIN);
    if (url.origin !== API_ORIGIN) {
      throw new JournalStoreError("GitHub API request origin is invalid");
    }

    let response;
    try {
      response = await fetchImpl(url, {
        method,
        redirect: "error",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": API_VERSION,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new JournalStoreError(`GitHub API ${operation} request failed`);
    }

    try {
      validateResponse(response, url, operation);
    } catch (error) {
      await cancelResponseBody(response);
      throw error;
    }
    if (allow404 && response.status === 404) {
      await cancelResponseBody(response);
      return null;
    }
    if (response.status !== expectedStatus) {
      await cancelResponseBody(response);
      throw new JournalStoreError(
        `GitHub API ${operation} failed with HTTP ${response.status}`,
      );
    }

    const text = await readBoundedResponse(response, operation);
    try {
      return JSON.parse(text);
    } catch {
      throw new JournalStoreError(
        `GitHub API ${operation} returned malformed JSON`,
      );
    }
  }

  return { requestJson };
}

function parseReference(value, expectedSha) {
  const reference = requireObject(value, "GitHub reference response");
  if (reference.ref !== `refs/heads/${BRANCH}`) {
    throw new JournalStoreError("GitHub reference response has an invalid ref");
  }
  const object = requireObject(
    reference.object,
    "GitHub reference response object",
  );
  if (object.type !== "commit") {
    throw new JournalStoreError(
      "GitHub reference response object must be a commit",
    );
  }
  const sha = parseGitSha(object.sha, "GitHub reference response SHA");
  if (expectedSha !== undefined && sha !== expectedSha) {
    throw new JournalStoreError("GitHub reference response SHA does not match");
  }
  return sha;
}

function parseCommit(value, expectedSha) {
  const commit = requireObject(value, "GitHub commit response");
  const sha = parseGitSha(commit.sha, "GitHub commit response SHA");
  if (expectedSha !== undefined && sha !== expectedSha) {
    throw new JournalStoreError("GitHub commit response SHA does not match");
  }
  const tree = requireObject(commit.tree, "GitHub commit response tree");
  const treeSha = parseGitSha(tree.sha, "GitHub commit response tree SHA");
  if (!Array.isArray(commit.parents)) {
    throw new JournalStoreError(
      "GitHub commit response parents must be an array",
    );
  }
  const parents = commit.parents.map((rawParent, index) => {
    const parent = requireObject(
      rawParent,
      `GitHub commit response parents[${index}]`,
    );
    return parseGitSha(
      parent.sha,
      `GitHub commit response parents[${index}].sha`,
    );
  });
  return { sha, treeSha, parents };
}

function parseTreeEntry(value, index) {
  const entry = requireObject(value, `GitHub tree response tree[${index}]`);
  const path = requireString(
    entry.path,
    `GitHub tree response tree[${index}].path`,
  );
  if (path.includes("/") || path === "." || path === "..") {
    throw new JournalStoreError(
      `GitHub tree response tree[${index}].path is invalid`,
    );
  }
  const type = entry.type;
  if (type !== "blob" && type !== "commit" && type !== "tree") {
    throw new JournalStoreError(
      `GitHub tree response tree[${index}].type is invalid`,
    );
  }
  const mode = requireString(
    entry.mode,
    `GitHub tree response tree[${index}].mode`,
  );
  const validMode =
    (type === "tree" && mode === "040000") ||
    (type === "commit" && mode === "160000") ||
    (type === "blob" && ["100644", "100755", "120000"].includes(mode));
  if (!validMode) {
    throw new JournalStoreError(
      `GitHub tree response tree[${index}] has an invalid type and mode`,
    );
  }
  return {
    path,
    type,
    mode,
    sha: parseGitSha(entry.sha, `GitHub tree response tree[${index}].sha`),
  };
}

function parseTree(value, expectedSha) {
  const tree = requireObject(value, "GitHub tree response");
  const sha = parseGitSha(tree.sha, "GitHub tree response SHA");
  if (expectedSha !== undefined && sha !== expectedSha) {
    throw new JournalStoreError("GitHub tree response SHA does not match");
  }
  if (tree.truncated !== false || !Array.isArray(tree.tree)) {
    throw new JournalStoreError(
      "GitHub tree response must be a complete tree array",
    );
  }
  const entries = tree.tree.map(parseTreeEntry);
  if (new Set(entries.map(({ path }) => path)).size !== entries.length) {
    throw new JournalStoreError(
      "GitHub tree response contains duplicate paths",
    );
  }
  return { sha, entries };
}

function decodeBlob(value, expectedSha) {
  const blob = requireObject(value, "GitHub blob response");
  if (parseGitSha(blob.sha, "GitHub blob response SHA") !== expectedSha) {
    throw new JournalStoreError("GitHub blob response SHA does not match");
  }
  if (blob.encoding !== "base64") {
    throw new JournalStoreError("GitHub blob response encoding must be base64");
  }
  if (
    !Number.isSafeInteger(blob.size) ||
    blob.size < 0 ||
    blob.size > MAX_BLOB_BYTES
  ) {
    throw new JournalStoreError("GitHub blob response size is invalid");
  }
  if (
    typeof blob.content !== "string" ||
    /[^A-Za-z0-9+/=\n]/.test(blob.content)
  ) {
    throw new JournalStoreError(
      "GitHub blob response content is invalid base64",
    );
  }
  const normalized = blob.content.replaceAll("\n", "");
  if (!BASE64.test(normalized)) {
    throw new JournalStoreError(
      "GitHub blob response content is invalid base64",
    );
  }
  const bytes = Buffer.from(normalized, "base64");
  if (
    bytes.byteLength !== blob.size ||
    bytes.toString("base64") !== normalized
  ) {
    throw new JournalStoreError(
      "GitHub blob response content does not match its size",
    );
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new JournalStoreError("GitHub blob response is not valid UTF-8");
  }
}

function requireTreeEntry(entries, path, type, mode, name) {
  const entry = entries.find((candidate) => candidate.path === path);
  if (entry === undefined) {
    return null;
  }
  if (entry.type !== type || entry.mode !== mode) {
    throw new JournalStoreError(`${name} has an invalid Git object type`);
  }
  return entry;
}

function parseJournalFileName(name) {
  const match = JOURNAL_FILE.exec(name);
  if (match === null) {
    return null;
  }
  return {
    runId: parsePositiveInteger(Number(match[1]), "journal filename run ID"),
    runAttempt: parsePositiveInteger(
      Number(match[2]),
      "journal filename run attempt",
    ),
  };
}

function journalPath(runId, runAttempt) {
  return `${JOURNAL_DIRECTORY}/${runId}-${runAttempt}.json`;
}

function summarizeState(state) {
  switch (state.state) {
    case "absent":
      return { state: "absent" };
    case "uninitialized":
      return {
        state: "uninitialized",
        branchHeadSha: state.branchHeadSha,
      };
    case "initialized":
      return {
        state: "initialized",
        branchHeadSha: state.branchHeadSha,
        bootstrap: state.bootstrap,
      };
    case "latest":
      return {
        state: "latest",
        branchHeadSha: state.branchHeadSha,
        runId: state.journal.runId,
        runAttempt: state.journal.runAttempt,
        headSha: state.journal.headSha,
        ...(state.reconciliation === null || state.reconciliation === undefined
          ? {}
          : {
              reconciliation: summarizeReconciliation(state.reconciliation),
            }),
      };
    default:
      throw new JournalStoreError("journal store state is invalid");
  }
}

/**
 * Create a durable Cloudflare deployment journal store backed by GitHub Git
 * Data objects.
 *
 * @param {{fetchImpl?: typeof globalThis.fetch, repository: string, token: string}} options
 * @returns {{
 *   getState: () => Promise<object>,
 *   read: (runId: number, runAttempt: number) => Promise<{branchHeadSha: string, journal: DeploymentJournal}>,
 *   append: (journal: unknown, expectedBranchHeadSha: string) => Promise<{branchHeadSha: string, journal: DeploymentJournal}>,
 *   claim: (claim: unknown, expectedBranchHeadSha: string) => Promise<{branchHeadSha: string, reconciliation: object}>,
 *   complete: (completion: unknown, expectedBranchHeadSha: string) => Promise<{branchHeadSha: string, reconciliation: object}>,
 *   bootstrap: (trustedSha: string, runId: number, runAttempt: number) => Promise<{branchHeadSha: string, bootstrap: BootstrapMarker}>
 * }}
 */
export function createCloudflareJournalStore(options) {
  const configuration = requireObject(options, "journal store options");
  const repository = parseRepository(configuration.repository);
  const token = parseToken(configuration.token);
  const fetchImpl = configuration.fetchImpl ?? globalThis.fetch;
  const api = createApi(fetchImpl, token, repository);

  async function getReference() {
    const response = await api.requestJson(
      "GET",
      `/git/ref/heads/${encodeURIComponent(BRANCH)}`,
      undefined,
      200,
      "read journal branch",
      true,
    );
    return response === null ? null : parseReference(response);
  }

  async function getCommit(sha) {
    const response = await api.requestJson(
      "GET",
      `/git/commits/${sha}`,
      undefined,
      200,
      "read commit",
      false,
    );
    return parseCommit(response, sha);
  }

  async function getTree(sha) {
    const response = await api.requestJson(
      "GET",
      `/git/trees/${sha}`,
      undefined,
      200,
      "read tree",
      false,
    );
    return parseTree(response, sha);
  }

  async function getBlob(sha) {
    const response = await api.requestJson(
      "GET",
      `/git/blobs/${sha}`,
      undefined,
      200,
      "read blob",
      false,
    );
    return decodeBlob(response, sha);
  }

  async function getStoreTree(commitSha) {
    const commit = await getCommit(commitSha);
    const root = await getTree(commit.treeSha);
    const github = requireTreeEntry(
      root.entries,
      ".github",
      "tree",
      "040000",
      ".github",
    );
    if (github === null) {
      return { commit, entries: null };
    }
    const githubTree = await getTree(github.sha);
    const directory = requireTreeEntry(
      githubTree.entries,
      "cloudflare-deployment-journals",
      "tree",
      "040000",
      JOURNAL_DIRECTORY,
    );
    if (directory === null) {
      return { commit, entries: null };
    }
    const storeTree = await getTree(directory.sha);
    return { commit, entries: storeTree.entries };
  }

  async function inspectReference(branchHeadSha) {
    const storeTree = await getStoreTree(branchHeadSha);
    if (storeTree.entries === null) {
      return {
        state: "uninitialized",
        branchHeadSha,
        rootTreeSha: storeTree.commit.treeSha,
        entries: new Map(),
      };
    }

    const entries = new Map();
    const journalEntries = [];
    const reconciliationDirectory = storeTree.entries.find(
      ({ path }) => path === RECONCILIATION_DIRECTORY,
    );
    for (const entry of storeTree.entries) {
      if (entry.path === RECONCILIATION_DIRECTORY) {
        if (entry.type !== "tree" || entry.mode !== "040000") {
          throw new JournalStoreError(
            "journal reconciliation history must be a Git tree",
          );
        }
        continue;
      }
      if (entry.type !== "blob" || entry.mode !== "100644") {
        throw new JournalStoreError(
          `journal store path '${entry.path}' must be a regular file`,
        );
      }
      if (
        entry.path !== "bootstrap.json" &&
        entry.path !== "latest.json" &&
        entry.path !== "reconciliation.json"
      ) {
        if (parseJournalFileName(entry.path) === null) {
          throw new JournalStoreError(
            `journal store contains unexpected path '${entry.path}'`,
          );
        }
        journalEntries.push(entry);
      }
      entries.set(entry.path, entry);
    }

    const bootstrapEntry = entries.get("bootstrap.json");
    if (bootstrapEntry === undefined) {
      throw new JournalStoreError(
        "journal store is malformed: bootstrap marker is missing",
      );
    }
    const bootstrap = parseCanonicalBootstrapMarker(
      await getBlob(bootstrapEntry.sha),
      repository.fullName,
    );
    const latestEntry = entries.get("latest.json");
    if (latestEntry === undefined) {
      if (journalEntries.length !== 0) {
        throw new JournalStoreError(
          "journal store is malformed: immutable journals exist without latest.json",
        );
      }
      if (
        entries.has("reconciliation.json") ||
        reconciliationDirectory !== undefined
      ) {
        throw new JournalStoreError(
          "journal store is malformed: reconciliation state exists without latest.json",
        );
      }
      return {
        state: "initialized",
        branchHeadSha,
        rootTreeSha: storeTree.commit.treeSha,
        entries,
        bootstrap,
      };
    }

    const journal = parseCanonicalJournal(
      await getBlob(latestEntry.sha),
      "latest deployment journal",
    );
    const immutableName = `${journal.runId}-${journal.runAttempt}.json`;
    const immutableEntry = entries.get(immutableName);
    if (immutableEntry === undefined) {
      throw new JournalStoreError(
        "journal store is malformed: latest journal has no immutable copy",
      );
    }
    if (immutableEntry.sha !== latestEntry.sha) {
      throw new JournalStoreError(
        "journal store is malformed: latest journal differs from its immutable copy",
      );
    }

    const reconciliationEntry = entries.get("reconciliation.json");
    if (
      (reconciliationEntry === undefined) !==
      (reconciliationDirectory === undefined)
    ) {
      throw new JournalStoreError(
        "journal store is malformed: reconciliation pointer and history must coexist",
      );
    }
    let reconciliation = null;
    let reconciliationSha = null;
    let reconciliationEntries = new Map();
    if (
      reconciliationEntry !== undefined &&
      reconciliationDirectory !== undefined
    ) {
      reconciliation = parseCanonicalReconciliationRecord(
        await getBlob(reconciliationEntry.sha),
      );
      reconciliationSha = reconciliationEntry.sha;
      const historyTree = await getTree(reconciliationDirectory.sha);
      reconciliationEntries = new Map();
      for (const entry of historyTree.entries) {
        if (
          entry.type !== "blob" ||
          entry.mode !== "100644" ||
          RECONCILIATION_FILE.test(entry.path) === false
        ) {
          throw new JournalStoreError(
            `journal store contains invalid reconciliation history path '${entry.path}'`,
          );
        }
        reconciliationEntries.set(entry.path, entry);
      }
      const immutableReconciliation = reconciliationEntries.get(
        reconciliationFileName(reconciliation),
      );
      if (
        immutableReconciliation === undefined ||
        immutableReconciliation.sha !== reconciliationEntry.sha
      ) {
        throw new JournalStoreError(
          "journal store is malformed: reconciliation pointer has no matching immutable record",
        );
      }
    }
    return {
      state: "latest",
      branchHeadSha,
      rootTreeSha: storeTree.commit.treeSha,
      entries,
      bootstrap,
      journal,
      reconciliation,
      reconciliationSha,
      reconciliationEntries,
    };
  }

  async function inspectStore() {
    const branchHeadSha = await getReference();
    if (branchHeadSha === null) {
      return { state: "absent" };
    }
    return inspectReference(branchHeadSha);
  }

  async function createBlob(content, operation) {
    const response = await api.requestJson(
      "POST",
      "/git/blobs",
      {
        content: Buffer.from(content, "utf8").toString("base64"),
        encoding: "base64",
      },
      201,
      operation,
      false,
    );
    const blob = requireObject(response, "GitHub create blob response");
    return parseGitSha(blob.sha, "GitHub create blob response SHA");
  }

  async function createTree(baseTreeSha, updates, operation) {
    const response = await api.requestJson(
      "POST",
      "/git/trees",
      {
        base_tree: baseTreeSha,
        tree: updates.map(({ path, sha }) => ({
          path,
          mode: "100644",
          type: "blob",
          sha,
        })),
      },
      201,
      operation,
      false,
    );
    return parseTree(response).sha;
  }

  async function createCommit(message, treeSha, parentSha, operation) {
    const response = await api.requestJson(
      "POST",
      "/git/commits",
      { message, tree: treeSha, parents: [parentSha] },
      201,
      operation,
      false,
    );
    const commit = parseCommit(response);
    if (
      commit.treeSha !== treeSha ||
      commit.parents.length !== 1 ||
      commit.parents[0] !== parentSha
    ) {
      throw new JournalStoreError(
        "GitHub create commit response does not match the request",
      );
    }
    return commit.sha;
  }

  async function createReference(commitSha) {
    const response = await api.requestJson(
      "POST",
      "/git/refs",
      { ref: `refs/heads/${BRANCH}`, sha: commitSha },
      201,
      "create journal branch",
      false,
    );
    parseReference(response, commitSha);
  }

  async function updateReference(commitSha) {
    const response = await api.requestJson(
      "PATCH",
      `/git/refs/heads/${encodeURIComponent(BRANCH)}`,
      { sha: commitSha, force: false },
      200,
      "update journal branch",
      false,
    );
    parseReference(response, commitSha);
  }

  async function getWorkflowRun(runId, runAttempt, operation) {
    return requireObject(
      await api.requestJson(
        "GET",
        `/actions/runs/${runId}/attempts/${runAttempt}`,
        undefined,
        200,
        operation,
        false,
      ),
      "GitHub workflow run response",
    );
  }

  function assertWorkflowRunIdentity(response, reconciliation, name) {
    const headRepository = requireObject(
      response.head_repository,
      "GitHub workflow run head repository",
    );
    if (
      response.id !== reconciliation.claimantRunId ||
      response.run_attempt !== reconciliation.claimantRunAttempt ||
      response.workflow_id !== reconciliation.claimantWorkflowId ||
      response.head_sha !== reconciliation.claimantHeadSha ||
      headRepository.full_name !== repository.fullName
    ) {
      throw new JournalStoreError(
        `${name} provenance does not match its durable claim`,
      );
    }
  }

  async function assertClaimantActive(claim) {
    const response = await getWorkflowRun(
      claim.claimantRunId,
      claim.claimantRunAttempt,
      "verify reconciliation claimant",
    );
    assertWorkflowRunIdentity(response, claim, "reconciliation claimant");
    if (response.status !== "in_progress" || response.conclusion !== null) {
      throw new JournalStoreError(
        "reconciliation claimant workflow is not active",
      );
    }
  }

  async function assertClaimantTerminated(reconciliation, takeover) {
    const response = await getWorkflowRun(
      reconciliation.claimantRunId,
      reconciliation.claimantRunAttempt,
      "verify prior reconciliation claimant",
    );
    assertWorkflowRunIdentity(
      response,
      reconciliation,
      "prior reconciliation claimant",
    );
    if (
      response.status !== "completed" ||
      response.conclusion !== takeover.conclusion
    ) {
      throw new JournalStoreError(
        "prior reconciliation claimant has not terminated with the claimed conclusion",
      );
    }
  }

  return {
    async getState() {
      const state = await inspectStore();
      switch (state.state) {
        case "absent":
          return { state: "absent" };
        case "uninitialized":
          return {
            state: "uninitialized",
            branchHeadSha: state.branchHeadSha,
          };
        case "initialized":
          return {
            state: "initialized",
            branchHeadSha: state.branchHeadSha,
            bootstrap: state.bootstrap,
          };
        case "latest":
          return {
            state: "latest",
            branchHeadSha: state.branchHeadSha,
            bootstrap: state.bootstrap,
            journal: state.journal,
            ...(state.reconciliation === null ||
            state.reconciliation === undefined
              ? {}
              : { reconciliation: state.reconciliation }),
          };
        default:
          throw new JournalStoreError("journal store state is invalid");
      }
    },

    async read(runIdValue, runAttemptValue) {
      const runId = parsePositiveInteger(runIdValue, "run ID");
      const runAttempt = parsePositiveInteger(runAttemptValue, "run attempt");
      const state = await inspectStore();
      if (state.state === "absent" || state.state === "uninitialized") {
        throw new JournalStoreError(
          `journal store is ${state.state}; bootstrap is required`,
        );
      }
      const name = `${runId}-${runAttempt}.json`;
      const entry = state.entries.get(name);
      if (entry === undefined) {
        throw new JournalStoreError(
          `deployment journal ${runId}/${runAttempt} does not exist`,
        );
      }
      const journal = parseCanonicalJournal(
        await getBlob(entry.sha),
        `deployment journal ${runId}/${runAttempt}`,
      );
      if (journal.runId !== runId || journal.runAttempt !== runAttempt) {
        throw new JournalStoreError(
          `deployment journal ${runId}/${runAttempt} does not match its path`,
        );
      }
      return { branchHeadSha: state.branchHeadSha, journal };
    },

    async append(journalValue, expectedBranchHeadShaValue) {
      const journal = normalizeJournal(journalValue);
      const expectedBranchHeadSha = parseGitSha(
        expectedBranchHeadShaValue,
        "expected journal branch head SHA",
      );
      const state = await inspectStore();
      if (state.state === "absent" || state.state === "uninitialized") {
        throw new JournalStoreError(
          `journal store is ${state.state}; bootstrap is required`,
        );
      }
      if (state.branchHeadSha !== expectedBranchHeadSha) {
        throw new JournalStoreError(
          "journal branch changed after reconciliation; refusing append",
        );
      }
      if (state.reconciliation?.status === "claimed") {
        throw new JournalStoreError(
          "journal reconciliation is still claimed; refusing append",
        );
      }
      const immutableName = `${journal.runId}-${journal.runAttempt}.json`;
      if (state.entries.has(immutableName)) {
        throw new JournalStoreError(
          `deployment journal ${journal.runId}/${journal.runAttempt} already exists`,
        );
      }
      if (state.state === "latest") {
        if (journal.runId <= state.journal.runId) {
          const message =
            journal.runId === state.journal.runId
              ? `deployment run ID ${journal.runId} is already journaled`
              : "deployment journal must advance the latest durable run ID";
          throw new JournalStoreError(message);
        }
      }

      const blobSha = await createBlob(
        canonicalJson(journal),
        "create deployment journal blob",
      );
      const treeSha = await createTree(
        state.rootTreeSha,
        [
          {
            path: journalPath(journal.runId, journal.runAttempt),
            sha: blobSha,
          },
          { path: LATEST_PATH, sha: blobSha },
        ],
        "create deployment journal tree",
      );
      const commitSha = await createCommit(
        `Append Cloudflare deployment journal for run ${journal.runId} attempt ${journal.runAttempt}`,
        treeSha,
        state.branchHeadSha,
        "create deployment journal commit",
      );
      await updateReference(commitSha);
      return { branchHeadSha: commitSha, journal };
    },

    async claim(claimValue, expectedBranchHeadShaValue) {
      const claim = normalizeClaimInput(claimValue);
      const expectedBranchHeadSha = parseGitSha(
        expectedBranchHeadShaValue,
        "expected journal branch head SHA",
      );
      const state = await inspectStore();
      if (state.state !== "latest") {
        throw new JournalStoreError(
          `journal store is ${state.state}; a latest journal is required`,
        );
      }
      if (state.branchHeadSha !== expectedBranchHeadSha) {
        throw new JournalStoreError(
          "journal branch changed before reconciliation claim",
        );
      }
      if (
        claim.targetRunId !== state.journal.runId ||
        claim.targetRunAttempt !== state.journal.runAttempt
      ) {
        throw new JournalStoreError(
          "reconciliation claim does not target the latest journal",
        );
      }
      await assertClaimantActive(claim);

      if (state.reconciliation?.status === "claimed") {
        if (
          claim.takeover === null ||
          claim.takeover.claimantRunId !== state.reconciliation.claimantRunId ||
          claim.takeover.claimantRunAttempt !==
            state.reconciliation.claimantRunAttempt
        ) {
          throw new JournalStoreError(
            "active reconciliation claim requires an exact terminated-claimant takeover",
          );
        }
        await assertClaimantTerminated(state.reconciliation, claim.takeover);
      } else if (claim.takeover !== null) {
        throw new JournalStoreError(
          "reconciliation takeover was supplied without an active claim",
        );
      }

      const reconciliation = {
        ...claim,
        status: "claimed",
        previousReconciliationSha: state.reconciliationSha,
      };
      const immutableName = reconciliationFileName(reconciliation);
      if (state.reconciliationEntries.has(immutableName)) {
        throw new JournalStoreError(
          "reconciliation claim for this workflow attempt already exists",
        );
      }
      const blobSha = await createBlob(
        canonicalJson(reconciliation),
        "create reconciliation claim blob",
      );
      const treeSha = await createTree(
        state.rootTreeSha,
        [
          {
            path: `${JOURNAL_DIRECTORY}/${RECONCILIATION_DIRECTORY}/${immutableName}`,
            sha: blobSha,
          },
          { path: RECONCILIATION_PATH, sha: blobSha },
        ],
        "create reconciliation claim tree",
      );
      const commitSha = await createCommit(
        `Claim Cloudflare reconciliation for deployment ${claim.targetRunId}/${claim.targetRunAttempt} by workflow ${claim.claimantRunId}/${claim.claimantRunAttempt}`,
        treeSha,
        state.branchHeadSha,
        "create reconciliation claim commit",
      );
      await updateReference(commitSha);
      return { branchHeadSha: commitSha, reconciliation };
    },

    async complete(completionValue, expectedBranchHeadShaValue) {
      const completion = normalizeCompletionInput(completionValue);
      const expectedBranchHeadSha = parseGitSha(
        expectedBranchHeadShaValue,
        "expected journal branch head SHA",
      );
      const state = await inspectStore();
      if (state.state !== "latest") {
        throw new JournalStoreError(
          `journal store is ${state.state}; a claimed journal is required`,
        );
      }
      if (state.branchHeadSha !== expectedBranchHeadSha) {
        throw new JournalStoreError(
          "journal branch changed before reconciliation completion",
        );
      }
      if (state.reconciliation?.status !== "claimed") {
        throw new JournalStoreError(
          "journal reconciliation has no active claim to complete",
        );
      }
      if (
        completion.claimantRunId !== state.reconciliation.claimantRunId ||
        completion.claimantRunAttempt !==
          state.reconciliation.claimantRunAttempt
      ) {
        throw new JournalStoreError(
          "only the active reconciliation claimant may complete the claim",
        );
      }
      const reconciliation = {
        ...state.reconciliation,
        status: "completed",
        claimSha: state.reconciliationSha,
        result: normalizeReconciliationResult(
          completion.result,
          state.reconciliation.action,
        ),
      };
      const immutableName = reconciliationFileName(reconciliation);
      if (state.reconciliationEntries.has(immutableName)) {
        throw new JournalStoreError(
          "reconciliation completion for this workflow attempt already exists",
        );
      }
      const blobSha = await createBlob(
        canonicalJson(reconciliation),
        "create reconciliation completion blob",
      );
      const treeSha = await createTree(
        state.rootTreeSha,
        [
          {
            path: `${JOURNAL_DIRECTORY}/${RECONCILIATION_DIRECTORY}/${immutableName}`,
            sha: blobSha,
          },
          { path: RECONCILIATION_PATH, sha: blobSha },
        ],
        "create reconciliation completion tree",
      );
      const commitSha = await createCommit(
        `Complete Cloudflare reconciliation for deployment ${reconciliation.targetRunId}/${reconciliation.targetRunAttempt} by workflow ${reconciliation.claimantRunId}/${reconciliation.claimantRunAttempt}`,
        treeSha,
        state.branchHeadSha,
        "create reconciliation completion commit",
      );
      await updateReference(commitSha);
      return { branchHeadSha: commitSha, reconciliation };
    },

    async bootstrap(trustedShaValue, runIdValue, runAttemptValue) {
      const trustedSha = parseGitSha(trustedShaValue, "trusted SHA");
      const runId = parsePositiveInteger(runIdValue, "run ID");
      const runAttempt = parsePositiveInteger(runAttemptValue, "run attempt");
      if ((await getReference()) !== null) {
        throw new JournalStoreError("journal branch already exists");
      }

      const trustedTree = await getStoreTree(trustedSha);
      if (trustedTree.entries !== null) {
        throw new JournalStoreError(
          "trusted commit already contains a journal store directory",
        );
      }
      const bootstrap = {
        schemaVersion: 1,
        repository: repository.fullName,
        trustedSha,
        runId,
        runAttempt,
      };
      const blobSha = await createBlob(
        canonicalJson(bootstrap),
        "create bootstrap marker blob",
      );
      const treeSha = await createTree(
        trustedTree.commit.treeSha,
        [{ path: BOOTSTRAP_PATH, sha: blobSha }],
        "create bootstrap marker tree",
      );
      const commitSha = await createCommit(
        `Bootstrap Cloudflare deployment journal for run ${runId} attempt ${runAttempt}`,
        treeSha,
        trustedSha,
        "create bootstrap commit",
      );
      await createReference(commitSha);
      return { branchHeadSha: commitSha, bootstrap };
    },
  };
}

function requireOutputPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new JournalStoreError("output path must be a non-empty file path");
  }
  try {
    lstatSync(value);
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return value;
    }
    throw new JournalStoreError("output path could not be inspected");
  }
  throw new JournalStoreError("output path already exists");
}

function writeCanonicalOutput(path, value) {
  try {
    writeFileSync(path, canonicalJson(value), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch {
    throw new JournalStoreError("output file could not be written");
  }
}

function readJournalFile(path) {
  return normalizeJournal(readJsonFile(path, "deployment journal file"));
}

function readJsonFile(path, name) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new JournalStoreError(`${name} could not be read`);
  }
  return parseJson(text, name);
}

function writeMachineOutput(output, value) {
  output.write(canonicalJson(value));
}

/**
 * Run the workflow-facing journal store CLI.
 *
 * @param {readonly string[]} args
 * @param {{env?: NodeJS.ProcessEnv, fetchImpl?: typeof globalThis.fetch, stdout?: Pick<NodeJS.WriteStream, "write">}} [options]
 * @returns {Promise<void>}
 */
export async function runCli(args, options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const stdout = options.stdout ?? process.stdout;
  const [command, ...operands] = args;
  const store = createCloudflareJournalStore({
    fetchImpl,
    repository: env.GITHUB_REPOSITORY,
    token: env.GH_TOKEN,
  });

  switch (command) {
    case "state": {
      if (operands.length !== 1) {
        throw new JournalStoreError(
          "Usage: cloudflare-journal-store.mjs state <output>",
        );
      }
      const outputPath = requireOutputPath(operands[0]);
      const state = await store.getState();
      if (state.state === "latest") {
        writeCanonicalOutput(outputPath, state.journal);
      }
      writeMachineOutput(stdout, summarizeState(state));
      return;
    }
    case "read": {
      if (operands.length !== 3) {
        throw new JournalStoreError(
          "Usage: cloudflare-journal-store.mjs read <run-id> <attempt> <output>",
        );
      }
      const runId = parsePositiveIntegerArgument(operands[0], "run ID");
      const runAttempt = parsePositiveIntegerArgument(
        operands[1],
        "run attempt",
      );
      const outputPath = requireOutputPath(operands[2]);
      const result = await store.read(runId, runAttempt);
      writeCanonicalOutput(outputPath, result.journal);
      writeMachineOutput(stdout, {
        state: "found",
        branchHeadSha: result.branchHeadSha,
        runId,
        runAttempt,
        headSha: result.journal.headSha,
      });
      return;
    }
    case "append": {
      if (operands.length !== 2) {
        throw new JournalStoreError(
          "Usage: cloudflare-journal-store.mjs append <journal-file> <expected-branch-head-sha>",
        );
      }
      const result = await store.append(
        readJournalFile(operands[0]),
        operands[1],
      );
      writeMachineOutput(stdout, {
        state: "appended",
        branchHeadSha: result.branchHeadSha,
        runId: result.journal.runId,
        runAttempt: result.journal.runAttempt,
        headSha: result.journal.headSha,
      });
      return;
    }
    case "claim": {
      if (operands.length !== 2) {
        throw new JournalStoreError(
          "Usage: cloudflare-journal-store.mjs claim <claim-file> <expected-branch-head-sha>",
        );
      }
      const result = await store.claim(
        readJsonFile(operands[0], "reconciliation claim file"),
        operands[1],
      );
      writeMachineOutput(stdout, {
        state: "claimed",
        branchHeadSha: result.branchHeadSha,
        reconciliation: summarizeReconciliation(result.reconciliation),
      });
      return;
    }
    case "complete": {
      if (operands.length !== 2) {
        throw new JournalStoreError(
          "Usage: cloudflare-journal-store.mjs complete <completion-file> <expected-branch-head-sha>",
        );
      }
      const result = await store.complete(
        readJsonFile(operands[0], "reconciliation completion file"),
        operands[1],
      );
      writeMachineOutput(stdout, {
        state: "completed",
        branchHeadSha: result.branchHeadSha,
        reconciliation: summarizeReconciliation(result.reconciliation),
        result: result.reconciliation.result,
      });
      return;
    }
    case "bootstrap": {
      if (operands.length !== 3) {
        throw new JournalStoreError(
          "Usage: cloudflare-journal-store.mjs bootstrap <trusted-sha> <run-id> <attempt>",
        );
      }
      const result = await store.bootstrap(
        operands[0],
        parsePositiveIntegerArgument(operands[1], "run ID"),
        parsePositiveIntegerArgument(operands[2], "run attempt"),
      );
      writeMachineOutput(stdout, {
        state: "initialized",
        branchHeadSha: result.branchHeadSha,
        bootstrap: result.bootstrap,
      });
      return;
    }
    default:
      throw new JournalStoreError(
        `Unknown cloudflare-journal-store command: ${command ?? ""}`,
      );
  }
}

function safeErrorMessage(error, token) {
  const message = error instanceof Error ? error.message : "Unknown error";
  if (typeof token !== "string" || token.length === 0) {
    return message;
  }
  return message.replaceAll(token, "[REDACTED]");
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${safeErrorMessage(error, process.env.GH_TOKEN)}\n`);
    process.exitCode = 1;
  });
}
