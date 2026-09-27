#!/usr/bin/env bash

set -euo pipefail

if [[ "$#" -eq 0 ]]; then
  echo "Usage: run-wrangler-command.sh <command> [argument ...]" >&2
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
wrangler_pid=""
wrangler_pgid=""
wrangler_starting=false
wrangler_launch_in_progress=false
wrangler_state_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/wrangler-command.XXXXXX")"
wrangler_pgid_file="$wrangler_state_dir/pgid"
WRANGLER_PGID_FILE="$wrangler_pgid_file"
export WRANGLER_PGID_FILE

source "$script_dir/wrangler-cleanup.sh"
trap cleanup_wrangler EXIT
trap 'force_wrangler_cleanup 129' HUP
trap 'force_wrangler_cleanup 130' INT
trap 'force_wrangler_cleanup 143' TERM

wrangler_starting=true
wrangler_launch_in_progress=true
setsid bash -c '
  set -euo pipefail
  trap "" HUP INT TERM
  umask 077
  temporary_identity="${WRANGLER_PGID_FILE}.$$"
  printf "%s\n" "$$" > "$temporary_identity"
  mv "$temporary_identity" "$WRANGLER_PGID_FILE"
  trap - HUP INT TERM
  exec "$@"
' bash "$@" &
wrangler_pid=$!
wrangler_launch_in_progress=false
if [[ -n "${wrangler_signal_status:-}" ]]; then
  force_wrangler_cleanup "$wrangler_signal_status"
fi

for _attempt in {1..100}; do
  if [[ -s "$wrangler_pgid_file" ]]; then
    break
  fi
  if ! kill -0 "$wrangler_pid" 2>/dev/null; then
    break
  fi
  sleep 0.01
done
if [[ ! -s "$wrangler_pgid_file" ]]; then
  set +e
  wait "$wrangler_pid"
  command_status=$?
  set -e
  if (( command_status == 0 )); then
    echo "Wrangler command exited before publishing its process-group identity" >&2
    command_status=1
  fi
  cleanup_wrangler "$command_status"
fi

wrangler_pgid="$(<"$wrangler_pgid_file")"
if [[ "$wrangler_pgid" != "$wrangler_pid" ]]; then
  echo "Wrangler process-group identity does not match its launcher PID" >&2
  exit 1
fi
wrangler_starting=false

set +e
wait "$wrangler_pid"
command_status=$?
set -e
cleanup_wrangler "$command_status"
