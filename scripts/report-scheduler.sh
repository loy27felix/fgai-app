#!/usr/bin/env bash

set -Eeuo pipefail

# launchd uses a minimal PATH, so the scheduler must locate curl explicitly.
# launchd 使用精简 PATH，报表调度器必须显式补齐基础命令路径。
export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/bin:/bin:/usr/sbin:/sbin"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${FG_REPORT_SCHEDULER_ENV_FILE:-$PROJECT_ROOT/.env.docker}"
STATE_ROOT="${FG_REPORT_SCHEDULER_STATE_DIR:-$HOME/Library/Application Support/fg-studio-report-scheduler}"
LOCK_DIR="$STATE_ROOT/lock"

mkdir -p "$STATE_ROOT"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

read_env_value() {
  local key="$1"
  local line=""
  [[ -f "$ENV_FILE" ]] || return 0
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"
  line="${line#*=}"
  line="${line%\"}"
  line="${line#\"}"
  line="${line%\'}"
  line="${line#\'}"
  printf '%s' "$line"
}

[[ -f "$ENV_FILE" ]] || { log "Report scheduler: missing environment file $ENV_FILE"; exit 0; }

secret="$(read_env_value FG_OBSERVABILITY_SECRET)"
secret="${secret:-$(read_env_value SESSION_SECRET)}"
if [[ -z "$secret" ]]; then
  log "Report scheduler: no observability secret configured; skipped"
  exit 0
fi

base_url="$(read_env_value FG_OBSERVABILITY_URL)"
base_url="${base_url:-http://127.0.0.1:3000}"
endpoint="${base_url%/}/api/observability/report-runner"
http_code="$(/usr/bin/curl -sS -o /dev/null -w '%{http_code}' \
  --connect-timeout 2 --max-time 60 \
  -H "x-fg-observability-secret: $secret" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"due"}' "$endpoint" 2>/dev/null || true)"

if [[ "$http_code" == "200" ]]; then
  log "Report scheduler: due reports checked successfully"
else
  log "Report scheduler: endpoint returned ${http_code:-no response}; will retry"
fi
