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
DEPLOY_TARGET_SHA="${FG_AUTO_DEPLOY_TARGET_SHA:-}"
DEPLOY_PREVIOUS_SHA="${FG_AUTO_DEPLOY_PREVIOUS_SHA:-}"
export APP_DEPLOYMENT_VERSION="${APP_DEPLOYMENT_VERSION:-dev}"
STATE_ROOT="${FG_AUTO_DEPLOY_STATE_DIR:-$HOME/Library/Application Support/fg-studio-auto-deploy}"
APP_LOG_ROOT="${FG_APP_LOG_DIR:-$HOME/Library/Logs/fg-studio-app}"
BUILD_LOG_ROOT="${FG_AUTO_DEPLOY_BUILD_LOG_DIR:-$HOME/Library/Logs/fg-studio-auto-deploy-build}"
LOCK_DIR="$STATE_ROOT/lock"
FAILED_SHA_FILE="$STATE_ROOT/failed-sha"
FAILED_DETAIL_FILE="$STATE_ROOT/failed-detail"
LAST_BUILD_LOG_FILE=""

mkdir -p "$STATE_ROOT"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  LOCK_PID=""
  [[ -f "$LOCK_DIR/pid" ]] && LOCK_PID="$(<"$LOCK_DIR/pid")"
  if [[ "$LOCK_PID" != "$$" ]] && [[ -n "$LOCK_PID" ]] && kill -0 "$LOCK_PID" 2>/dev/null; then
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

app_base_url() {
  local app_host_port
  app_host_port="$(read_env_value FG_APP_HOST_PORT)"
  [[ "$app_host_port" =~ ^[0-9]+$ ]] || app_host_port=3000
  printf 'http://127.0.0.1:%s' "$app_host_port"
}

APP_BASE_URL="$(app_base_url)"
HEALTH_URL="${FG_AUTO_DEPLOY_HEALTH_URL:-${APP_BASE_URL}/api/version}"
VERSION_URL="${FG_AUTO_DEPLOY_VERSION_URL:-${APP_BASE_URL}/api/version}"
COMPOSE_PROFILE="${FG_AUTO_DEPLOY_COMPOSE_PROFILE:-$(read_env_value FG_COMPOSE_PROFILE)}"

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n' ' '
}

send_deploy_error_event() {
  local sha="$1"
  local phase="$2"
  local secret
  local endpoint
  local base_url
  local app_base
  local payload
  secret="$(read_env_value FG_OBSERVABILITY_SECRET)"
  secret="${secret:-$(read_env_value SESSION_SECRET)}"
  [[ -n "$secret" ]] || return 0
  base_url="$(read_env_value FG_OBSERVABILITY_URL)"
  app_base="$(app_base_url)"
  base_url="${base_url:-$app_base}"
  endpoint="${base_url%/}/api/observability/error-events"
  payload="{\"source\":\"deploy\",\"service\":\"auto-deploy\",\"severity\":\"critical\",\"impact\":\"blocked\",\"code\":\"$(json_escape "$phase")\",\"message\":\"deployment failed for commit $(json_escape "$sha") at $(json_escape "$phase")\",\"deploymentVersion\":\"$(json_escape "${APP_DEPLOYMENT_VERSION:-dev}")\",\"eventKey\":\"deploy-${sha}-${phase}\"}"
  /usr/bin/curl -fsS --connect-timeout 1 --max-time 2 \
    -H "x-fg-observability-secret: $secret" -H 'Content-Type: application/json' \
    -d "$payload" "$endpoint" >/dev/null 2>&1 || true
}

compose() {
  if [[ -n "$COMPOSE_PROFILE" ]]; then
    docker compose \
      --project-directory "$PROJECT_ROOT" \
      --project-name "$COMPOSE_PROJECT_NAME" \
      --env-file "$ENV_FILE" \
      --profile "$COMPOSE_PROFILE" \
      "$@"
    return
  fi
  # Do not expand an empty Bash array under nounset when HTTPS is disabled.
  # 未启用 HTTPS 时不展开空 Bash array，避免 nounset 导致自动部署失败。
  docker compose \
    --project-directory "$PROJECT_ROOT" \
    --project-name "$COMPOSE_PROJECT_NAME" \
    --env-file "$ENV_FILE" \
    "$@"
}

compose_build_app() {
  local build_log
  local exit_code

  # Pass the deployment version explicitly so Compose interpolation cannot fall back to dev.
  # 显式传递部署版本，避免 Compose 插值异常时回退为 dev。
  mkdir -p "$BUILD_LOG_ROOT"
  build_log="$BUILD_LOG_ROOT/build-${APP_DEPLOYMENT_VERSION}.log"
  LAST_BUILD_LOG_FILE="$build_log"
  log "Auto deploy: build output is $build_log"
  if BUILDKIT_PROGRESS=plain compose build --build-arg "APP_DEPLOYMENT_VERSION=$APP_DEPLOYMENT_VERSION" app >"$build_log" 2>&1; then
    return 0
  else
    exit_code=$?
  fi

  log "Auto deploy: image build failed (exit $exit_code); details: $build_log"
  while IFS= read -r line; do
    log "Auto deploy: build | $line"
  done < <(tail -n 80 "$build_log")
  return "$exit_code"
}

record_failed_deployment() {
  local sha="$1"
  local phase="$2"

  printf '%s' "$sha" > "$FAILED_SHA_FILE"
  {
    printf 'commit=%s\n' "$sha"
    printf 'phase=%s\n' "$phase"
    printf 'buildLog=%s\n' "${LAST_BUILD_LOG_FILE:-unavailable}"
  } > "$FAILED_DETAIL_FILE"
  log "Auto deploy: failure details saved to $FAILED_DETAIL_FILE"
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

reload_nginx() {
  local nginx_container
  local attempt

  nginx_container="$(compose ps -q nginx 2>/dev/null || true)"
  [[ -n "$nginx_container" ]] || return 0
  # A bind-mounted Nginx config needs an explicit reload after a repository update.
  # bind-mounted Nginx 配置随仓库更新后不会自动生效，必须显式 reload。
  log "Auto deploy: validating and reloading Nginx"
  for attempt in {1..5}; do
    if compose exec -T nginx nginx -t >/dev/null && compose exec -T nginx nginx -s reload >/dev/null; then
      return 0
    fi
    if ((attempt < 5)); then
      log "Auto deploy: Nginx validation/reload attempt $attempt/5 failed; retrying"
      sleep 2
    fi
  done
  log "Auto deploy: Nginx validation/reload failed after 5 attempts"
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
  if ! compose_build_app; then
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

if [[ -n "$DEPLOY_TARGET_SHA" ]]; then
  current_sha="$(git -C "$PROJECT_ROOT" rev-parse "$BRANCH")"
  target_sha="$DEPLOY_TARGET_SHA"
  previous_sha="$DEPLOY_PREVIOUS_SHA"
  if [[ "$current_sha" != "$target_sha" || -z "$previous_sha" ]]; then
    log "Auto deploy: re-exec target is no longer valid; waiting"
    exit 1
  fi
else
  fetch_main || exit 1

  current_sha="$(git -C "$PROJECT_ROOT" rev-parse "$BRANCH")"
  target_sha="$(git -C "$PROJECT_ROOT" rev-parse "$REMOTE/$BRANCH")"
  if [[ "$current_sha" == "$target_sha" ]]; then
    exit 0
  fi

  failed_sha=""
  [[ -f "$FAILED_SHA_FILE" ]] && failed_sha="$(<"$FAILED_SHA_FILE")"
  if [[ "$failed_sha" == "$target_sha" ]]; then
    if [[ -f "$FAILED_DETAIL_FILE" ]]; then
      log "Auto deploy: skipping previously failed commit $target_sha (failure details: $FAILED_DETAIL_FILE)"
    else
      log "Auto deploy: skipping previously failed commit $target_sha (failure details unavailable for this older failure)"
    fi
    exit 0
  fi

  log "Auto deploy: updating $current_sha -> $target_sha"
  if ! git -C "$PROJECT_ROOT" merge --ff-only "$REMOTE/$BRANCH" >/dev/null; then
    log "Auto deploy: $BRANCH is not fast-forwardable; refusing to deploy"
    exit 1
  fi

  # Re-read the script after fast-forward so this deployment uses the fetched version.
  # 快进更新后重新读取脚本，确保本次部署执行的是刚拉取的版本。
  exec env \
    FG_AUTO_DEPLOY_TARGET_SHA="$target_sha" \
    FG_AUTO_DEPLOY_PREVIOUS_SHA="$current_sha" \
    "$BASH" "$0"
fi

failed_sha=""
[[ -f "$FAILED_SHA_FILE" ]] && failed_sha="$(<"$FAILED_SHA_FILE")"
if [[ "$failed_sha" == "$target_sha" ]]; then
  if [[ -f "$FAILED_DETAIL_FILE" ]]; then
    log "Auto deploy: skipping previously failed commit $target_sha (failure details: $FAILED_DETAIL_FILE)"
  else
    log "Auto deploy: skipping previously failed commit $target_sha (failure details unavailable for this older failure)"
  fi
  exit 0
fi

export APP_DEPLOYMENT_VERSION="$(new_deployment_version "$target_sha")"
log "Auto deploy: building deployment $APP_DEPLOYMENT_VERSION"
if ! compose_build_app; then
  record_failed_deployment "$target_sha" "image-build"
  rollback "$previous_sha" || true
  send_deploy_error_event "$target_sha" "image-build"
  exit 1
fi
if ! apply_database_upgrade; then
  record_failed_deployment "$target_sha" "database-upgrade"
  rollback "$previous_sha" || true
  send_deploy_error_event "$target_sha" "database-upgrade"
  exit 1
fi

archive_app_logs "before-${target_sha:0:12}"
if ! compose up -d --no-deps --force-recreate app >/dev/null || ! wait_for_healthy || ! reload_nginx; then
  archive_app_logs "failed-${target_sha:0:12}"
  record_failed_deployment "$target_sha" "container-health"
  rollback "$previous_sha" || true
  send_deploy_error_event "$target_sha" "container-health"
  exit 1
fi

rm -f "$FAILED_SHA_FILE" "$FAILED_DETAIL_FILE"
log "Auto deploy: commit $target_sha is healthy (deployment $APP_DEPLOYMENT_VERSION)"
