#!/usr/bin/env bash

set -euo pipefail

journal_hmac_key="${CLOUDFLARE_JOURNAL_HMAC_KEY:-}"
journal_trusted_sha="${CLOUDFLARE_JOURNAL_TRUSTED_SHA:-}"
unset CLOUDFLARE_JOURNAL_HMAC_KEY CLOUDFLARE_JOURNAL_TRUSTED_SHA

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cli="$script_dir/cloudflare-deployment-cli.mjs"
store="$script_dir/cloudflare-journal-store.mjs"
wrangler_command="$script_dir/run-wrangler-command.sh"
work_directory="$(mktemp -d "${RUNNER_TEMP:-/tmp}/cloudflare-live.XXXXXX")"
trap 'rm -rf -- "$work_directory"' EXIT

require_arguments() {
  local expected="$1"
  shift
  if [[ "$#" -ne "$expected" ]]; then
    echo "Invalid cloudflare-deployment-live arguments" >&2
    exit 2
  fi
}

capture_snapshot() {
  local project_path="$1"
  local config_path="$2"
  local output_path="$3"
  local state_directory="$work_directory/state"
  mkdir -p -- "$state_directory"

  run_wrangler pnpm --dir "$project_path" exec wrangler \
    deployments status --json --config "$config_path" \
    > "$state_directory/status.json"
  run_wrangler pnpm --dir "$project_path" exec wrangler \
    deployments list --json --config "$config_path" \
    > "$state_directory/history.json"
  node "$cli" snapshot \
    "$state_directory/status.json" \
    "$state_directory/history.json" \
    > "$output_path"
}

run_wrangler() {
  env -u GH_TOKEN -u JOURNAL_GH_TOKEN bash "$wrangler_command" "$@"
}

evaluate_current() {
  local project_path="$1"
  local journal_path="$2"
  local output_path="$3"
  local snapshot_path traffic_config
  snapshot_path="$(mktemp "$work_directory/snapshot.XXXXXX")"
  traffic_config="$(mktemp "$work_directory/traffic-config.XXXXXX")"
  create_traffic_config "$journal_path" "$traffic_config"
  capture_snapshot "$project_path" "$traffic_config" "$snapshot_path"
  node "$cli" evaluate "$snapshot_path" "$journal_path" > "$output_path"
}

command_arguments_json() {
  jq -cn --args '$ARGS.positional' -- "$@"
}

create_traffic_config() {
  local journal_path="$1"
  local output_path="$2"
  jq -e '{name: .workerName, observability: null, tail_consumers: null, streaming_tail_consumers: null}' \
    "$journal_path" > "$output_path"
  local expected_digest actual_digest
  expected_digest="$(jq -er '.uploadConfigDigest' "$journal_path")"
  actual_digest="$(sha256sum "$output_path" | cut -d ' ' -f 1)"
  if [[ "$actual_digest" != "$expected_digest" ]]; then
    echo "Traffic-only Wrangler config does not match the journaled digest" >&2
    return 1
  fi
}

parse_deployment_output() {
  local output_path="$1"
  local expectation_path="$2"
  local parsed_path="$3"
  node "$cli" wrangler "$output_path" "$expectation_path" > "$parsed_path"
}

transition() {
  local transition_name="$1"
  local project_path="$2"
  local journal_path="$3"
  local before_path after_path output_path expectation_path parsed_path
  before_path="$(mktemp "$work_directory/before.XXXXXX")"
  after_path="$(mktemp "$work_directory/after.XXXXXX")"
  output_path="$(mktemp "$work_directory/output.XXXXXX")"
  expectation_path="$(mktemp "$work_directory/expectation.XXXXXX")"
  parsed_path="$(mktemp "$work_directory/parsed.XXXXXX")"
  local traffic_config="$work_directory/traffic-config.json"
  create_traffic_config "$journal_path" "$traffic_config"

  local previous_version candidate_version worker_tag message expected_before expected_after
  previous_version="$(jq -er '.previousVersionId' "$journal_path")"
  candidate_version="$(jq -er '.candidateVersionId' "$journal_path")"
  worker_tag="$(jq -er '.workerTag' "$journal_path")"

  local -a arguments
  case "$transition_name" in
    candidate)
      expected_before="unchanged"
      expected_after="candidate"
      message="$(jq -er '.messages.candidate' "$journal_path")"
      arguments=(
        versions deploy
        "$previous_version@100"
        "$candidate_version@0"
        --message "$message"
        --yes
        --config "$traffic_config"
      )
      ;;
    promoted)
      expected_before="candidate"
      expected_after="promoted"
      message="$(jq -er '.messages.promoted' "$journal_path")"
      arguments=(
        versions deploy
        "$candidate_version@100"
        --message "$message"
        --yes
        --config "$traffic_config"
      )
      ;;
    *)
      echo "Unknown Cloudflare transition: $transition_name" >&2
      return 2
      ;;
  esac

  evaluate_current "$project_path" "$journal_path" "$before_path"
  if [[ "$(jq -er '.state' "$before_path")" != "$expected_before" ]]; then
    echo "Cloudflare state changed before the $transition_name transition" >&2
    jq -c '{state, decision}' "$before_path" >&2
    return 1
  fi

  rm -f -- "$output_path"
  set +e
  WRANGLER_OUTPUT_FILE_PATH="$output_path" \
    run_wrangler pnpm --dir "$project_path" exec wrangler \
      "${arguments[@]}"
  local command_status="$?"
  set -e

  evaluate_current "$project_path" "$journal_path" "$after_path"
  if [[ "$command_status" -ne 0 ]]; then
    echo "Wrangler failed during the $transition_name transition with status $command_status" >&2
    jq -c '{state, decision}' "$after_path" >&2
    return 1
  fi
  if [[ "$(jq -er '.state' "$after_path")" != "$expected_after" ]]; then
    echo "Cloudflare did not enter the expected $expected_after state" >&2
    jq -c '{state, decision}' "$after_path" >&2
    return 1
  fi

  local command_line_args
  command_line_args="$(command_arguments_json "${arguments[@]}")"
  jq -cn \
    --arg type "version-deploy" \
    --arg workerTag "$worker_tag" \
    --argjson commandLineArgs "$command_line_args" \
    '{type: $type, workerTag: $workerTag, commandLineArgs: $commandLineArgs}' \
    > "$expectation_path"
  parse_deployment_output "$output_path" "$expectation_path" "$parsed_path"
  if [[ "$(jq -er '.deploymentId' "$parsed_path")" != "$(jq -er ".model.${transition_name}.deploymentId" "$after_path")" ]]; then
    echo "Wrangler output does not identify the committed $transition_name deployment" >&2
    return 1
  fi
}

restore() {
  local project_path="$1"
  local journal_path="$2"
  local claim_path="$3"
  local expected_branch_head="$4"
  local result_path="$5"
  local before_path confirmation_path after_path output_path expectation_path parsed_path
  before_path="$(mktemp "$work_directory/before.XXXXXX")"
  confirmation_path="$(mktemp "$work_directory/confirmation.XXXXXX")"
  after_path="$(mktemp "$work_directory/after.XXXXXX")"
  output_path="$(mktemp "$work_directory/output.XXXXXX")"
  expectation_path="$(mktemp "$work_directory/expectation.XXXXXX")"
  parsed_path="$(mktemp "$work_directory/parsed.XXXXXX")"
  local traffic_config="$work_directory/traffic-config.json"
  create_traffic_config "$journal_path" "$traffic_config"

  evaluate_current "$project_path" "$journal_path" "$before_path"
  local decision
  decision="$(jq -er '.decision' "$before_path")"
  case "$decision" in
    unchanged|restored)
      jq -ec '{state, decision}' "$before_path" > "$result_path"
      return 0
      ;;
    external)
      echo "Cloudflare state is not owned by this deployment run; refusing restoration" >&2
      jq -c '{state, decision}' "$before_path" >&2
      return 1
      ;;
    restore)
      ;;
    *)
      echo "Unexpected restoration decision: $decision" >&2
      return 1
      ;;
  esac

  evaluate_current "$project_path" "$journal_path" "$confirmation_path"
  if [[ "$(jq -er '.decision' "$confirmation_path")" != "restore" ]]; then
    echo "Cloudflare state changed before restoration; refusing mutation" >&2
    jq -c '{state, decision}' "$confirmation_path" >&2
    return 1
  fi

  local previous_version worker_tag message
  previous_version="$(jq -er '.previousVersionId' "$journal_path")"
  worker_tag="$(jq -er '.workerTag' "$journal_path")"
  message="$(jq -er '.messages.restored' "$journal_path")"
  local -a arguments=(
    versions deploy
    "$previous_version@100"
    --message "$message"
    --yes
    --config "$traffic_config"
  )

  rm -f -- "$output_path"
  if [[ ! "$journal_hmac_key" =~ ^[0-9a-f]{64}$ ]] || \
     [[ ! "$journal_trusted_sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Journal anchor credentials are required for restoration" >&2
    return 2
  fi
  env \
    -u CLOUDFLARE_ACCOUNT_ID \
    -u CLOUDFLARE_API_TOKEN \
    -u JOURNAL_GH_TOKEN \
    CLOUDFLARE_JOURNAL_HMAC_KEY="$journal_hmac_key" \
    CLOUDFLARE_JOURNAL_TRUSTED_SHA="$journal_trusted_sha" \
    GH_TOKEN="${JOURNAL_GH_TOKEN:?JOURNAL_GH_TOKEN is required}" \
    node "$store" authorize "$claim_path" "$expected_branch_head" > /dev/null
  set +e
  WRANGLER_OUTPUT_FILE_PATH="$output_path" \
    run_wrangler pnpm --dir "$project_path" exec wrangler \
      "${arguments[@]}"
  local command_status="$?"
  set -e

  evaluate_current "$project_path" "$journal_path" "$after_path"
  if [[ "$(jq -er '.state' "$after_path")" != "restored" ]]; then
    echo "Cloudflare restoration did not commit the journal-owned previous version" >&2
    jq -c '{state, decision}' "$after_path" >&2
    return 1
  fi
  jq -ec '{state, decision}' "$after_path" > "$result_path"

  if [[ "$command_status" -ne 0 ]]; then
    echo "Wrangler returned status $command_status, but Cloudflare confirms restoration" >&2
    return 0
  fi

  local command_line_args
  command_line_args="$(command_arguments_json "${arguments[@]}")"
  jq -cn \
    --arg type "version-deploy" \
    --arg workerTag "$worker_tag" \
    --argjson commandLineArgs "$command_line_args" \
    '{type: $type, workerTag: $workerTag, commandLineArgs: $commandLineArgs}' \
    > "$expectation_path"
  parse_deployment_output "$output_path" "$expectation_path" "$parsed_path"
  if [[ "$(jq -er '.deploymentId' "$parsed_path")" != "$(jq -er '.model.restored.deploymentId' "$after_path")" ]]; then
    echo "Wrangler output does not identify the committed restoration" >&2
    return 1
  fi
}

command="${1:-}"
shift || true
case "$command" in
  snapshot)
    require_arguments 3 "$@"
    capture_snapshot "$1" "$2" "$3"
    ;;
  transition)
    require_arguments 3 "$@"
    transition "$1" "$2" "$3"
    ;;
  verify)
    require_arguments 4 "$@"
    evaluation_path="$(mktemp "$work_directory/evaluation.XXXXXX")"
    evaluate_current "$1" "$2" "$evaluation_path"
    if [[ "$(jq -er '.state' "$evaluation_path")" != "$3" ]]; then
      jq -c '{state, decision}' "$evaluation_path" >&2
      exit 1
    fi
    jq -ec '{state, decision}' "$evaluation_path" > "$4"
    ;;
  restore)
    require_arguments 5 "$@"
    restore "$1" "$2" "$3" "$4" "$5"
    ;;
  *)
    echo "Usage: cloudflare-deployment-live.sh {snapshot|transition|verify|restore} ..." >&2
    exit 2
    ;;
esac
