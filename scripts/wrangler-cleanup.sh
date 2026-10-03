#!/usr/bin/env bash

load_wrangler_identity() {
  local attempt candidate

  for attempt in {1..100}; do
    if [[ -z "${wrangler_pgid:-}" && -n "${wrangler_pgid_file:-}" && -s "$wrangler_pgid_file" ]]; then
      candidate="$(<"$wrangler_pgid_file")"
      if [[ "$candidate" =~ ^[1-9][0-9]*$ ]] && ((candidate > 1)); then
        wrangler_pgid="$candidate"
      else
        echo "Invalid Wrangler process-group identity" >&2
        return 1
      fi
    fi
    if [[ -n "${wrangler_pgid:-}" ]]; then
      return 0
    fi
    if [[ "${wrangler_starting:-false}" != true ]]; then
      break
    fi
    sleep 0.01
  done

  if [[ -n "${wrangler_pid:-}" && "$wrangler_pid" =~ ^[1-9][0-9]*$ ]] && ((wrangler_pid > 1)); then
    wrangler_pgid="$wrangler_pid"
    return 0
  fi
  return 1
}

wrangler_is_alive() {
  load_wrangler_identity || return 1
  local pgid="${wrangler_pgid:-}"
  local leader_pid="${wrangler_pid:-}"
  if [[ -n "$pgid" ]] && kill -0 -- "-$pgid" 2>/dev/null; then
    return 0
  fi
  [[ -n "$leader_pid" ]] && kill -0 "$leader_pid" 2>/dev/null
}

kill_wrangler_immediately() {
  load_wrangler_identity || return 0
  local pgid="${wrangler_pgid:-}"
  local leader_pid="${wrangler_pid:-}"
  if [[ -n "$pgid" ]] && kill -KILL -- "-$pgid" 2>/dev/null; then
    return
  fi
  if [[ -n "$leader_pid" ]]; then
    kill -KILL "$leader_pid" 2>/dev/null || true
  fi
}

force_wrangler_cleanup() {
  local signal_status="$1"
  case "$signal_status" in
    129 | 130 | 143) ;;
    *) return 2 ;;
  esac

  if [[ -z "${wrangler_signal_status:-}" ]]; then
    wrangler_signal_status="$signal_status"
  fi
  if [[ "${wrangler_launch_in_progress:-false}" == true ]]; then
    return 0
  fi
  local start_cleanup=false
  if [[ "${wrangler_signal_cleanup_started:-false}" != true ]]; then
    wrangler_signal_cleanup_started=true
    start_cleanup=true
  fi
  kill_wrangler_immediately
  if [[ "$start_cleanup" == true ]]; then
    cleanup_wrangler "$wrangler_signal_status"
  fi
}

cleanup_wrangler() {
  local command_status=$?
  if (( $# > 0 )); then
    command_status="$1"
  fi
  local cleanup_status=0
  load_wrangler_identity || true
  wrangler_starting=false
  local leader_pid="${wrangler_pid:-}"
  local pgid="${wrangler_pgid:-}"
  local process_state=""

  trap - EXIT
  if [[ -n "$pgid" ]]; then
    kill -TERM -- "-$pgid" 2>/dev/null ||
      kill -TERM "$leader_pid" 2>/dev/null || true
  elif [[ -n "$leader_pid" ]]; then
    kill -TERM "$leader_pid" 2>/dev/null || true
  fi

  if [[ -n "$pgid" || -n "$leader_pid" ]]; then
    for _attempt in {1..100}; do
      if [[ -n "$leader_pid" ]]; then
        process_state="$(ps -o stat= -p "$leader_pid" 2>/dev/null || true)"
        if [[ -z "$process_state" || "$process_state" == Z* ]]; then
          break
        fi
      elif ! wrangler_is_alive; then
        break
      fi
      sleep 0.1
    done
    if wrangler_is_alive; then
      kill_wrangler_immediately
    fi
  fi

  if [[ -n "$leader_pid" ]]; then
    wait "$leader_pid" 2>/dev/null || true
  fi

  if wrangler_is_alive; then
    kill_wrangler_immediately
    for _attempt in {1..20}; do
      if ! wrangler_is_alive; then
        break
      fi
      sleep 0.1
    done
    if wrangler_is_alive; then
      echo "Wrangler process survived cleanup" >&2
      cleanup_status=1
    fi
  fi

  if [[ -f "${WRANGLER_LOG:-}" ]]; then
    cat "$WRANGLER_LOG"
  fi
  if [[ -n "${wrangler_state_dir:-}" && -d "$wrangler_state_dir" ]]; then
    rm -rf -- "$wrangler_state_dir"
  fi
  trap - HUP INT TERM
  if (( command_status != 0 )); then
    exit "$command_status"
  fi
  if (( cleanup_status != 0 )); then
    exit "$cleanup_status"
  fi
  exit 0
}
