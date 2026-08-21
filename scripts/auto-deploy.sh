#!/usr/bin/env bash

set -Eeuo pipefail

# launchd uses a minimal PATH, so Docker must be discoverable without a login shell.
# launchd 使用精简 PATH，必须显式补齐 Docker CLI 路径，避免服务环境下找不到 Docker。
export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/bin:/bin:/usr/sbin:/sbin"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${FG_AUTO_DEPLOY_ENV_FILE:-$PROJECT_ROOT/.env.docker}"
BRANCH="${FG_AUTO_DEPLOY_BRANCH:-main}"
REMOTE="${FG_AUTO_DEPLOY_REMOTE:-origin}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-fgai-app}"
HEALTH_URL="${FG_AUTO_DEPLOY_HEALTH_URL:-http://127.0.0.1:3000}"
STATE_ROOT="${FG_AUTO_DEPLOY_STATE_DIR:-$HOME/Library/Application Support/fg-studio-auto-deploy}"
LOCK_DIR="$STATE_ROOT/lock"
FAILED_SHA_FILE="$STATE_ROOT/failed-sha"

mkdir -p "$STATE_ROOT"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  LOCK_PID="$(<"$LOCK_DIR/pid" 2>/dev/null || true)"
  if [[ -n "$LOCK_PID" ]] && kill -0 "$LOCK_PID" 2>/dev/null; then
    exit 0
  fi
  rm -f "$LOCK_DIR/pid"
  rmdir "$LOCK_DIR" 2>/dev/null || exit 0
  mkdir "$LOCK_DIR"
fi
printf '%s' "$$" > "$LOCK_DIR/pid"
cleanup() {
  rm -f "$LOCK_DIR/pid"
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT

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

compose() {
  docker compose \
    --project-directory "$PROJECT_ROOT" \
    --project-name "$COMPOSE_PROJECT_NAME" \
    --env-file "$ENV_FILE" \
    "$@"
}

nas_is_ready() {
  local nas_path
  local expected_host
  local expected_share
  local marker_name
  local mount_line
  local mount_point

  nas_path="$(read_env_value NAS_MEDIA_PATH)"
  expected_host="$(read_env_value NAS_EXPECTED_HOST)"
  expected_share="$(read_env_value NAS_EXPECTED_SHARE)"
  marker_name="$(read_env_value NAS_READY_MARKER)"
  marker_name="${marker_name:-.fg-studio-nas-ready}"

  if [[ -z "$nas_path" || -z "$expected_host" || -z "$expected_share" ]]; then
    log "Auto deploy: NAS deployment settings are incomplete; waiting"
    return 1
  fi

  mount_line="$(/sbin/mount | awk -v host="$expected_host" -v share="/$expected_share on " 'index($0, host) && index($0, share) { print; exit }')"
  mount_point="$(sed -E 's#^.* on (.*) \(smbfs,.*$#\1#' <<< "$mount_line")"
  if [[ -z "$mount_line" || -z "$mount_point" ]]; then
    log "Auto deploy: NAS mount is not ready; waiting"
    return 1
  fi
  if [[ "$nas_path" != "$mount_point" && "$nas_path" != "$mount_point/"* ]]; then
    log "Auto deploy: NAS path is outside the expected mount; waiting"
    return 1
  fi
  if [[ ! -f "$nas_path/$marker_name" ]]; then
    log "Auto deploy: NAS ready marker is missing; waiting"
    return 1
  fi
  return 0
}

worktree_is_clean() {
  [[ -z "$(git -C "$PROJECT_ROOT" status --porcelain --untracked-files=normal)" ]]
}

wait_for_healthy() {
  local attempt
  local container
  local health

  for attempt in {1..60}; do
    container="$(compose ps -q app 2>/dev/null || true)"
    if [[ -n "$container" ]]; then
      health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)"
      if [[ "$health" == "healthy" ]] && /usr/bin/curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
        return 0
      fi
    fi
    sleep 2
  done
  return 1
}

rollback() {
  local previous_sha="$1"

  log "Auto deploy: rolling back to $previous_sha"
  if ! git -C "$PROJECT_ROOT" reset --keep "$previous_sha" >/dev/null; then
    log "Auto deploy: rollback checkout failed"
    return 1
  fi
  if ! compose build app >/dev/null; then
    log "Auto deploy: rollback image build failed"
    return 1
  fi
  if ! compose up -d --no-deps --force-recreate app >/dev/null; then
    log "Auto deploy: rollback Compose start failed"
    return 1
  fi
  if ! wait_for_healthy; then
    log "Auto deploy: rollback health check failed"
    return 1
  fi
  log "Auto deploy: rollback completed"
}

[[ -f "$ENV_FILE" ]] || { log "Auto deploy: missing environment file $ENV_FILE"; exit 1; }
[[ "$(git -C "$PROJECT_ROOT" branch --show-current)" == "$BRANCH" ]] || {
  log "Auto deploy: checkout is not on $BRANCH; refusing to deploy"
  exit 1
}
worktree_is_clean || {
  log "Auto deploy: working tree is not clean; refusing to deploy"
  exit 1
}
docker info >/dev/null 2>&1 || {
  log "Auto deploy: Docker is unavailable; waiting"
  exit 0
}
nas_is_ready || exit 0
compose config -q >/dev/null || {
  log "Auto deploy: Docker Compose configuration is invalid; waiting"
  exit 1
}

git -C "$PROJECT_ROOT" fetch --prune "$REMOTE" "$BRANCH" >/dev/null || {
  log "Auto deploy: failed to fetch $REMOTE/$BRANCH"
  exit 1
}

current_sha="$(git -C "$PROJECT_ROOT" rev-parse "$BRANCH")"
target_sha="$(git -C "$PROJECT_ROOT" rev-parse "$REMOTE/$BRANCH")"
if [[ "$current_sha" == "$target_sha" ]]; then
  exit 0
fi

failed_sha="$(<"$FAILED_SHA_FILE" 2>/dev/null || true)"
if [[ "$failed_sha" == "$target_sha" ]]; then
  log "Auto deploy: skipping previously failed commit $target_sha"
  exit 0
fi

log "Auto deploy: updating $current_sha -> $target_sha"
if ! git -C "$PROJECT_ROOT" merge --ff-only "$REMOTE/$BRANCH" >/dev/null; then
  log "Auto deploy: $BRANCH is not fast-forwardable; refusing to deploy"
  exit 1
fi

if ! compose build app >/dev/null || ! compose up -d --no-deps --force-recreate app >/dev/null || ! wait_for_healthy; then
  printf '%s' "$target_sha" > "$FAILED_SHA_FILE"
  rollback "$current_sha" || true
  exit 1
fi

rm -f "$FAILED_SHA_FILE"
log "Auto deploy: commit $target_sha is healthy"
