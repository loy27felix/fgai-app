#!/usr/bin/env bash

set -Eeuo pipefail

fg_obs_outbox_dir() {
  local state_root="${FG_MONITOR_STATE_DIR:-$HOME/Library/Application Support/fg-studio-monitor}"
  printf '%s/outbox' "$state_root"
}

fg_obs_queue_event() {
  local kind="$1"
  local payload="$2"
  local outbox
  local digest
  local destination
  local temporary

  case "$kind" in
    monitor|error) ;;
    *) return 2 ;;
  esac
  [[ -n "$payload" ]] || return 2

  outbox="$(fg_obs_outbox_dir)"
  (umask 077 && mkdir -p "$outbox")
  chmod 700 "$outbox"
  digest="$(printf '%s' "$payload" | /usr/bin/shasum -a 256 | awk '{print $1}')"
  destination="$outbox/$digest.$kind.json"
  [[ -f "$destination" ]] && return 0

  temporary="$(mktemp "$outbox/.pending.XXXXXX")"
  chmod 600 "$temporary"
  printf '%s\n' "$payload" > "$temporary"
  if [[ -f "$destination" ]]; then
    rm -f "$temporary"
  else
    mv "$temporary" "$destination"
  fi
}

fg_obs_flush_outbox() {
  local base_url="$1"
  local secret="$2"
  local limit="$3"
  local outbox
  local delivered=0
  local kind
  local file
  local endpoint

  [[ "$limit" =~ ^[1-9][0-9]*$ ]] || limit=5
  [[ -n "$base_url" && -n "$secret" ]] || return 0
  outbox="$(fg_obs_outbox_dir)"
  [[ -d "$outbox" ]] || return 0

  for kind in monitor error; do
    case "$kind" in
      monitor) endpoint="${base_url%/}/api/observability/monitor-events" ;;
      error) endpoint="${base_url%/}/api/observability/error-events" ;;
    esac
    for file in "$outbox"/*."$kind".json; do
      [[ -f "$file" ]] || continue
      if /usr/bin/curl -fsS --connect-timeout 1 --max-time 2 \
        -H "x-fg-observability-secret: $secret" \
        -H 'Content-Type: application/json' \
        --data-binary "@$file" "$endpoint" >/dev/null 2>&1; then
        rm -f "$file"
        delivered=$((delivered + 1))
        ((delivered >= limit)) && return 0
      fi
    done
  done
  return 0
}
