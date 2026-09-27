import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

const PREVIOUS_VERSION = "11111111-1111-4111-8111-111111111111";
const CANDIDATE_VERSION = "22222222-2222-4222-8222-222222222222";
const ORIGINAL_DEPLOYMENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CANDIDATE_DEPLOYMENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WORKER_TAG = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const TIMESTAMP = "2026-09-26T12:34:56.789Z";
const CANDIDATE_MESSAGE = "candidate 0123456789abcdef";

function rawDeployment(id, message, versions) {
  return {
    annotations: message === null ? {} : { "workers/message": message },
    author_email: "deploy@example.invalid",
    created_on: TIMESTAMP,
    id,
    source: "wrangler",
    strategy: "percentage",
    versions: versions.map(([version_id, percentage]) => ({
      percentage,
      version_id,
    })),
  };
}

describe("cloudflare-deployment-live", () => {
  it("targets the journal-bound production Worker in a live transition", () => {
    const directory = mkdtempSync(join(tmpdir(), "cloudflare-live-test-"));
    try {
      const binDirectory = join(directory, "bin");
      const projectDirectory = join(directory, "project");
      const statePath = join(directory, "candidate-committed");
      const capturedConfigPath = join(directory, "traffic-config.json");
      mkdirSync(binDirectory);
      mkdirSync(projectDirectory);

      const original = rawDeployment(ORIGINAL_DEPLOYMENT, null, [
        [PREVIOUS_VERSION, 100],
      ]);
      const candidate = rawDeployment(CANDIDATE_DEPLOYMENT, CANDIDATE_MESSAGE, [
        [CANDIDATE_VERSION, 0],
        [PREVIOUS_VERSION, 100],
      ]);
      const originalPath = join(directory, "original.json");
      const candidatePath = join(directory, "candidate.json");
      const historyPath = join(directory, "history.json");
      const candidateHistoryPath = join(directory, "candidate-history.json");
      writeFileSync(originalPath, JSON.stringify(original));
      writeFileSync(candidatePath, JSON.stringify(candidate));
      writeFileSync(historyPath, JSON.stringify([original]));
      writeFileSync(
        candidateHistoryPath,
        JSON.stringify([original, candidate]),
      );

      const journalPath = join(directory, "journal.json");
      const trafficConfig = `{
  "name": "sentry-mcp",
  "observability": null,
  "tail_consumers": null,
  "streaming_tail_consumers": null
}\n`;
      writeFileSync(
        journalPath,
        JSON.stringify({
          artifactDigest: "0".repeat(64),
          uploadConfigDigest: createHash("sha256")
            .update(trafficConfig)
            .digest("hex"),
          candidateVersionId: CANDIDATE_VERSION,
          headSha: "0".repeat(40),
          messages: {
            candidate: CANDIDATE_MESSAGE,
            promoted: "promoted 0123456789abcdef",
            restored: "restored 0123456789abcdef",
          },
          originalDeploymentId: ORIGINAL_DEPLOYMENT,
          previousVersionId: PREVIOUS_VERSION,
          runAttempt: 1,
          runId: 1,
          schemaVersion: 1,
          workerName: "sentry-mcp",
          workerTag: WORKER_TAG,
        }),
      );

      const pnpmPath = join(binDirectory, "pnpm");
      writeFileSync(
        pnpmPath,
        `#!/usr/bin/env bash
set -euo pipefail
shift 2
[[ "$1" == "exec" && "$2" == "wrangler" ]]
shift 2
if [[ "$1" == "deployments" && "$2" == "status" ]]; then
  if [[ -e "$STATE_PATH" ]]; then cat "$CANDIDATE_PATH"; else cat "$ORIGINAL_PATH"; fi
  exit 0
fi
if [[ "$1" == "deployments" && "$2" == "list" ]]; then
  if [[ -e "$STATE_PATH" ]]; then cat "$CANDIDATE_HISTORY_PATH"; else cat "$HISTORY_PATH"; fi
  exit 0
fi
[[ "$1" == "versions" && "$2" == "deploy" ]]
config_path=""
for ((index = 1; index <= $#; index += 1)); do
  if [[ "\${!index}" == "--config" ]]; then
    next=$((index + 1))
    config_path="\${!next}"
  fi
done
jq -e '
  keys == ["name", "observability", "streaming_tail_consumers", "tail_consumers"] and
  .name == "sentry-mcp" and
  .observability == null and
  .streaming_tail_consumers == null and
  .tail_consumers == null
' "$config_path" > /dev/null
cp -- "$config_path" "$CAPTURED_CONFIG_PATH"
arguments="$(jq -cn --args '$ARGS.positional' -- "$@")"
jq -cn \
  --argjson commandLineArgs "$arguments" \
  --arg timestamp "$TIMESTAMP" \
  '{type: "wrangler-session", version: 1, wrangler_version: "4.80.0", command_line_args: $commandLineArgs, log_file_path: "/tmp/wrangler.log", timestamp: $timestamp}' \
  > "$WRANGLER_OUTPUT_FILE_PATH"
jq -cn \
  --arg deploymentId "$CANDIDATE_DEPLOYMENT" \
  --arg timestamp "$TIMESTAMP" \
  --arg workerTag "$WORKER_TAG" \
  '{type: "version-deploy", version: 1, worker_name: "sentry-mcp", worker_tag: $workerTag, deployment_id: $deploymentId, version_traffic: {}, timestamp: $timestamp}' \
  >> "$WRANGLER_OUTPUT_FILE_PATH"
touch "$STATE_PATH"
`,
      );
      chmodSync(pnpmPath, 0o755);

      const result = spawnSync(
        "bash",
        [
          "scripts/cloudflare-deployment-live.sh",
          "transition",
          "candidate",
          projectDirectory,
          journalPath,
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            CANDIDATE_DEPLOYMENT,
            CANDIDATE_HISTORY_PATH: candidateHistoryPath,
            CANDIDATE_PATH: candidatePath,
            CAPTURED_CONFIG_PATH: capturedConfigPath,
            HISTORY_PATH: historyPath,
            ORIGINAL_PATH: originalPath,
            PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
            RUNNER_TEMP: directory,
            STATE_PATH: statePath,
            TIMESTAMP,
            WORKER_TAG,
          },
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(readFileSync(capturedConfigPath, "utf8")), {
        name: "sentry-mcp",
        observability: null,
        streaming_tail_consumers: null,
        tail_consumers: null,
      });
      execFileSync("test", ["-e", statePath]);

      const observedResultPath = join(directory, "observed-result.json");
      const verification = spawnSync(
        "bash",
        [
          "scripts/cloudflare-deployment-live.sh",
          "verify",
          projectDirectory,
          journalPath,
          "candidate",
          observedResultPath,
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            CANDIDATE_HISTORY_PATH: candidateHistoryPath,
            CANDIDATE_PATH: candidatePath,
            HISTORY_PATH: historyPath,
            ORIGINAL_PATH: originalPath,
            PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
            RUNNER_TEMP: directory,
            STATE_PATH: statePath,
          },
        },
      );
      assert.equal(verification.status, 0, verification.stderr);
      assert.deepEqual(JSON.parse(readFileSync(observedResultPath, "utf8")), {
        state: "candidate",
        decision: "restore",
      });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("claims reconciliation before reading live state and completes it", () => {
    const directory = mkdtempSync(join(tmpdir(), "cloudflare-reconcile-test-"));
    try {
      const binDirectory = join(directory, "bin");
      const projectDirectory = join(directory, "project");
      mkdirSync(binDirectory);
      mkdirSync(projectDirectory);

      const original = rawDeployment(ORIGINAL_DEPLOYMENT, null, [
        [PREVIOUS_VERSION, 100],
      ]);
      const statusPath = join(directory, "status.json");
      const historyPath = join(directory, "history.json");
      writeFileSync(statusPath, JSON.stringify(original));
      writeFileSync(historyPath, JSON.stringify([original]));

      const trafficConfig = `{
  "name": "sentry-mcp",
  "observability": null,
  "tail_consumers": null,
  "streaming_tail_consumers": null
}\n`;
      const journal = {
        artifactDigest: "0".repeat(64),
        uploadConfigDigest: createHash("sha256")
          .update(trafficConfig)
          .digest("hex"),
        candidateVersionId: CANDIDATE_VERSION,
        headSha: "0".repeat(40),
        messages: {
          candidate: CANDIDATE_MESSAGE,
          promoted: "promoted 0123456789abcdef",
          restored: "restored 0123456789abcdef",
        },
        originalDeploymentId: ORIGINAL_DEPLOYMENT,
        previousVersionId: PREVIOUS_VERSION,
        runAttempt: 2,
        runId: 12345,
        schemaVersion: 1,
        workerName: "sentry-mcp",
        workerTag: WORKER_TAG,
      };
      const journalPath = join(directory, "journal.json");
      writeFileSync(journalPath, `${JSON.stringify(journal)}\n`);

      const claimMarker = join(directory, "claimed");
      const liveMarker = join(directory, "live-read");
      const completionMarker = join(directory, "completed");
      const fakeNodePath = join(binDirectory, "node");
      writeFileSync(
        fakeNodePath,
        `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" != */cloudflare-journal-store.mjs ]]; then
  exec "$REAL_NODE" "$@"
fi
shift
command="$1"
shift
case "$command" in
  state)
    cp -- "$TEST_JOURNAL" "$1"
    printf '%s\n' '{"state":"latest","branchHeadSha":"${"a".repeat(40)}","runId":12345,"runAttempt":2,"headSha":"${"0".repeat(40)}"}'
    ;;
  claim)
    [[ "$2" == "${"a".repeat(40)}" ]]
    jq -e '
      .targetRunId == 12345 and
      .targetRunAttempt == 2 and
      .claimantRunId == 200 and
      .claimantRunAttempt == 1 and
      .claimantWorkflowId == 300 and
      .claimantHeadSha == "${"e".repeat(40)}" and
      .action == "restore" and
      .takeover == null
    ' "$1" > /dev/null
    touch "$CLAIM_MARKER"
    printf '%s\n' '{"state":"claimed","branchHeadSha":"${"b".repeat(40)}"}'
    ;;
  complete)
    [[ "$2" == "${"b".repeat(40)}" ]]
    [[ -e "$CLAIM_MARKER" && -e "$LIVE_MARKER" ]]
    jq -e '
      .claimantRunId == 200 and
      .claimantRunAttempt == 1 and
      .result == {"state":"unchanged","decision":"unchanged"}
    ' "$1" > /dev/null
    touch "$COMPLETION_MARKER"
    printf '%s\n' '{"state":"completed","branchHeadSha":"${"c".repeat(40)}","result":{"state":"unchanged","decision":"unchanged"}}'
    ;;
  *) exit 2 ;;
esac
`,
      );
      chmodSync(fakeNodePath, 0o755);

      const fakePnpmPath = join(binDirectory, "pnpm");
      writeFileSync(
        fakePnpmPath,
        `#!/usr/bin/env bash
set -euo pipefail
[[ -e "$CLAIM_MARKER" ]]
touch "$LIVE_MARKER"
shift 2
[[ "$1" == "exec" && "$2" == "wrangler" ]]
shift 2
if [[ "$1" == "deployments" && "$2" == "status" ]]; then
  cat "$STATUS_PATH"
elif [[ "$1" == "deployments" && "$2" == "list" ]]; then
  cat "$HISTORY_PATH"
else
  exit 2
fi
`,
      );
      chmodSync(fakePnpmPath, 0o755);

      const result = spawnSync(
        "bash",
        [
          "scripts/cloudflare-reconcile.sh",
          "restore",
          projectDirectory,
          journalPath,
          "300",
          "e".repeat(40),
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            CLAIM_MARKER: claimMarker,
            COMPLETION_MARKER: completionMarker,
            GITHUB_REPOSITORY: "acme/widgets",
            GITHUB_RUN_ATTEMPT: "1",
            GITHUB_RUN_ID: "200",
            HISTORY_PATH: historyPath,
            LIVE_MARKER: liveMarker,
            PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
            REAL_NODE: process.execPath,
            RUNNER_TEMP: directory,
            STATUS_PATH: statusPath,
            TEST_JOURNAL: journalPath,
          },
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).branchHeadSha, "c".repeat(40));
      execFileSync("test", ["-e", completionMarker]);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
