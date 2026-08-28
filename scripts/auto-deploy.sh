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
VERSION_URL="${FG_AUTO_DEPLOY_VERSION_URL:-http://127.0.0.1:3000/api/version}"
export APP_DEPLOYMENT_VERSION="${APP_DEPLOYMENT_VERSION:-dev}"
STATE_ROOT="${FG_AUTO_DEPLOY_STATE_DIR:-$HOME/Library/Application Support/fg-studio-auto-deploy}"
APP_LOG_ROOT="${FG_APP_LOG_DIR:-$HOME/Library/Logs/fg-studio-app}"
LOCK_DIR="$STATE_ROOT/lock"
FAILED_SHA_FILE="$STATE_ROOT/failed-sha"

mkdir -p "$STATE_ROOT"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  LOCK_PID=""
  [[ -f "$LOCK_DIR/pid" ]] && LOCK_PID="$(<"$LOCK_DIR/pid")"
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

new_deployment_version() {
  local sha="$1"
  printf 'deploy-%s-%s' "$(date -u '+%Y%m%dT%H%M%SZ')" "${sha:0:12}"
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

archive_app_logs() {
  local reason="$1"
  local container
  local timestamp
  local output_file

  container="$(compose ps -q app 2>/dev/null || true)"
  [[ -n "$container" ]] || return 0
  timestamp="$(date -u '+%Y%m%dT%H%M%SZ')"
  mkdir -p "$APP_LOG_ROOT"
  output_file="$APP_LOG_ROOT/app-${timestamp}-${container:0:12}-${reason}.log"

  {
    printf '# container=%s\n' "$container"
    printf '# archived_at=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    printf '# reason=%s\n' "$reason"
    docker logs --timestamps "$container"
  } > "$output_file"
  log "Auto deploy: archived app logs to $output_file"
}

apply_database_upgrade() {
  local upgrade_file="$PROJECT_ROOT/docker/initdb/002-local-upgrade.sql"

  [[ -f "$upgrade_file" ]] || {
    log "Auto deploy: missing database upgrade file $upgrade_file"
    return 1
  }
  # Apply additive schema changes before the new app starts serving traffic.
  # 新应用接流量前先执行可重复的增量 schema，避免代码与数据库结构错位。
  compose exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$upgrade_file" >/dev/null
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
  local version_payload

  for attempt in {1..60}; do
    container="$(compose ps -q app 2>/dev/null || true)"
    if [[ -n "$container" ]]; then
      health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)"
      version_payload="$(/usr/bin/curl -fsS --max-time 5 "$VERSION_URL" 2>/dev/null || true)"
      if [[ "$health" == "healthy" ]] \
        && /usr/bin/curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1 \
        && [[ "$version_payload" == *"\"deploymentVersion\":\"$APP_DEPLOYMENT_VERSION\""* ]]; then
        return 0
      fi
    fi
    sleep 2
  done
  return 1
}

fetch_main() {
  local attempt
  local fetch_output

  for attempt in {1..3}; do
    # GitHub access can briefly fail during TLS negotiation on the LAN host.
    # 局域网主机访问 GitHub 时可能短暂发生 TLS 握手失败，因此在本轮内重试。
    if fetch_output="$(git -C "$PROJECT_ROOT" fetch --prune "$REMOTE" "$BRANCH" 2>&1)"; then
      return 0
    fi
    if ((attempt < 3)); then
      log "Auto deploy: fetch attempt $attempt/3 failed: $fetch_output; retrying"
      sleep 5
    else
      log "Auto deploy: failed to fetch $REMOTE/$BRANCH: $fetch_output"
      return 1
    fi
  done
}

rollback() {
  local previous_sha="$1"

  log "Auto deploy: rolling back to $previous_sha"
  if ! git -C "$PROJECT_ROOT" reset --keep "$previous_sha" >/dev/null; then
    log "Auto deploy: rollback checkout failed"
    return 1
  fi
  export APP_DEPLOYMENT_VERSION="$(new_deployment_version "$previous_sha")"
  log "Auto deploy: rollback deployment version is $APP_DEPLOYMENT_VERSION"
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

fetch_main || exit 1

current_sha="$(git -C "$PROJECT_ROOT" rev-parse "$BRANCH")"
target_sha="$(git -C "$PROJECT_ROOT" rev-parse "$REMOTE/$BRANCH")"
if [[ "$current_sha" == "$target_sha" ]]; then
  exit 0
fi

failed_sha=""
[[ -f "$FAILED_SHA_FILE" ]] && failed_sha="$(<"$FAILED_SHA_FILE")"
if [[ "$failed_sha" == "$target_sha" ]]; then
  log "Auto deploy: skipping previously failed commit $target_sha"
  exit 0
fi

log "Auto deploy: updating $current_sha -> $target_sha"
if ! git -C "$PROJECT_ROOT" merge --ff-only "$REMOTE/$BRANCH" >/dev/null; then
  log "Auto deploy: $BRANCH is not fast-forwardable; refusing to deploy"
  exit 1
fi

export APP_DEPLOYMENT_VERSION="$(new_deployment_version "$target_sha")"
log "Auto deploy: building deployment $APP_DEPLOYMENT_VERSION"
if ! compose build app >/dev/null || ! apply_database_upgrade; then
  printf '%s' "$target_sha" > "$FAILED_SHA_FILE"
  rollback "$current_sha" || true
  exit 1
fi

archive_app_logs "before-${target_sha:0:12}"
if ! compose up -d --no-deps --force-recreate app >/dev/null || ! wait_for_healthy; then
  archive_app_logs "failed-${target_sha:0:12}"
  printf '%s' "$target_sha" > "$FAILED_SHA_FILE"
  rollback "$current_sha" || true
  exit 1
fi

rm -f "$FAILED_SHA_FILE"
log "Auto deploy: commit $target_sha is healthy (deployment $APP_DEPLOYMENT_VERSION)"
