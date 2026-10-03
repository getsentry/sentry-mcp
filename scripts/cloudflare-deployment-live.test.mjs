import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
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
const PROMOTED_DEPLOYMENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const WORKER_TAG = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const TIMESTAMP = "2026-09-26T12:34:56.789Z";
const CANDIDATE_MESSAGE = "candidate 0123456789abcdef";
const JOURNAL_HMAC_KEY = "12".repeat(32);
const JOURNAL_TRUSTED_SHA = "a".repeat(40);

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

  it("reuses the same claimant without a terminal-run lookup before reading live state", () => {
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
      const ghMarker = join(directory, "gh-called");
      const fakeNodePath = join(binDirectory, "node");
      writeFileSync(
        fakeNodePath,
        `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" != */cloudflare-journal-store.mjs ]]; then
  exec "$REAL_NODE" "$@"
fi
[[ -z "\${CLOUDFLARE_ACCOUNT_ID+x}" ]] || { echo "store inherited account ID" >&2; exit 9; }
[[ -z "\${CLOUDFLARE_API_TOKEN+x}" ]] || { echo "store inherited API token" >&2; exit 10; }
[[ "$GH_TOKEN" == "$EXPECTED_JOURNAL_TOKEN" ]]
[[ -z "\${JOURNAL_GH_TOKEN+x}" ]] || { echo "store inherited journal alias" >&2; exit 11; }
[[ "$CLOUDFLARE_JOURNAL_HMAC_KEY" == "$EXPECTED_JOURNAL_HMAC_KEY" ]]
[[ "$CLOUDFLARE_JOURNAL_TRUSTED_SHA" == "$EXPECTED_JOURNAL_TRUSTED_SHA" ]]
shift
command="$1"
shift
case "$command" in
  state)
    cp -- "$TEST_JOURNAL" "$1"
    printf '%s\n' '{"state":"latest","branchHeadSha":"${"a".repeat(40)}","runId":12345,"runAttempt":2,"headSha":"${"0".repeat(40)}","reconciliation":{"status":"claimed","targetRunId":12345,"targetRunAttempt":2,"claimantRunId":200,"claimantRunAttempt":1,"claimantWorkflowId":300,"claimantHeadSha":"${"e".repeat(40)}","action":"restore","takeover":{"claimantRunId":199,"claimantRunAttempt":1,"conclusion":"failure"}}}'
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
      .takeover == {"claimantRunId":199,"claimantRunAttempt":1,"conclusion":"failure"}
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

      const fakeGhPath = join(binDirectory, "gh");
      writeFileSync(
        fakeGhPath,
        `#!/usr/bin/env bash
[[ -z "\${CLOUDFLARE_ACCOUNT_ID+x}" ]] || { echo "gh inherited account ID" >&2; exit 14; }
[[ -z "\${CLOUDFLARE_API_TOKEN+x}" ]] || { echo "gh inherited API token" >&2; exit 15; }
[[ -z "\${JOURNAL_GH_TOKEN+x}" ]] || { echo "gh inherited journal token" >&2; exit 16; }
[[ -z "\${CLOUDFLARE_JOURNAL_HMAC_KEY+x}" ]] || { echo "gh inherited journal HMAC key" >&2; exit 22; }
[[ "$GH_TOKEN" == "$EXPECTED_ACTIONS_TOKEN" ]]
touch "$GH_MARKER"
exit 1
`,
      );
      chmodSync(fakeGhPath, 0o755);

      const fakePnpmPath = join(binDirectory, "pnpm");
      writeFileSync(
        fakePnpmPath,
        `#!/usr/bin/env bash
set -euo pipefail
[[ -z "\${GH_TOKEN+x}" ]] || { echo "wrangler inherited GitHub token" >&2; exit 12; }
[[ -z "\${JOURNAL_GH_TOKEN+x}" ]] || { echo "wrangler inherited journal token" >&2; exit 13; }
[[ -z "\${CLOUDFLARE_JOURNAL_HMAC_KEY+x}" ]] || { echo "wrangler inherited journal HMAC key" >&2; exit 23; }
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
            CLOUDFLARE_ACCOUNT_ID: "cloudflare-account",
            CLOUDFLARE_API_TOKEN: "cloudflare-token",
            CLOUDFLARE_JOURNAL_HMAC_KEY: JOURNAL_HMAC_KEY,
            CLOUDFLARE_JOURNAL_TRUSTED_SHA: JOURNAL_TRUSTED_SHA,
            EXPECTED_ACTIONS_TOKEN: "actions-token",
            EXPECTED_JOURNAL_TOKEN: "journal-token",
            EXPECTED_JOURNAL_HMAC_KEY: JOURNAL_HMAC_KEY,
            EXPECTED_JOURNAL_TRUSTED_SHA: JOURNAL_TRUSTED_SHA,
            GH_TOKEN: "actions-token",
            CLAIM_MARKER: claimMarker,
            COMPLETION_MARKER: completionMarker,
            GITHUB_REPOSITORY: "acme/widgets",
            GITHUB_RUN_ATTEMPT: "1",
            GITHUB_RUN_ID: "200",
            GH_MARKER: ghMarker,
            HISTORY_PATH: historyPath,
            JOURNAL_GH_TOKEN: "journal-token",
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
      assert.equal(existsSync(ghMarker), false);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("refuses restoration without mutating after the final authorization fails", () => {
    const directory = mkdtempSync(join(tmpdir(), "cloudflare-authorize-test-"));
    try {
      const binDirectory = join(directory, "bin");
      const projectDirectory = join(directory, "project");
      const mutationMarker = join(directory, "mutation");
      const readMarker = join(directory, "reads");
      mkdirSync(binDirectory);
      mkdirSync(projectDirectory);

      const promotedMessage = "promoted 0123456789abcdef";
      const original = rawDeployment(ORIGINAL_DEPLOYMENT, null, [
        [PREVIOUS_VERSION, 100],
      ]);
      const candidate = rawDeployment(CANDIDATE_DEPLOYMENT, CANDIDATE_MESSAGE, [
        [CANDIDATE_VERSION, 0],
        [PREVIOUS_VERSION, 100],
      ]);
      const promoted = rawDeployment(PROMOTED_DEPLOYMENT, promotedMessage, [
        [CANDIDATE_VERSION, 100],
      ]);
      const statusPath = join(directory, "status.json");
      const historyPath = join(directory, "history.json");
      writeFileSync(statusPath, JSON.stringify(promoted));
      writeFileSync(
        historyPath,
        JSON.stringify([original, candidate, promoted]),
      );

      const trafficConfig = `{
  "name": "sentry-mcp",
  "observability": null,
  "tail_consumers": null,
  "streaming_tail_consumers": null
}\n`;
      const journalPath = join(directory, "journal.json");
      writeFileSync(
        journalPath,
        `${JSON.stringify({
          artifactDigest: "0".repeat(64),
          uploadConfigDigest: createHash("sha256")
            .update(trafficConfig)
            .digest("hex"),
          candidateVersionId: CANDIDATE_VERSION,
          headSha: "0".repeat(40),
          messages: {
            candidate: CANDIDATE_MESSAGE,
            promoted: promotedMessage,
            restored: "restored 0123456789abcdef",
          },
          originalDeploymentId: ORIGINAL_DEPLOYMENT,
          previousVersionId: PREVIOUS_VERSION,
          runAttempt: 2,
          runId: 12345,
          schemaVersion: 1,
          workerName: "sentry-mcp",
          workerTag: WORKER_TAG,
        })}\n`,
      );
      const claimPath = join(directory, "claim.json");
      const resultPath = join(directory, "result.json");
      writeFileSync(claimPath, "{}\n");

      const fakeNodePath = join(binDirectory, "node");
      writeFileSync(
        fakeNodePath,
        `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == */cloudflare-journal-store.mjs && "$2" == "authorize" ]]; then
  [[ -z "\${CLOUDFLARE_ACCOUNT_ID+x}" ]] || { echo "authorize inherited account ID" >&2; exit 17; }
  [[ -z "\${CLOUDFLARE_API_TOKEN+x}" ]] || { echo "authorize inherited API token" >&2; exit 18; }
  [[ "$GH_TOKEN" == "$EXPECTED_JOURNAL_TOKEN" ]]
  [[ -z "\${JOURNAL_GH_TOKEN+x}" ]] || { echo "authorize inherited journal alias" >&2; exit 19; }
  [[ "$CLOUDFLARE_JOURNAL_HMAC_KEY" == "$EXPECTED_JOURNAL_HMAC_KEY" ]]
  [[ "$CLOUDFLARE_JOURNAL_TRUSTED_SHA" == "$EXPECTED_JOURNAL_TRUSTED_SHA" ]]
  echo "authorization denied" >&2
  exit 1
fi
exec "$REAL_NODE" "$@"
`,
      );
      chmodSync(fakeNodePath, 0o755);

      const fakePnpmPath = join(binDirectory, "pnpm");
      writeFileSync(
        fakePnpmPath,
        `#!/usr/bin/env bash
set -euo pipefail
[[ -z "\${GH_TOKEN+x}" ]] || { echo "wrangler inherited GitHub token" >&2; exit 20; }
[[ -z "\${JOURNAL_GH_TOKEN+x}" ]] || { echo "wrangler inherited journal token" >&2; exit 21; }
[[ -z "\${CLOUDFLARE_JOURNAL_HMAC_KEY+x}" ]] || { echo "wrangler inherited journal HMAC key" >&2; exit 22; }
shift 2
[[ "$1" == "exec" && "$2" == "wrangler" ]]
shift 2
if [[ "$1" == "deployments" && "$2" == "status" ]]; then
  printf x >> "$READ_MARKER"
  cat "$STATUS_PATH"
  exit 0
fi
if [[ "$1" == "deployments" && "$2" == "list" ]]; then
  printf x >> "$READ_MARKER"
  cat "$HISTORY_PATH"
  exit 0
fi
if [[ "$1" == "versions" && "$2" == "deploy" ]]; then
  touch "$MUTATION_MARKER"
  exit 0
fi
exit 2
`,
      );
      chmodSync(fakePnpmPath, 0o755);

      const result = spawnSync(
        "bash",
        [
          "scripts/cloudflare-deployment-live.sh",
          "restore",
          projectDirectory,
          journalPath,
          claimPath,
          "a".repeat(40),
          resultPath,
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            CLOUDFLARE_ACCOUNT_ID: "cloudflare-account",
            CLOUDFLARE_API_TOKEN: "cloudflare-token",
            CLOUDFLARE_JOURNAL_HMAC_KEY: JOURNAL_HMAC_KEY,
            CLOUDFLARE_JOURNAL_TRUSTED_SHA: JOURNAL_TRUSTED_SHA,
            EXPECTED_JOURNAL_HMAC_KEY: JOURNAL_HMAC_KEY,
            EXPECTED_JOURNAL_TOKEN: "journal-token",
            EXPECTED_JOURNAL_TRUSTED_SHA: JOURNAL_TRUSTED_SHA,
            HISTORY_PATH: historyPath,
            JOURNAL_GH_TOKEN: "journal-token",
            MUTATION_MARKER: mutationMarker,
            PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
            READ_MARKER: readMarker,
            REAL_NODE: process.execPath,
            RUNNER_TEMP: directory,
            STATUS_PATH: statusPath,
          },
        },
      );
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /authorization denied/);
      assert.equal(readFileSync(readMarker, "utf8"), "xxxx");
      assert.equal(existsSync(mutationMarker), false);
      assert.equal(existsSync(resultPath), false);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
