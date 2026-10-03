#!/usr/bin/env bash

set -euo pipefail

if [[ "$#" -ne 5 ]]; then
  echo "Usage: cloudflare-reconcile.sh {verify-promoted|restore} <project-path> <journal-path> <claimant-workflow-id> <claimant-head-sha>" >&2
  exit 2
fi

action="$1"
project_path="$2"
journal_path="$3"
claimant_workflow_id="$4"
claimant_head_sha="$5"
case "$action" in
  verify-promoted|restore) ;;
  *)
    echo "Unknown Cloudflare reconciliation action: $action" >&2
    exit 2
    ;;
esac

require_canonical_integer() {
  local value="$1"
  local name="$2"
  if [[ ! "$value" =~ ^[1-9][0-9]*$ ]]; then
    echo "$name must be a canonical positive integer" >&2
    exit 2
  fi
}

require_git_sha() {
  local value="$1"
  local name="$2"
  if [[ ! "$value" =~ ^[0-9a-f]{40}$ ]]; then
    echo "$name must be a lowercase 40-character Git SHA" >&2
    exit 2
  fi
}

require_canonical_integer "${GITHUB_RUN_ID:-}" "GITHUB_RUN_ID"
require_canonical_integer "${GITHUB_RUN_ATTEMPT:-}" "GITHUB_RUN_ATTEMPT"
require_canonical_integer "$claimant_workflow_id" "claimant workflow ID"
require_git_sha "$claimant_head_sha" "claimant head SHA"
if [[ -z "${JOURNAL_GH_TOKEN:-}" ]]; then
  echo "JOURNAL_GH_TOKEN is required" >&2
  exit 2
fi
if [[ ! "${CLOUDFLARE_JOURNAL_HMAC_KEY:-}" =~ ^[0-9a-f]{64}$ ]]; then
  echo "CLOUDFLARE_JOURNAL_HMAC_KEY must be exactly 64 lowercase hexadecimal characters" >&2
  exit 2
fi
require_git_sha "${CLOUDFLARE_JOURNAL_TRUSTED_SHA:-}" "CLOUDFLARE_JOURNAL_TRUSTED_SHA"
journal_hmac_key="$CLOUDFLARE_JOURNAL_HMAC_KEY"
journal_trusted_sha="$CLOUDFLARE_JOURNAL_TRUSTED_SHA"
unset CLOUDFLARE_JOURNAL_HMAC_KEY CLOUDFLARE_JOURNAL_TRUSTED_SHA

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
store="$script_dir/cloudflare-journal-store.mjs"
live="$script_dir/cloudflare-deployment-live.sh"
work_directory="$(mktemp -d "${RUNNER_TEMP:-/tmp}/cloudflare-reconcile.XXXXXX")"
cleanup() {
  local exit_status="$?"
  trap - EXIT
  set +e
  rm -rf -- "$work_directory"
  local cleanup_status="$?"
  if [[ "$exit_status" -ne 0 ]]; then
    exit "$exit_status"
  fi
  exit "$cleanup_status"
}
trap cleanup EXIT

run_store() {
  env \
    -u CLOUDFLARE_ACCOUNT_ID \
    -u CLOUDFLARE_API_TOKEN \
    -u JOURNAL_GH_TOKEN \
    CLOUDFLARE_JOURNAL_HMAC_KEY="$journal_hmac_key" \
    CLOUDFLARE_JOURNAL_TRUSTED_SHA="$journal_trusted_sha" \
    GH_TOKEN="$JOURNAL_GH_TOKEN" \
    node "$store" "$@"
}

state_journal="$work_directory/state-journal.json"
state_result="$work_directory/state-result.json"
run_store state "$state_journal" > "$state_result"
if [[ "$(jq -er '.state' "$state_result")" != "latest" ]]; then
  echo "Cloudflare reconciliation requires the latest durable journal" >&2
  exit 1
fi
if ! cmp -s -- "$journal_path" "$state_journal"; then
  echo "The durable deployment journal changed before reconciliation" >&2
  exit 1
fi

target_run_id="$(jq -er '.runId' "$state_result")"
target_run_attempt="$(jq -er '.runAttempt' "$state_result")"
expected_branch_head="$(jq -er '.branchHeadSha' "$state_result")"
takeover='null'
reconciliation_status="$(jq -er '.reconciliation.status // "none"' "$state_result")"
case "$reconciliation_status" in
  none|completed) ;;
  claimed)
    prior_run_id="$(jq -er '.reconciliation.claimantRunId' "$state_result")"
    prior_run_attempt="$(jq -er '.reconciliation.claimantRunAttempt' "$state_result")"
    if [[ "$prior_run_id" == "$GITHUB_RUN_ID" && "$prior_run_attempt" == "$GITHUB_RUN_ATTEMPT" ]]; then
      prior_action="$(jq -er '.reconciliation.action' "$state_result")"
      if [[ "$prior_action" == "$action" ]]; then
        takeover="$(jq -c '.reconciliation.takeover' "$state_result")"
      fi
    else
      prior_run="$work_directory/prior-run.json"
      env \
        -u CLOUDFLARE_ACCOUNT_ID \
        -u CLOUDFLARE_API_TOKEN \
        -u JOURNAL_GH_TOKEN \
        gh api "/repos/$GITHUB_REPOSITORY/actions/runs/$prior_run_id/attempts/$prior_run_attempt" > "$prior_run"
      prior_conclusion="$(jq -er '.conclusion | select(type == "string")' "$prior_run")"
      takeover="$(
        jq -cn \
          --argjson claimantRunId "$prior_run_id" \
          --argjson claimantRunAttempt "$prior_run_attempt" \
          --arg conclusion "$prior_conclusion" \
          '{claimantRunId: $claimantRunId, claimantRunAttempt: $claimantRunAttempt, conclusion: $conclusion}'
      )"
    fi
    ;;
  *)
    echo "Unexpected durable reconciliation status: $reconciliation_status" >&2
    exit 1
    ;;
esac

claim_file="$work_directory/claim.json"
claim_result="$work_directory/claim-result.json"
jq -cn \
  --argjson targetRunId "$target_run_id" \
  --argjson targetRunAttempt "$target_run_attempt" \
  --argjson claimantRunId "$GITHUB_RUN_ID" \
  --argjson claimantRunAttempt "$GITHUB_RUN_ATTEMPT" \
  --argjson claimantWorkflowId "$claimant_workflow_id" \
  --arg claimantHeadSha "$claimant_head_sha" \
  --arg action "$action" \
  --argjson takeover "$takeover" \
  '{schemaVersion: 1, targetRunId: $targetRunId, targetRunAttempt: $targetRunAttempt, claimantRunId: $claimantRunId, claimantRunAttempt: $claimantRunAttempt, claimantWorkflowId: $claimantWorkflowId, claimantHeadSha: $claimantHeadSha, action: $action, takeover: $takeover}' \
  > "$claim_file"
run_store claim "$claim_file" "$expected_branch_head" > "$claim_result"
claim_branch_head="$(jq -er '.branchHeadSha' "$claim_result")"

observed_result="$work_directory/observed-result.json"
case "$action" in
  verify-promoted)
    env -u GH_TOKEN -u JOURNAL_GH_TOKEN \
      bash "$live" verify "$project_path" "$journal_path" promoted "$observed_result"
    ;;
  restore)
    CLOUDFLARE_JOURNAL_HMAC_KEY="$journal_hmac_key" \
      CLOUDFLARE_JOURNAL_TRUSTED_SHA="$journal_trusted_sha" \
      bash "$live" restore "$project_path" "$journal_path" "$claim_file" "$claim_branch_head" "$observed_result"
    ;;
esac

completion_file="$work_directory/completion.json"
completion_result="$work_directory/completion-result.json"
jq -cn \
  --argjson claimantRunId "$GITHUB_RUN_ID" \
  --argjson claimantRunAttempt "$GITHUB_RUN_ATTEMPT" \
  --slurpfile result "$observed_result" \
  '{schemaVersion: 1, claimantRunId: $claimantRunId, claimantRunAttempt: $claimantRunAttempt, result: $result[0]}' \
  > "$completion_file"
run_store complete "$completion_file" "$claim_branch_head" > "$completion_result"
cat "$completion_result"
