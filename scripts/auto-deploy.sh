#!/usr/bin/env bash

set -Eeuo pipefail

# launchd uses a minimal PATH, so Docker must be discoverable without a login shell.
# launchd 使用精简 PATH，必须显式补齐 Docker CLI 路径，避免服务环境下找不到 Docker。
export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/bin:/bin:/usr/sbin:/sbin"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$PROJECT_ROOT/scripts/lock-utils.sh"
if ! register_lock_protocol_process; then
  printf 'Auto deploy: cannot register the current lock protocol process\n' >&2
  exit 1
fi
trap 'unregister_lock_protocol_process' EXIT
ENV_FILE="${FG_AUTO_DEPLOY_ENV_FILE:-$PROJECT_ROOT/.env.docker}"
BRANCH="${FG_AUTO_DEPLOY_BRANCH:-main}"
REMOTE="${FG_AUTO_DEPLOY_REMOTE:-origin}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-fgai-app}"
COMPOSE_STORAGE_MODE="offline"
DEPLOY_TARGET_SHA="${FG_AUTO_DEPLOY_TARGET_SHA:-}"
DEPLOY_PREVIOUS_SHA="${FG_AUTO_DEPLOY_PREVIOUS_SHA:-}"
export APP_DEPLOYMENT_VERSION="${APP_DEPLOYMENT_VERSION:-dev}"
STATE_ROOT="${FG_AUTO_DEPLOY_STATE_DIR:-$HOME/Library/Application Support/fg-studio-auto-deploy}"
APP_LOG_ROOT="${FG_APP_LOG_DIR:-$HOME/Library/Logs/fg-studio-app}"
BUILD_LOG_ROOT="${FG_AUTO_DEPLOY_BUILD_LOG_DIR:-$HOME/Library/Logs/fg-studio-auto-deploy-build}"
NAS_GUARD_ROOT="$HOME/Library/Application Support/fg-studio-nas-state"
LOCK_FILE="$STATE_ROOT/lock"
RECREATE_LOCK_FILE="$HOME/Library/Application Support/fg-studio-app-recreate/lock"
RECREATE_LOCK_HELD=0
FAILED_SHA_FILE="$STATE_ROOT/failed-sha"
FAILED_DETAIL_FILE="$STATE_ROOT/failed-detail"
LAST_BUILD_LOG_FILE=""
ROLLBACK_FAILED_SHA=""

mkdir -p "$STATE_ROOT" "$NAS_GUARD_ROOT"
# Keep FD8 inherited only during the in-process version handoff after the lock is acquired.
# 只有已持锁的脚本版本交接才沿用 FD8，避免重开锁文件时释放单例锁。
if [[ "${FG_AUTO_DEPLOY_LOCK_HELD:-}" == "1" ]]; then
  if ! { : >&8; } 2>/dev/null || ! [[ /dev/fd/8 -ef "$LOCK_FILE" ]]; then
    printf 'Auto deploy: inherited singleton lock descriptor is invalid\n' >&2
    exit 1
  fi
else
  LEGACY_LOCK_STATUS=0
  cleanup_legacy_lock_directory "$LOCK_FILE" || LEGACY_LOCK_STATUS=$?
  if (( LEGACY_LOCK_STATUS == 1 )); then
    exit 0
  fi
  if (( LEGACY_LOCK_STATUS != 0 )); then
    printf 'Auto deploy: legacy singleton lock migration failed\n' >&2
    exit 1
  fi
  if ! exec 8>>"$LOCK_FILE"; then
    printf 'Auto deploy: cannot open the singleton lock file %s\n' "$LOCK_FILE" >&2
    exit 1
  fi
  LOCK_RESULT=0
  /usr/bin/lockf -s -t 0 8 || LOCK_RESULT=$?
  if (( LOCK_RESULT == 75 )); then
    exec 8>&-
    exit 0
  fi
  if (( LOCK_RESULT != 0 )); then
    exec 8>&-
    printf 'Auto deploy: lockf failed with exit %s\n' "$LOCK_RESULT" >&2
    exit 1
  fi
fi
unset FG_AUTO_DEPLOY_LOCK_HELD
cleanup() {
  if [[ -n "$ROLLBACK_FAILED_SHA" ]]; then
    git -C "$PROJECT_ROOT" reset --keep "$ROLLBACK_FAILED_SHA" >/dev/null 2>&1 || true
  fi
  release_recreate_lock
  exec 8>&-
  unregister_lock_protocol_process
}
trap cleanup EXIT

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

acquire_recreate_lock() {
  local attempt
  local migration_status=0
  local lock_status=0
  mkdir -p "$(dirname "$RECREATE_LOCK_FILE")"
  for attempt in {1..15}; do
    migration_status=0
    cleanup_legacy_lock_directory "$RECREATE_LOCK_FILE" || migration_status=$?
    if (( migration_status == 2 )); then
      log "Auto deploy: legacy App recreation lock migration failed"
      return 1
    fi
    if (( migration_status != 0 )); then
      sleep 1
      continue
    fi
    if ! exec 9>>"$RECREATE_LOCK_FILE"; then
      log "Auto deploy: cannot open the App recreation lock file"
      return 1
    fi
    lock_status=0
    /usr/bin/lockf -s -t 0 9 || lock_status=$?
    if (( lock_status == 0 )); then
      RECREATE_LOCK_HELD=1
      return 0
    fi
    exec 9>&-
    if (( lock_status != 75 )); then
      log "Auto deploy: lockf failed for the App recreation lock (exit $lock_status)"
      return 1
    fi
    sleep 1
  done
  return 1
}

release_recreate_lock() {
  if (( RECREATE_LOCK_HELD )); then
    exec 9>&-
    RECREATE_LOCK_HELD=0
  fi
}

run_with_timeout() {
  local timeout_seconds="$1"
  local command_pid
  local watchdog_pid
  local exit_code=0
  shift

  "$@" &
  command_pid=$!
  (
    sleep "$timeout_seconds"
    kill -TERM "$command_pid" 2>/dev/null || exit 0
    sleep 1
    kill -KILL "$command_pid" 2>/dev/null || true
  ) &
  watchdog_pid=$!

  wait "$command_pid" || exit_code=$?
  kill "$watchdog_pid" 2>/dev/null || true
  wait "$watchdog_pid" 2>/dev/null || true
  return "$exit_code"
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
  local compose_files=(--file "$PROJECT_ROOT/docker-compose.yml")
  if [[ "$COMPOSE_STORAGE_MODE" == "nas" ]]; then
    compose_files+=(--file "$PROJECT_ROOT/docker-compose.nas.yml")
  fi
  if [[ -n "$COMPOSE_PROFILE" ]]; then
    docker compose \
      "${compose_files[@]}" \
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
    "${compose_files[@]}" \
    --project-directory "$PROJECT_ROOT" \
    --project-name "$COMPOSE_PROJECT_NAME" \
    --env-file "$ENV_FILE" \
    "$@"
}

set_storage_guard() {
  # Keep NAS routes disabled until the supervisor verifies the recreated App.
  # 守护进程确认新 App 的 NAS 读写前，持续关闭媒体接口。
  (umask 022; : > "$NAS_GUARD_ROOT/disabled") && chmod 644 "$NAS_GUARD_ROOT/disabled"
}

compose_build_services() {
  local build_log
  local exit_code
  local services=("$@")

  # Pass the deployment version explicitly for every service selected by the active revision.
  # 为当前代码版本选择的服务显式传递部署版本，避免 Compose 插值异常时回退为 dev。
  mkdir -p "$BUILD_LOG_ROOT"
  build_log="$BUILD_LOG_ROOT/build-${APP_DEPLOYMENT_VERSION}.log"
  LAST_BUILD_LOG_FILE="$build_log"
  log "Auto deploy: build output is $build_log"
  if BUILDKIT_PROGRESS=plain compose build --build-arg "APP_DEPLOYMENT_VERSION=$APP_DEPLOYMENT_VERSION" "${services[@]}" 2>&1 | tee "$build_log"; then
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
  local rollback_previous_sha="$previous_sha"
  local prior_failed_sha=""
  local prior_previous_sha=""

  [[ -f "$FAILED_SHA_FILE" ]] && prior_failed_sha="$(<"$FAILED_SHA_FILE")"
  if [[ "$prior_failed_sha" == "$previous_sha" && -f "$FAILED_DETAIL_FILE" ]]; then
    # A failed previous commit is not a safe rollback target; retain its known-good base.
    # 上一提交本身已失败时不能把它作为回滚目标，沿用其记录的健康基线。
    prior_previous_sha="$(sed -n 's/^previousCommit=//p' "$FAILED_DETAIL_FILE" | head -n 1)"
    if [[ "$prior_previous_sha" =~ ^[0-9a-f]{40}$ ]]; then
      rollback_previous_sha="$prior_previous_sha"
    fi
  fi

  printf '%s' "$sha" > "$FAILED_SHA_FILE"
  {
    printf 'commit=%s\n' "$sha"
    printf 'phase=%s\n' "$phase"
    printf 'previousCommit=%s\n' "$rollback_previous_sha"
    printf 'buildLog=%s\n' "${LAST_BUILD_LOG_FILE:-unavailable}"
  } > "$FAILED_DETAIL_FILE"
  log "Auto deploy: failure details saved to $FAILED_DETAIL_FILE"
}

mark_rollback_completed() {
  # Stop retrying once the previous revision is healthy again.
  # 上一版本恢复健康后标记完成，避免后续轮询重复回滚。
  printf 'rollbackStatus=completed\n' >> "$FAILED_DETAIL_FILE" || return 1
  grep -Fqx 'rollbackStatus=completed' "$FAILED_DETAIL_FILE"
}

restore_failed_checkout() {
  local failed_sha="$1"
  local reason="$2"
  # Keep the failed target available so the next poll can retry this rollback.
  # 保留失败目标提交，以便下一轮重新尝试回滚。
  if git -C "$PROJECT_ROOT" reset --keep "$failed_sha" >/dev/null; then
    ROLLBACK_FAILED_SHA=""
    log "Auto deploy: restored failed commit $failed_sha after incomplete rollback ($reason)"
  else
    log "Auto deploy: could not restore failed commit $failed_sha after incomplete rollback ($reason)"
  fi
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
  local mount_line
  local mount_point

  nas_path="$(read_env_value NAS_MEDIA_PATH)"
  expected_host="$(read_env_value NAS_EXPECTED_HOST)"
  expected_share="$(read_env_value NAS_EXPECTED_SHARE)"
  if [[ -z "$nas_path" || -z "$expected_host" || -z "$expected_share" ]]; then
    log "Auto deploy: NAS deployment settings are incomplete; using isolated offline storage"
    return 1
  fi

  mount_line="$(/sbin/mount | awk -v source="@$expected_host/$expected_share on " 'index($0, source) { print; exit }')"
  mount_point="$(sed -E 's#^.* on (.*) \(smbfs,.*$#\1#' <<< "$mount_line")"
  if [[ -z "$mount_line" || -z "$mount_point" ]]; then
    log "Auto deploy: NAS mount is not ready; using isolated offline storage"
    return 1
  fi
  if [[ "$nas_path" != "$mount_point" && "$nas_path" != "$mount_point/"* ]]; then
    log "Auto deploy: NAS path is outside the expected mount; using isolated offline storage"
    return 1
  fi
  return 0
}

probe_deploy_mount() {
  local nas_path
  local marker_name
  local image
  local probe_container="fg-studio-deploy-nas-probe-$$"
  local probe_output=""

  nas_path="$(read_env_value NAS_MEDIA_PATH)"
  marker_name="$(read_env_value NAS_READY_MARKER)"
  marker_name="${marker_name:-.fg-studio-nas-ready}"
  image="$(docker image inspect --format '{{.Id}}' "$COMPOSE_PROJECT_NAME-app" 2>/dev/null || true)"
  if [[ -z "$image" ]]; then
    log "Auto deploy: built App image is unavailable for NAS preflight"
    return 1
  fi

  # Probe through a new bind mount so the next App cannot inherit stale storage.
  # 通过新 bind mount 复核，避免新 App 继承旧挂载；复用探针文件以免产生 SMB 删除残留。
  if probe_output="$(run_with_timeout 20 docker run --rm --name "$probe_container" \
    --mount "type=bind,source=$nas_path,target=/data/media" \
    --entrypoint sh "$image" -c '
      [ -f "$1" ] || { printf "NAS_MARKER_MISSING\n"; exit 1; }
      marker=$(cat "$1") || { printf "NAS_MARKER_READ_FAILED\n"; exit 1; }
      [ "$marker" = "fg-studio-media:v1" ] || { printf "NAS_MARKER_INVALID\n"; exit 1; }
      printf probe > "$2" || { printf "NAS_WRITE_FAILED\n"; exit 1; }
      written=$(cat "$2") || { printf "NAS_READBACK_FAILED\n"; exit 1; }
      [ "$written" = probe ] || { printf "NAS_READBACK_MISMATCH\n"; exit 1; }
    ' sh "/data/media/$marker_name" /data/media/.fg-studio-container-probe 2>&1)"; then
    return 0
  fi

  run_with_timeout 5 docker rm -f "$probe_container" >/dev/null 2>&1 || true
  case "$probe_output" in
    *NAS_MARKER_MISSING*) log "Auto deploy: NAS preflight marker is missing" ;;
    *NAS_MARKER_READ_FAILED*) log "Auto deploy: NAS preflight marker could not be read" ;;
    *NAS_MARKER_INVALID*) log "Auto deploy: NAS preflight marker content is invalid" ;;
    *NAS_WRITE_FAILED*) log "Auto deploy: NAS preflight media directory is not writable" ;;
    *NAS_READBACK_FAILED*) log "Auto deploy: NAS preflight probe could not be read back" ;;
    *NAS_READBACK_MISMATCH*) log "Auto deploy: NAS preflight probe readback differs from written content" ;;
    *) log "Auto deploy: Docker NAS preflight container failed to start or timed out: $probe_output" ;;
  esac
  return 1
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
  local expected_config_hash
  local mounted_config_hash
  local attempt

  nginx_container="$(compose ps -q nginx 2>/dev/null || true)"
  [[ -n "$nginx_container" ]] || return 0
  expected_config_hash="$(shasum -a 256 "$PROJECT_ROOT/docker/nginx/default.conf" | awk '{print $1}')"
  # A bind-mounted Nginx config needs an explicit reload after a repository update.
  # bind-mounted Nginx 配置随仓库更新后不会自动生效，必须显式 reload。
  log "Auto deploy: validating and reloading Nginx"
  for attempt in {1..15}; do
    mounted_config_hash="$(compose exec -T nginx sha256sum /etc/nginx/conf.d/default.conf 2>/dev/null | awk '{print $1}' || true)"
    if [[ "$mounted_config_hash" == "$expected_config_hash" ]] \
      && compose exec -T nginx nginx -t >/dev/null \
      && compose exec -T nginx nginx -s reload >/dev/null; then
      return 0
    fi
    if ((attempt < 15)); then
      log "Auto deploy: Nginx mount validation/reload attempt $attempt/15 failed; retrying"
      sleep 2
    fi
  done
  log "Auto deploy: Nginx mount validation/reload failed after 15 attempts"
  return 1
}

legacy_video_worker_is_absent() {
  local container
  container="$(docker ps \
    --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME" \
    --filter "label=com.docker.compose.service=video-worker" \
    --format '{{.ID}}' | head -n 1)"
  if [[ -n "$container" ]]; then
    log "Auto deploy: legacy video-worker is still running"
    return 1
  fi
}

fetch_main() {
  local attempt
  local fetch_output

  for attempt in {1..10}; do
    # GitHub access can briefly fail during TLS negotiation on the LAN host.
    # 局域网主机访问 GitHub 时可能短暂发生 TLS 握手失败，因此在本轮内重试。
    if fetch_output="$(git -C "$PROJECT_ROOT" fetch --prune "$REMOTE" "$BRANCH" 2>&1)"; then
      return 0
    fi
    if ((attempt < 10)); then
      log "Auto deploy: fetch attempt $attempt/10 failed: $fetch_output; retrying"
      sleep 5
    else
      log "Auto deploy: failed to fetch $REMOTE/$BRANCH: $fetch_output"
      return 1
    fi
  done
}

rollback() {
  local previous_sha="$1"
  local failed_sha="$target_sha"
  local services=(app)

  if ! nas_is_ready || ! probe_deploy_mount; then
    log "Auto deploy: NAS preflight failed; keeping the offline-capable deployment checkout instead of rolling back to a NAS-required revision"
    return 1
  fi
  if ! acquire_recreate_lock; then
    log "Auto deploy: rollback App recreation lock is busy"
    return 1
  fi
  if ! nas_is_ready || ! probe_deploy_mount; then
    release_recreate_lock
    log "Auto deploy: NAS preflight changed before rollback checkout; App remains untouched"
    return 1
  fi
  ROLLBACK_FAILED_SHA="$failed_sha"
  log "Auto deploy: rolling back to $previous_sha"
  if ! git -C "$PROJECT_ROOT" reset --keep "$previous_sha" >/dev/null; then
    log "Auto deploy: rollback checkout failed"
    return 1
  fi
  # Use the NAS override only when the rollback revision defines it; older base files bind NAS directly.
  # 回滚版本存在 NAS override 时才加载；旧版基础配置直接绑定 NAS。
  COMPOSE_STORAGE_MODE="offline"
  if [[ -f "$PROJECT_ROOT/docker-compose.nas.yml" ]]; then
    COMPOSE_STORAGE_MODE="nas"
  fi
  export APP_DEPLOYMENT_VERSION="$(new_deployment_version "$previous_sha")"
  log "Auto deploy: rollback deployment version is $APP_DEPLOYMENT_VERSION"
  # A failed worker-removal deployment must restore the worker required by the previous revision.
  # 移除 worker 的部署失败时，必须恢复上一版本仍依赖的 worker，避免回滚后队列无人处理。
  if compose config --services 2>/dev/null | grep -Fxq 'video-worker'; then
    services+=(video-worker)
  fi
  if ! compose_build_services "${services[@]}"; then
    restore_failed_checkout "$failed_sha" "rollback-image-build"
    release_recreate_lock
    log "Auto deploy: rollback image build failed"
    return 1
  fi
  if ! nas_is_ready || ! probe_deploy_mount; then
    restore_failed_checkout "$failed_sha" "rollback-preflight-changed"
    release_recreate_lock
    log "Auto deploy: NAS preflight changed during rollback build; App remains untouched"
    return 1
  fi
  if ! compose up -d --no-deps --force-recreate --remove-orphans "${services[@]}" >/dev/null; then
    restore_failed_checkout "$failed_sha" "rollback-compose-start"
    release_recreate_lock
    log "Auto deploy: rollback Compose start failed"
    return 1
  fi
  if ! wait_for_healthy; then
    restore_failed_checkout "$failed_sha" "rollback-health-check"
    release_recreate_lock
    log "Auto deploy: rollback health check failed"
    return 1
  fi
  release_recreate_lock
  if ! mark_rollback_completed; then
    log "Auto deploy: rollback is healthy, but completion state could not be saved"
    return 1
  fi
  ROLLBACK_FAILED_SHA=""
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
    failed_sha=""
    [[ -f "$FAILED_SHA_FILE" ]] && failed_sha="$(<"$FAILED_SHA_FILE")"
    if [[ "$failed_sha" == "$target_sha" ]]; then
      failed_previous_sha=""
      [[ -f "$FAILED_DETAIL_FILE" ]] && failed_previous_sha="$(sed -n 's/^previousCommit=//p' "$FAILED_DETAIL_FILE" | head -n 1)"
      failed_rollback_status=""
      [[ -f "$FAILED_DETAIL_FILE" ]] && failed_rollback_status="$(sed -n 's/^rollbackStatus=//p' "$FAILED_DETAIL_FILE" | tail -n 1)"
      if [[ "$failed_previous_sha" =~ ^[0-9a-f]{40}$ && "$failed_rollback_status" != "completed" ]]; then
        log "Auto deploy: retrying deferred rollback after NAS recovery"
        if rollback "$failed_previous_sha"; then
          log "Auto deploy: deferred rollback completed"
          exit 0
        fi
        if [[ "$(git -C "$PROJECT_ROOT" rev-parse "$BRANCH")" != "$target_sha" ]]; then
          exit 1
        fi
      fi
      log "Auto deploy: skipping previously failed commit $target_sha until a safe rollback is available"
      exit 0
    fi
    exit 0
  fi

  failed_sha=""
  [[ -f "$FAILED_SHA_FILE" ]] && failed_sha="$(<"$FAILED_SHA_FILE")"
  if [[ "$failed_sha" == "$target_sha" ]]; then
    failed_previous_sha=""
    [[ -f "$FAILED_DETAIL_FILE" ]] && failed_previous_sha="$(sed -n 's/^previousCommit=//p' "$FAILED_DETAIL_FILE" | head -n 1)"
    failed_rollback_status=""
    [[ -f "$FAILED_DETAIL_FILE" ]] && failed_rollback_status="$(sed -n 's/^rollbackStatus=//p' "$FAILED_DETAIL_FILE" | tail -n 1)"
    if [[ "$failed_previous_sha" =~ ^[0-9a-f]{40}$ && "$failed_rollback_status" != "completed" ]]; then
      log "Auto deploy: retrying incomplete rollback for failed commit $target_sha"
      if rollback "$failed_previous_sha"; then
        log "Auto deploy: deferred rollback completed"
        exit 0
      fi
    fi
    log "Auto deploy: skipping previously failed commit $target_sha (rollbackStatus=${failed_rollback_status:-unknown})"
    exit 0
  fi

  log "Auto deploy: updating $current_sha -> $target_sha"
  if ! git -C "$PROJECT_ROOT" merge --ff-only "$REMOTE/$BRANCH" >/dev/null; then
    log "Auto deploy: $BRANCH is not fast-forwardable; refusing to deploy"
    exit 1
  fi

  # Re-read the script after fast-forward so this deployment uses the fetched version.
  # 快进更新后重新读取脚本，确保本次部署执行的是刚拉取的版本。
  # Preserve the singleton lock across exec; reopening FD 8 would create a race.
  # 自重启时继承单例锁；重开 FD8 会产生并发窗口。
  exec env \
    FG_AUTO_DEPLOY_LOCK_HELD=1 \
    FG_AUTO_DEPLOY_TARGET_SHA="$target_sha" \
    FG_AUTO_DEPLOY_PREVIOUS_SHA="$current_sha" \
    "$BASH" "$0"
fi

failed_sha=""
[[ -f "$FAILED_SHA_FILE" ]] && failed_sha="$(<"$FAILED_SHA_FILE")"
if [[ "$failed_sha" == "$target_sha" ]]; then
  failed_previous_sha=""
  [[ -f "$FAILED_DETAIL_FILE" ]] && failed_previous_sha="$(sed -n 's/^previousCommit=//p' "$FAILED_DETAIL_FILE" | head -n 1)"
  failed_rollback_status=""
  [[ -f "$FAILED_DETAIL_FILE" ]] && failed_rollback_status="$(sed -n 's/^rollbackStatus=//p' "$FAILED_DETAIL_FILE" | tail -n 1)"
  if [[ "$failed_previous_sha" =~ ^[0-9a-f]{40}$ && "$failed_rollback_status" != "completed" ]]; then
    log "Auto deploy: retrying deferred rollback after NAS recovery"
    if rollback "$failed_previous_sha"; then
      log "Auto deploy: deferred rollback completed"
      exit 0
    fi
    if [[ "$(git -C "$PROJECT_ROOT" rev-parse "$BRANCH")" != "$target_sha" ]]; then
      exit 1
    fi
  fi
  log "Auto deploy: skipping previously failed commit $target_sha until a safe rollback is available"
  exit 0
fi

export APP_DEPLOYMENT_VERSION="$(new_deployment_version "$target_sha")"
log "Auto deploy: building deployment $APP_DEPLOYMENT_VERSION"
if ! compose_build_services app; then
  record_failed_deployment "$target_sha" "image-build"
  rollback "$previous_sha" || true
  send_deploy_error_event "$target_sha" "image-build"
  exit 1
fi
COMPOSE_STORAGE_MODE="offline"
if nas_is_ready && probe_deploy_mount; then
  COMPOSE_STORAGE_MODE="nas"
else
  log "Auto deploy: deploying App with isolated offline storage; NAS media operations stay disabled"
fi
if ! apply_database_upgrade; then
  record_failed_deployment "$target_sha" "database-upgrade"
  rollback "$previous_sha" || true
  send_deploy_error_event "$target_sha" "database-upgrade"
  exit 1
fi

archive_app_logs "before-${target_sha:0:12}"
if ! acquire_recreate_lock; then
  log "Auto deploy: App recreation lock is busy; deployment deferred"
  git -C "$PROJECT_ROOT" reset --keep "$previous_sha" >/dev/null
  exit 0
fi
if [[ "$COMPOSE_STORAGE_MODE" == "nas" ]] && { ! nas_is_ready || ! probe_deploy_mount; }; then
  COMPOSE_STORAGE_MODE="offline"
  log "Auto deploy: NAS preflight changed before App recreation; using isolated offline storage"
fi
if ! set_storage_guard; then
  if [[ "$COMPOSE_STORAGE_MODE" == "nas" ]]; then
    COMPOSE_STORAGE_MODE="offline"
    log "Auto deploy: local NAS guard could not be written; falling back to isolated offline storage"
  else
    log "Auto deploy: local NAS guard could not be written; offline storage mode remains active"
  fi
fi
if ! compose up -d --no-deps --force-recreate --remove-orphans app >/dev/null \
  || ! wait_for_healthy \
  || ! legacy_video_worker_is_absent \
  || ! reload_nginx; then
  release_recreate_lock
  archive_app_logs "failed-${target_sha:0:12}"
  record_failed_deployment "$target_sha" "container-health"
  rollback "$previous_sha" || true
  send_deploy_error_event "$target_sha" "container-health"
  exit 1
fi
release_recreate_lock

rm -f "$FAILED_SHA_FILE" "$FAILED_DETAIL_FILE"
log "Auto deploy: commit $target_sha is healthy (deployment $APP_DEPLOYMENT_VERSION)"
