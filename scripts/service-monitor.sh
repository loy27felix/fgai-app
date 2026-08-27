#!/usr/bin/env bash

set -Eeuo pipefail

# launchd uses a minimal PATH and cannot discover Docker Desktop by default.
# launchd 默认 PATH 无法发现 Docker Desktop，监控脚本必须显式补齐。
export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/bin:/bin:/usr/sbin:/sbin"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${FG_MONITOR_ENV_FILE:-$PROJECT_ROOT/.env.docker}"
STATE_ROOT="${FG_MONITOR_STATE_DIR:-$HOME/Library/Application Support/fg-studio-monitor}"
LOG_ROOT="${FG_MONITOR_LOG_DIR:-$HOME/Library/Logs/fg-studio-monitor}"
LOCK_DIR="$STATE_ROOT/lock"
DISK_THRESHOLD="${FG_MONITOR_DISK_THRESHOLD:-90}"

mkdir -p "$STATE_ROOT" "$LOG_ROOT"
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
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"
  line="${line#*=}"
  line="${line%\"}"
  line="${line#\"}"
  line="${line%\'}"
  line="${line#\'}"
  printf '%s' "$line"
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n' ' '
}

send_alert() {
  local message="$1"
  local webhook_url
  local webhook_type
  local escaped
  local payload
  webhook_url="$(read_env_value FG_MONITOR_WEBHOOK_URL)"
  webhook_type="$(read_env_value FG_MONITOR_WEBHOOK_TYPE)"
  [[ -n "$webhook_url" ]] || return 0
  escaped="$(json_escape "$message")"
  case "${webhook_type:-generic}" in
    feishu) payload="{\"msg_type\":\"text\",\"content\":{\"text\":\"$escaped\"}}" ;;
    wecom) payload="{\"msgtype\":\"text\",\"text\":{\"content\":\"$escaped\"}}" ;;
    generic) payload="{\"text\":\"$escaped\"}" ;;
    *) log "Monitor: unsupported webhook type $webhook_type"; return 1 ;;
  esac
  /usr/bin/curl -fsS --max-time 8 -H 'Content-Type: application/json' -d "$payload" "$webhook_url" >/dev/null || {
    log "Monitor: webhook delivery failed"
    return 1
  }
}

update_state() {
  local service="$1"
  local next="$2"
  local message="$3"
  local state_file="$STATE_ROOT/$service.state"
  local previous=""
  [[ -f "$state_file" ]] && previous="$(<"$state_file")"
  [[ "$previous" == "$next" ]] && return 0
  printf '%s' "$next" > "$state_file"
  log "Monitor: $service $next - $message"
  if [[ -n "$previous" || "$next" != "healthy" ]]; then
    send_alert "FG Studio [$service] $next: $message" || true
  fi
}

failure_count() {
  local service="$1"
  local counter_file="$STATE_ROOT/$service.failures"
  local count=0
  [[ -f "$counter_file" ]] && count="$(<"$counter_file")"
  [[ "$count" =~ ^[0-9]+$ ]] || count=0
  count=$((count + 1))
  printf '%s' "$count" > "$counter_file"
  printf '%s' "$count"
}

clear_failures() {
  rm -f "$STATE_ROOT/$1.failures"
}

compose() {
  docker compose --project-directory "$PROJECT_ROOT" --project-name fgai-app --env-file "$ENV_FILE" "$@"
}

container_id() {
  compose ps -q "$1" 2>/dev/null || true
}

check_nas() {
  local nas_path
  local expected_host
  local marker_name
  nas_path="$(read_env_value NAS_MEDIA_PATH)"
  expected_host="$(read_env_value NAS_EXPECTED_HOST)"
  marker_name="$(read_env_value NAS_READY_MARKER)"
  marker_name="${marker_name:-.fg-studio-nas-ready}"
  if [[ -n "$expected_host" ]] && /usr/bin/nc -G 2 -z "$expected_host" 445 >/dev/null 2>&1 \
    && [[ -n "$nas_path" && -f "$nas_path/$marker_name" ]]; then
    update_state nas healthy "SMB and ready marker are available"
  else
    update_state nas unhealthy "SMB or mounted ready marker is unavailable"
  fi
}

check_app() {
  local container
  local health="missing"
  container="$(container_id app)"
  [[ -n "$container" ]] && health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)"
  if [[ "$health" == "healthy" ]] && /usr/bin/curl -fsS --max-time 5 http://127.0.0.1:3000 >/dev/null 2>&1; then
    clear_failures app
    update_state app healthy "container health and HTTP checks passed"
  else
    update_state app unhealthy "container health=$health or HTTP check failed; NAS supervisor will recover it"
  fi
}

check_postgres() {
  local container
  local health="missing"
  local count
  container="$(container_id postgres)"
  [[ -n "$container" ]] && health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)"
  if [[ "$health" == "healthy" ]]; then
    clear_failures postgres
    update_state postgres healthy "pg_isready health check passed"
    return
  fi
  count="$(failure_count postgres)"
  update_state postgres unhealthy "container health=$health; consecutive failures=$count"
  if ((count >= 3)) && [[ -n "$container" ]]; then
    log "Monitor: restarting unhealthy PostgreSQL container"
    compose restart postgres >/dev/null 2>&1 || true
    clear_failures postgres
  fi
}

check_tunnel() {
  local container
  local count
  container="$(container_id cloudflared)"
  if [[ -n "$container" ]] && docker exec "$container" cloudflared tunnel ready --metrics 127.0.0.1:20241 >/dev/null 2>&1; then
    clear_failures tunnel
    update_state tunnel healthy "Cloudflare connector is ready"
    return
  fi
  count="$(failure_count tunnel)"
  update_state tunnel unhealthy "Cloudflare connector is not ready; consecutive failures=$count"
  if ((count >= 2)) && [[ -n "$container" ]]; then
    log "Monitor: restarting disconnected Cloudflare connector"
    compose restart cloudflared >/dev/null 2>&1 || true
    clear_failures tunnel
  fi
}

check_disk() {
  local usage
  usage="$(df -Pk / | awk 'NR==2 { gsub(/%/, "", $5); print $5 }')"
  if [[ "$usage" =~ ^[0-9]+$ ]] && ((usage < DISK_THRESHOLD)); then
    update_state disk healthy "root filesystem usage=${usage}%"
  else
    update_state disk unhealthy "root filesystem usage=${usage:-unknown}%, threshold=${DISK_THRESHOLD}%"
  fi
}

check_app_errors() {
  local container
  local matches
  local count
  container="$(container_id app)"
  [[ -n "$container" ]] || return 0
  matches="$(docker logs --since 40s "$container" 2>&1 | grep -Ei '"stage":"[^"]*(failed|error)|"error":|(^|[[:space:]])(fatal|panic|exception)([^[:alnum:]_]|$)' || true)"
  if [[ -z "$matches" ]]; then
    update_state app-errors healthy "no new error/fail events"
    return
  fi
  count="$(printf '%s\n' "$matches" | wc -l | tr -d ' ')"
  printf '%s\n' "$matches" >> "$LOG_ROOT/app-errors.log"
  update_state app-errors unhealthy "$count new error/fail log events; details saved to $LOG_ROOT/app-errors.log"
}

[[ -f "$ENV_FILE" ]] || { log "Monitor: missing environment file $ENV_FILE"; exit 1; }
if ! docker info >/dev/null 2>&1; then
  update_state docker unhealthy "Docker Desktop is unavailable; requesting application start"
  /usr/bin/open -gja Docker >/dev/null 2>&1 || true
  exit 0
fi

update_state docker healthy "Docker daemon is available"
check_nas
check_app
check_postgres
check_tunnel
check_disk
check_app_errors
