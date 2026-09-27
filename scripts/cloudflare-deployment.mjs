const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const SHA_256 = /^[0-9a-f]{64}$/;
const WORKER_NAME = "sentry-mcp";

/**
 * @typedef {object} VersionTraffic
 * @property {string} versionId
 * @property {number} percentage
 */

/**
 * @typedef {object} Deployment
 * @property {string} id
 * @property {string | null} message
 * @property {string} strategy
 * @property {readonly VersionTraffic[]} versions
 */

/**
 * @typedef {object} DeploymentSnapshot
 * @property {Deployment} current
 * @property {readonly Deployment[]} history Oldest to newest, as returned by Wrangler.
 */

/**
 * @typedef {object} OwnedDeployment
 * @property {string} deploymentId
 * @property {string} message
 * @property {string} predecessorDeploymentId
 */

/**
 * @typedef {object} DeploymentModel
 * @property {string} originalDeploymentId
 * @property {string} previousVersionId
 * @property {string} candidateVersionId
 * @property {OwnedDeployment} [candidate]
 * @property {OwnedDeployment} [promoted]
 * @property {OwnedDeployment} [restored]
 */

/** @typedef {"candidate" | "promoted" | "restored" | "unchanged" | "external"} DeploymentState */
/** @typedef {"restore" | "restored" | "unchanged" | "external"} RestorationDecision */

/**
 * @typedef {object} DeploymentJournal
 * @property {1} schemaVersion
 * @property {number} runId
 * @property {number} runAttempt
 * @property {string} headSha
 * @property {string} artifactDigest
 * @property {string} uploadConfigDigest
 * @property {"sentry-mcp"} workerName
 * @property {string} workerTag
 * @property {string} originalDeploymentId
 * @property {string} previousVersionId
 * @property {string} candidateVersionId
 * @property {{candidate: string, promoted: string, restored: string}} messages
 */

/**
 * @typedef {object} WranglerOutputExpectation
 * @property {"version-upload" | "version-deploy"} type
 * @property {readonly string[]} commandLineArgs
 * @property {string | null} workerTag Null only while capturing the first upload's Worker tag.
 */

/**
 * @typedef {object} WranglerUploadOutput
 * @property {"version-upload"} type
 * @property {string} workerName
 * @property {string} workerTag
 * @property {string} versionId
 */

/**
 * @typedef {object} WranglerDeployOutput
 * @property {"version-deploy"} type
 * @property {string} workerName
 * @property {string} workerTag
 * @property {string} deploymentId
 */

/** @typedef {WranglerUploadOutput | WranglerDeployOutput} WranglerOutput */

/**
 * Parse a canonical lowercase UUID.
 *
 * @param {unknown} value
 * @param {string} [name]
 * @returns {string}
 */
export function parseUuid(value, name = "value") {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new Error(`${name} must be a canonical lowercase UUID`);
  }
  return value;
}

/**
 * Parse a full lowercase Git commit SHA.
 *
 * @param {unknown} value
 * @param {string} [name]
 * @returns {string}
 */
export function parseGitSha(value, name = "value") {
  if (typeof value !== "string" || !GIT_SHA.test(value)) {
    throw new Error(`${name} must be a lowercase 40-character Git SHA`);
  }
  return value;
}

/**
 * Parse a lowercase SHA-256 digest.
 *
 * @param {unknown} value
 * @param {string} [name]
 * @returns {string}
 */
export function parseSha256(value, name = "value") {
  if (typeof value !== "string" || !SHA_256.test(value)) {
    throw new Error(`${name} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireObject(value, name) {
  if (!isObject(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value;
}

function requireExactKeys(value, required, optional, name) {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`${name} contains unexpected field '${key}'`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      throw new Error(`${name} is missing field '${key}'`);
    }
  }
}

function requireString(value, name, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    throw new Error(
      `${name} must be ${allowEmpty ? "a string" : "a non-empty string"}`,
    );
  }
  return value;
}

function requireWorkerTag(value, name) {
  const workerTag = requireString(value, name);
  const hasControlCharacter = [...workerTag].some((character) => {
    const codeUnit = character.charCodeAt(0);
    return codeUnit <= 0x1f || codeUnit === 0x7f;
  });
  if (workerTag.length > 256 || hasControlCharacter) {
    throw new Error(`${name} must be a safe Worker tag`);
  }
  return workerTag;
}

function requireWorkerName(value, name) {
  if (value !== WORKER_NAME) {
    throw new Error(`${name} must equal '${WORKER_NAME}'`);
  }
  return value;
}

function requireTimestamp(value, name) {
  const timestamp = requireString(value, name);
  if (
    Number.isNaN(Date.parse(timestamp)) ||
    new Date(timestamp).toISOString() !== timestamp
  ) {
    throw new Error(`${name} must be an ISO 8601 timestamp`);
  }
  return timestamp;
}

function requireSafeMessage(value, name) {
  const message = requireString(value, name);
  const hasControlCharacter = [...message].some((character) => {
    const codeUnit = character.charCodeAt(0);
    return codeUnit <= 0x1f || codeUnit === 0x7f;
  });
  if (message.length > 512 || hasControlCharacter) {
    throw new Error(`${name} must be a safe deployment message`);
  }
  return message;
}

function requireNullableString(value, name) {
  if (value !== null && typeof value !== "string") {
    throw new Error(`${name} must be a string or null`);
  }
  return value;
}

function parseJson(text, name) {
  if (typeof text !== "string" || text.length === 0) {
    throw new Error(`${name} must be non-empty JSON`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${name} is malformed JSON`, { cause: error });
  }
}

function parseTraffic(value, name) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 2) {
    throw new Error(`${name} must contain one or two versions`);
  }

  const versions = value.map((rawTraffic, index) => {
    const traffic = requireObject(rawTraffic, `${name}[${index}]`);
    const versionId = parseUuid(
      traffic.version_id,
      `${name}[${index}].version_id`,
    );
    if (
      typeof traffic.percentage !== "number" ||
      !Number.isFinite(traffic.percentage) ||
      traffic.percentage < 0 ||
      traffic.percentage > 100
    ) {
      throw new Error(`${name}[${index}].percentage must be between 0 and 100`);
    }
    return { versionId, percentage: traffic.percentage };
  });

  if (
    new Set(versions.map(({ versionId }) => versionId)).size !== versions.length
  ) {
    throw new Error(`${name} must contain unique version IDs`);
  }
  if (
    versions.reduce((total, { percentage }) => total + percentage, 0) !== 100
  ) {
    throw new Error(`${name} percentages must total 100`);
  }

  return versions.sort((left, right) =>
    left.versionId.localeCompare(right.versionId),
  );
}

function parseDeployment(value, name) {
  const deployment = requireObject(value, name);
  const annotations = deployment.annotations;
  if (
    annotations !== undefined &&
    annotations !== null &&
    !isObject(annotations)
  ) {
    throw new Error(`${name}.annotations must be an object or null`);
  }
  const message = annotations?.["workers/message"] ?? null;
  requireNullableString(message, `${name}.annotations['workers/message']`);

  return {
    id: parseUuid(deployment.id, `${name}.id`),
    message,
    strategy: requireString(deployment.strategy, `${name}.strategy`),
    versions: parseTraffic(deployment.versions, `${name}.versions`),
  };
}

function normalizeDeployment(value, name) {
  const deployment = requireObject(value, name);
  requireExactKeys(
    deployment,
    ["id", "message", "strategy", "versions"],
    [],
    name,
  );
  requireNullableString(deployment.message, `${name}.message`);
  if (!Array.isArray(deployment.versions)) {
    throw new Error(`${name}.versions must be an array`);
  }
  const versions = deployment.versions.map((rawTraffic, index) => {
    const traffic = requireObject(rawTraffic, `${name}.versions[${index}]`);
    requireExactKeys(
      traffic,
      ["versionId", "percentage"],
      [],
      `${name}.versions[${index}]`,
    );
    return {
      version_id: traffic.versionId,
      percentage: traffic.percentage,
    };
  });
  return {
    id: parseUuid(deployment.id, `${name}.id`),
    message: deployment.message,
    strategy: requireString(deployment.strategy, `${name}.strategy`),
    versions: parseTraffic(versions, `${name}.versions`),
  };
}

/**
 * Parse `wrangler deployments status --json` output.
 *
 * @param {string} json
 * @returns {Deployment}
 */
export function parseDeploymentStatus(json) {
  return parseDeployment(
    parseJson(json, "deployment status"),
    "deployment status",
  );
}

/**
 * Parse `wrangler deployments list --json` output in chronological order.
 *
 * @param {string} json
 * @returns {readonly Deployment[]}
 */
export function parseDeploymentList(json) {
  const value = parseJson(json, "deployment list");
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("deployment list must be a non-empty array");
  }
  const deployments = value.map((deployment, index) =>
    parseDeployment(deployment, `deployment list[${index}]`),
  );
  if (new Set(deployments.map(({ id }) => id)).size !== deployments.length) {
    throw new Error("deployment list must contain unique deployment IDs");
  }
  return deployments;
}

function parseJsonLine(line, index) {
  try {
    return requireObject(JSON.parse(line), `Wrangler output line ${index + 1}`);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Wrangler output line ${index + 1} is malformed JSON`, {
        cause: error,
      });
    }
    throw error;
  }
}

function validateCommandLineArgs(actual, expected) {
  if (
    !Array.isArray(expected) ||
    expected.length === 0 ||
    expected.some(
      (argument) => typeof argument !== "string" || argument.length === 0,
    )
  ) {
    throw new Error("expected commandLineArgs must be non-empty strings");
  }
  if (
    !Array.isArray(actual) ||
    actual.length !== expected.length ||
    actual.some((argument, index) => argument !== expected[index])
  ) {
    throw new Error(
      "Wrangler command arguments do not exactly match the expected command",
    );
  }
}

function validateSession(record, expectedArgs) {
  requireExactKeys(
    record,
    [
      "type",
      "version",
      "wrangler_version",
      "command_line_args",
      "log_file_path",
      "timestamp",
    ],
    [],
    "Wrangler session record",
  );
  if (record.type !== "wrangler-session" || record.version !== 1) {
    throw new Error(
      "Wrangler output must start with a version 1 session record",
    );
  }
  requireString(record.wrangler_version, "Wrangler session version");
  requireNullableString(record.log_file_path, "Wrangler session log path");
  requireTimestamp(record.timestamp, "Wrangler session timestamp");
  validateCommandLineArgs(record.command_line_args, expectedArgs);
}

function validateCommonSuccess(record, expected, optionalKeys) {
  requireExactKeys(
    record,
    ["type", "version", "worker_name", "worker_tag", "timestamp"],
    optionalKeys,
    "Wrangler success record",
  );
  if (record.type !== expected.type || record.version !== 1) {
    throw new Error(
      `Wrangler output must end with one ${expected.type} version 1 record`,
    );
  }
  if (record.worker_name !== WORKER_NAME) {
    throw new Error(`Wrangler output worker_name must be '${WORKER_NAME}'`);
  }
  const workerTag = requireWorkerTag(record.worker_tag, "Wrangler worker_tag");
  if (
    expected.workerTag !== null &&
    workerTag !== requireWorkerTag(expected.workerTag, "expected workerTag")
  ) {
    throw new Error("Wrangler worker_tag changed");
  }
  requireTimestamp(record.timestamp, "Wrangler success timestamp");
  return workerTag;
}

function validateOptionalUploadFields(record) {
  for (const key of ["preview_url", "preview_alias_url"]) {
    if (Object.hasOwn(record, key)) {
      requireNullableString(record[key], `Wrangler ${key}`);
    }
  }
  if (Object.hasOwn(record, "wrangler_environment")) {
    requireString(record.wrangler_environment, "Wrangler environment");
  }
}

function validateVersionTraffic(value) {
  const traffic = requireObject(value, "Wrangler version_traffic");
  const entries = Object.entries(traffic);
  for (const [versionId, percentage] of entries) {
    parseUuid(versionId, "Wrangler version_traffic version ID");
    if (
      typeof percentage !== "number" ||
      !Number.isFinite(percentage) ||
      percentage < 0 ||
      percentage > 100
    ) {
      throw new Error(
        "Wrangler version_traffic percentages must be between 0 and 100",
      );
    }
  }
  if (
    entries.length > 0 &&
    entries.reduce((total, [, percentage]) => total + percentage, 0) !== 100
  ) {
    throw new Error("Wrangler version_traffic percentages must total 100");
  }
}

/**
 * Parse the complete output file from one Wrangler command.
 *
 * Wrangler 4.80 serializes `version_traffic`, a Map, as an empty object. The
 * exact command arguments and subsequently observed deployment state therefore
 * remain the authoritative traffic checks.
 *
 * @param {string} jsonl
 * @param {WranglerOutputExpectation} expected
 * @returns {WranglerOutput}
 */
export function parseWranglerJsonl(jsonl, expected) {
  if (typeof jsonl !== "string" || jsonl.length === 0) {
    throw new Error("Wrangler output must be non-empty JSONL");
  }
  const expectation = requireObject(expected, "Wrangler output expectation");
  requireExactKeys(
    expectation,
    ["type", "commandLineArgs", "workerTag"],
    [],
    "Wrangler output expectation",
  );
  if (
    expectation.type !== "version-upload" &&
    expectation.type !== "version-deploy"
  ) {
    throw new Error("Wrangler output expectation type is invalid");
  }
  const withoutFinalNewline = jsonl.endsWith("\n") ? jsonl.slice(0, -1) : jsonl;
  const lines = withoutFinalNewline.split("\n");
  if (lines.length !== 2 || lines.some((line) => line.length === 0)) {
    throw new Error("Wrangler output must contain exactly two JSONL records");
  }
  const records = lines.map(parseJsonLine);
  validateSession(records[0], expectation.commandLineArgs);

  const success = records[1];
  if (success.type === "command-failed") {
    throw new Error("Wrangler reported command-failed instead of success");
  }

  if (expectation.type === "version-upload") {
    const workerTag = validateCommonSuccess(success, expectation, [
      "version_id",
      "preview_url",
      "preview_alias_url",
      "wrangler_environment",
      "worker_name_overridden",
    ]);
    if (!Object.hasOwn(success, "version_id")) {
      throw new Error("Wrangler success record is missing field 'version_id'");
    }
    if (success.worker_name_overridden !== false) {
      throw new Error("Wrangler must not override the production Worker name");
    }
    validateOptionalUploadFields(success);
    return {
      type: "version-upload",
      workerName: WORKER_NAME,
      workerTag,
      versionId: parseUuid(success.version_id, "Wrangler version_id"),
    };
  }

  if (expectation.type === "version-deploy") {
    const workerTag = validateCommonSuccess(success, expectation, [
      "deployment_id",
      "version_traffic",
    ]);
    if (!Object.hasOwn(success, "deployment_id")) {
      throw new Error(
        "Wrangler success record is missing field 'deployment_id'",
      );
    }
    if (!Object.hasOwn(success, "version_traffic")) {
      throw new Error(
        "Wrangler success record is missing field 'version_traffic'",
      );
    }
    validateVersionTraffic(success.version_traffic);
    return {
      type: "version-deploy",
      workerName: WORKER_NAME,
      workerTag,
      deploymentId: parseUuid(success.deployment_id, "Wrangler deployment_id"),
    };
  }

  throw new Error(`Unexpected Wrangler success type: ${expectation.type}`);
}

function requirePositiveSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

/**
 * Parse and validate the durable, non-secret deployment recovery journal.
 *
 * @param {unknown} value
 * @returns {DeploymentJournal}
 */
export function parseDeploymentJournal(value) {
  const journal = requireObject(value, "deployment journal");
  requireExactKeys(
    journal,
    [
      "artifactDigest",
      "candidateVersionId",
      "headSha",
      "messages",
      "originalDeploymentId",
      "previousVersionId",
      "runAttempt",
      "runId",
      "schemaVersion",
      "uploadConfigDigest",
      "workerName",
      "workerTag",
    ],
    [],
    "deployment journal",
  );
  const messages = requireObject(
    journal.messages,
    "deployment journal messages",
  );
  requireExactKeys(
    messages,
    ["candidate", "promoted", "restored"],
    [],
    "deployment journal messages",
  );
  if (journal.schemaVersion !== 1) {
    throw new Error("Deployment journal schema version is unsupported");
  }

  return {
    schemaVersion: 1,
    runId: requirePositiveSafeInteger(
      journal.runId,
      "deployment journal runId",
    ),
    runAttempt: requirePositiveSafeInteger(
      journal.runAttempt,
      "deployment journal runAttempt",
    ),
    headSha: parseGitSha(journal.headSha),
    artifactDigest: parseSha256(journal.artifactDigest),
    uploadConfigDigest: parseSha256(journal.uploadConfigDigest),
    workerName: requireWorkerName(
      journal.workerName,
      "deployment journal workerName",
    ),
    workerTag: requireWorkerTag(
      journal.workerTag,
      "deployment journal workerTag",
    ),
    originalDeploymentId: parseUuid(
      journal.originalDeploymentId,
      "deployment journal originalDeploymentId",
    ),
    previousVersionId: parseUuid(
      journal.previousVersionId,
      "deployment journal previousVersionId",
    ),
    candidateVersionId: parseUuid(
      journal.candidateVersionId,
      "deployment journal candidateVersionId",
    ),
    messages: {
      candidate: requireSafeMessage(
        messages.candidate,
        "deployment journal candidate message",
      ),
      promoted: requireSafeMessage(
        messages.promoted,
        "deployment journal promoted message",
      ),
      restored: requireSafeMessage(
        messages.restored,
        "deployment journal restored message",
      ),
    },
  };
}

function normalizeSnapshot(snapshot) {
  const value = requireObject(snapshot, "deployment snapshot");
  requireExactKeys(value, ["current", "history"], [], "deployment snapshot");
  if (!Array.isArray(value.history) || value.history.length === 0) {
    throw new Error("deployment snapshot history must be a non-empty array");
  }
  const current = normalizeDeployment(
    value.current,
    "deployment snapshot current",
  );
  const history = value.history.map((deployment, index) =>
    normalizeDeployment(deployment, `deployment snapshot history[${index}]`),
  );
  if (new Set(history.map(({ id }) => id)).size !== history.length) {
    throw new Error(
      "deployment snapshot history must contain unique deployment IDs",
    );
  }
  return { current, history };
}

function normalizeOwnedDeployment(value, name) {
  const deployment = requireObject(value, name);
  requireExactKeys(
    deployment,
    ["deploymentId", "message", "predecessorDeploymentId"],
    [],
    name,
  );
  return {
    deploymentId: parseUuid(deployment.deploymentId, `${name}.deploymentId`),
    message: requireString(deployment.message, `${name}.message`),
    predecessorDeploymentId: parseUuid(
      deployment.predecessorDeploymentId,
      `${name}.predecessorDeploymentId`,
    ),
  };
}

function normalizeModel(model) {
  const value = requireObject(model, "deployment model");
  requireExactKeys(
    value,
    ["originalDeploymentId", "previousVersionId", "candidateVersionId"],
    ["candidate", "promoted", "restored"],
    "deployment model",
  );
  const normalized = {
    originalDeploymentId: parseUuid(
      value.originalDeploymentId,
      "deployment model originalDeploymentId",
    ),
    previousVersionId: parseUuid(
      value.previousVersionId,
      "deployment model previousVersionId",
    ),
    candidateVersionId: parseUuid(
      value.candidateVersionId,
      "deployment model candidateVersionId",
    ),
    candidate:
      value.candidate === undefined
        ? undefined
        : normalizeOwnedDeployment(
            value.candidate,
            "deployment model candidate",
          ),
    promoted:
      value.promoted === undefined
        ? undefined
        : normalizeOwnedDeployment(value.promoted, "deployment model promoted"),
    restored:
      value.restored === undefined
        ? undefined
        : normalizeOwnedDeployment(value.restored, "deployment model restored"),
  };

  if (normalized.previousVersionId === normalized.candidateVersionId) {
    throw new Error("previous and candidate version IDs must differ");
  }
  if (
    normalized.candidate &&
    normalized.candidate.predecessorDeploymentId !==
      normalized.originalDeploymentId
  ) {
    throw new Error("candidate predecessor must be the original deployment");
  }
  if (
    normalized.promoted &&
    (!normalized.candidate ||
      normalized.promoted.predecessorDeploymentId !==
        normalized.candidate.deploymentId)
  ) {
    throw new Error("promoted predecessor must be the candidate deployment");
  }
  if (normalized.restored) {
    const ownedPredecessors = [
      normalized.candidate?.deploymentId,
      normalized.promoted?.deploymentId,
    ].filter(Boolean);
    if (
      !ownedPredecessors.includes(normalized.restored.predecessorDeploymentId)
    ) {
      throw new Error("restored predecessor must be an owned deployment");
    }
  }
  const deploymentIds = [
    normalized.originalDeploymentId,
    normalized.candidate?.deploymentId,
    normalized.promoted?.deploymentId,
    normalized.restored?.deploymentId,
  ].filter(Boolean);
  if (new Set(deploymentIds).size !== deploymentIds.length) {
    throw new Error("deployment model IDs must be unique");
  }
  return normalized;
}

function trafficEquals(actual, expected) {
  return (
    actual.length === expected.length &&
    actual.every(
      (traffic, index) =>
        traffic.versionId === expected[index].versionId &&
        traffic.percentage === expected[index].percentage,
    )
  );
}

function deploymentEquals(left, right) {
  return (
    left.id === right.id &&
    left.message === right.message &&
    left.strategy === right.strategy &&
    trafficEquals(left.versions, right.versions)
  );
}

function expectedTraffic(entries) {
  return entries.sort((left, right) =>
    left.versionId.localeCompare(right.versionId),
  );
}

function matchesJournalTransition(deployment, message, versions) {
  return (
    deployment !== undefined &&
    deployment.message === message &&
    deployment.strategy === "percentage" &&
    trafficEquals(deployment.versions, expectedTraffic(versions))
  );
}

function journalOwnedDeployment(deployment, predecessor) {
  return {
    deploymentId: deployment.id,
    message: deployment.message,
    predecessorDeploymentId: predecessor.id,
  };
}

/**
 * Reconstruct run-owned transitions from their exact predecessor chain and
 * unique journal messages. Any inserted deployment breaks ownership.
 *
 * @param {DeploymentSnapshot} snapshot
 * @param {DeploymentJournal} journal
 * @returns {DeploymentModel}
 */
export function hydrateDeploymentModel(snapshot, journal) {
  const state = normalizeSnapshot(snapshot);
  const expected = parseDeploymentJournal(journal);
  const originalIndex = state.history.findIndex(
    ({ id }) => id === expected.originalDeploymentId,
  );
  if (originalIndex < 0) {
    throw new Error("Original deployment is absent from Cloudflare history");
  }
  const original = state.history[originalIndex];
  if (
    original.strategy !== "percentage" ||
    !trafficEquals(
      original.versions,
      expectedTraffic([
        { versionId: expected.previousVersionId, percentage: 100 },
      ]),
    )
  ) {
    throw new Error("Original deployment no longer matches the journal");
  }

  const candidateSource = state.history[originalIndex + 1];
  const candidate = matchesJournalTransition(
    candidateSource,
    expected.messages.candidate,
    [
      { versionId: expected.previousVersionId, percentage: 100 },
      { versionId: expected.candidateVersionId, percentage: 0 },
    ],
  )
    ? journalOwnedDeployment(candidateSource, original)
    : undefined;
  const promotedSource = candidate
    ? state.history[originalIndex + 2]
    : undefined;
  const promoted = matchesJournalTransition(
    promotedSource,
    expected.messages.promoted,
    [{ versionId: expected.candidateVersionId, percentage: 100 }],
  )
    ? journalOwnedDeployment(promotedSource, candidateSource)
    : undefined;
  const restoredSource = candidate
    ? state.history[originalIndex + (promoted ? 3 : 2)]
    : undefined;
  const restoredPredecessor = promoted ? promotedSource : candidateSource;
  const restored = matchesJournalTransition(
    restoredSource,
    expected.messages.restored,
    [{ versionId: expected.previousVersionId, percentage: 100 }],
  )
    ? journalOwnedDeployment(restoredSource, restoredPredecessor)
    : undefined;

  return normalizeModel({
    originalDeploymentId: expected.originalDeploymentId,
    previousVersionId: expected.previousVersionId,
    candidateVersionId: expected.candidateVersionId,
    ...(candidate ? { candidate } : {}),
    ...(promoted ? { promoted } : {}),
    ...(restored ? { restored } : {}),
  });
}

function matchesOwnedDeployment(snapshot, owned, versions) {
  if (!owned || snapshot.history.length < 2) {
    return false;
  }
  const latest = snapshot.history.at(-1);
  const predecessor = snapshot.history.at(-2);
  return (
    deploymentEquals(snapshot.current, latest) &&
    latest.id === owned.deploymentId &&
    latest.message === owned.message &&
    latest.strategy === "percentage" &&
    trafficEquals(latest.versions, expectedTraffic(versions)) &&
    predecessor.id === owned.predecessorDeploymentId
  );
}

/**
 * Test for the exact owned P@100,C@0 candidate deployment.
 *
 * @param {DeploymentSnapshot} snapshot
 * @param {DeploymentModel} model
 * @returns {boolean}
 */
export function isOwnedCandidateAtZero(snapshot, model) {
  const state = normalizeSnapshot(snapshot);
  const expected = normalizeModel(model);
  return matchesOwnedDeployment(state, expected.candidate, [
    { versionId: expected.previousVersionId, percentage: 100 },
    { versionId: expected.candidateVersionId, percentage: 0 },
  ]);
}

/**
 * Test for the exact owned C@100 promoted deployment.
 *
 * @param {DeploymentSnapshot} snapshot
 * @param {DeploymentModel} model
 * @returns {boolean}
 */
export function isOwnedPromoted(snapshot, model) {
  const state = normalizeSnapshot(snapshot);
  const expected = normalizeModel(model);
  return matchesOwnedDeployment(state, expected.promoted, [
    { versionId: expected.candidateVersionId, percentage: 100 },
  ]);
}

/**
 * Test for the exact owned P@100 restoration deployment.
 *
 * @param {DeploymentSnapshot} snapshot
 * @param {DeploymentModel} model
 * @returns {boolean}
 */
export function isRestoredPrevious(snapshot, model) {
  const state = normalizeSnapshot(snapshot);
  const expected = normalizeModel(model);
  return matchesOwnedDeployment(state, expected.restored, [
    { versionId: expected.previousVersionId, percentage: 100 },
  ]);
}

/**
 * Test whether production remains at the original D0/P@100 deployment.
 *
 * @param {DeploymentSnapshot} snapshot
 * @param {DeploymentModel} model
 * @returns {boolean}
 */
export function isUnchangedOriginal(snapshot, model) {
  const state = normalizeSnapshot(snapshot);
  const expected = normalizeModel(model);
  const latest = state.history.at(-1);
  return (
    deploymentEquals(state.current, latest) &&
    latest.id === expected.originalDeploymentId &&
    latest.strategy === "percentage" &&
    trafficEquals(
      latest.versions,
      expectedTraffic([
        { versionId: expected.previousVersionId, percentage: 100 },
      ]),
    )
  );
}

/**
 * Classify production against the exact deployment model. Any valid but
 * unowned state is external interference.
 *
 * @param {DeploymentSnapshot} snapshot
 * @param {DeploymentModel} model
 * @returns {DeploymentState}
 */
export function classifyDeploymentState(snapshot, model) {
  if (isOwnedCandidateAtZero(snapshot, model)) {
    return "candidate";
  }
  if (isOwnedPromoted(snapshot, model)) {
    return "promoted";
  }
  if (isRestoredPrevious(snapshot, model)) {
    return "restored";
  }
  if (isUnchangedOriginal(snapshot, model)) {
    return "unchanged";
  }
  return "external";
}

/**
 * Decide whether restoration is safe. The helper only returns `restore` for an
 * exact owned candidate or promotion and never for external state.
 *
 * @param {DeploymentSnapshot} snapshot
 * @param {DeploymentModel} model
 * @returns {RestorationDecision}
 */
export function decideRestoration(snapshot, model) {
  const state = classifyDeploymentState(snapshot, model);
  switch (state) {
    case "candidate":
    case "promoted":
      return "restore";
    case "restored":
      return "restored";
    case "unchanged":
      return "unchanged";
    case "external":
      return "external";
    default:
      throw new Error(`Unexpected deployment state: ${state}`);
  }
}

/**
 * Hydrate and evaluate the durable journal against current Cloudflare state.
 *
 * @param {DeploymentSnapshot} snapshot
 * @param {DeploymentJournal} journal
 * @returns {{state: DeploymentState, decision: RestorationDecision, model: DeploymentModel}}
 */
export function evaluateDeployment(snapshot, journal) {
  const model = hydrateDeploymentModel(snapshot, journal);
  return {
    state: classifyDeploymentState(snapshot, model),
    decision: decideRestoration(snapshot, model),
    model,
  };
}
