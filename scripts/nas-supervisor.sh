#!/usr/bin/env bash

set -Eeuo pipefail

# launchd and non-login SSH sessions use a minimal PATH that does not include Docker Desktop CLI.
# launchd 与非登录 SSH 的 PATH 不包含 Docker Desktop CLI，必须在脚本内固定补齐。
export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/bin:/bin:/usr/sbin:/sbin"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$PROJECT_ROOT/scripts/lock-utils.sh"
if ! register_lock_protocol_process; then
  printf 'NAS supervisor: cannot register the current lock protocol process\n' >&2
  exit 1
fi
trap 'unregister_lock_protocol_process' EXIT
ENV_FILE="${FG_NAS_ENV_FILE:-$PROJECT_ROOT/.env.docker}"
# Keep supervisor events beside monitor state so they survive app outages.
# 将守护事件放在监控器的持久状态目录中，确保 App 离线时仍可等待投递。
export FG_MONITOR_STATE_DIR="${FG_MONITOR_STATE_DIR:-$HOME/Library/Application Support/fg-studio-monitor}"
source "$PROJECT_ROOT/scripts/observability-outbox.sh"
APP_SERVICE="app"
APP_CONTAINER_PATH="/data/media"
# Docker Desktop API calls spike to 6-13s on the host; the timeout must exceed that.
# 宿主机上 Docker Desktop API 偶发 6-13 秒延迟，超时必须大于该尖刺，否则会误判为故障。
DOCKER_TIMEOUT_SECONDS=20
DEFAULT_MARKER_NAME=".fg-studio-nas-ready"
STATE_ROOT="${TMPDIR:-/tmp}/fg-studio-nas-supervisor-$(id -u)"
PERSISTENT_STATE_ROOT="$HOME/Library/Application Support/fg-studio-nas-supervisor"
NAS_GUARD_ROOT="$HOME/Library/Application Support/fg-studio-nas-state"
NAS_DISABLED_HOST_FILE="$NAS_GUARD_ROOT/disabled"
STATE_FILE="$STATE_ROOT/state"
LAST_SUCCESS_FILE="$STATE_ROOT/last-storage-success"
LOCK_FILE="$STATE_ROOT/lock"
MOUNT_RETRY_FILE="$STATE_ROOT/last-mount-attempt"
RECOVERY_PENDING_FILE="$PERSISTENT_STATE_ROOT/recovery-pending"
KEYCHAIN_SERVICE="com.fgstudio.nas-supervisor.smb"
RECREATE_LOCK_FILE="$HOME/Library/Application Support/fg-studio-app-recreate/lock"
RECREATE_LOCK_HELD=0
STATE_TRANSITION_SEQUENCE=0
COMPOSE_STORAGE_MODE="offline"
APP_DISABLED_FILE="/tmp/fg-studio-nas-disabled"
MOUNT_REQUESTED=0

mkdir -p "$STATE_ROOT" "$PERSISTENT_STATE_ROOT" "$NAS_GUARD_ROOT"
LEGACY_LOCK_STATUS=0
cleanup_legacy_lock_directory "$LOCK_FILE" || LEGACY_LOCK_STATUS=$?
if (( LEGACY_LOCK_STATUS == 1 )); then
  exit 0
fi
if (( LEGACY_LOCK_STATUS != 0 )); then
  printf 'NAS supervisor: legacy singleton lock migration failed\n' >&2
  exit 1
fi
if ! exec 8>>"$LOCK_FILE"; then
  printf 'NAS supervisor: cannot open the singleton lock file %s\n' "$LOCK_FILE" >&2
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
  printf 'NAS supervisor: lockf failed with exit %s\n' "$LOCK_RESULT" >&2
  exit 1
fi
cleanup() {
  release_recreate_lock
  exec 8>&-
  unregister_lock_protocol_process
}
trap cleanup EXIT

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n' ' '
}

monitor_state() {
  case "$1" in
    ready) printf 'healthy' ;;
    mount-requested|app-transitioning|docker-offline|probe-unavailable|app-start-failed|config-missing|config-invalid|stop-failed) printf 'unknown' ;;
    mount-failed|nas-readonly|container-mount-failed|recovery-recreate-failed)
      printf 'unhealthy'
      ;;
    *) printf 'unknown' ;;
  esac
}

queue_state_event() {
  local previous="$1"
  local next="$2"
  local message="$3"
  local host
  local observed_at
  local event_id
  local event_key
  local mapped_state
  local payload
  local escaped_host
  local escaped_previous
  local escaped_message

  host="$(hostname -s 2>/dev/null || hostname)"
  observed_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  event_id="$(uuidgen 2>/dev/null || true)"
  if [[ -z "$event_id" ]]; then
    STATE_TRANSITION_SEQUENCE=$((STATE_TRANSITION_SEQUENCE + 1))
    event_id="$(date -u '+%Y%m%dT%H%M%S')-$$-$STATE_TRANSITION_SEQUENCE"
  fi
  event_key="nas-supervisor-${event_id}"
  mapped_state="$(monitor_state "$next")"
  escaped_host="$(json_escape "$host")"
  escaped_previous="$(json_escape "$previous")"
  escaped_message="$(json_escape "$message (rawState=$next)")"
  payload="{\"host\":\"$escaped_host\",\"service\":\"nas\",\"checkName\":\"supervisor\",\"state\":\"$mapped_state\",\"previousState\":\"$escaped_previous\",\"message\":\"$escaped_message\",\"observedAt\":\"$observed_at\",\"eventKey\":\"$event_key\"}"

  if ! fg_obs_queue_event monitor "$payload"; then
    log "NAS supervisor: observability outbox enqueue failed for state transition $previous -> $next"
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

compose() {
  local compose_files=(--file "$PROJECT_ROOT/docker-compose.yml")
  if [[ "$COMPOSE_STORAGE_MODE" == "nas" ]]; then
    compose_files+=(--file "$PROJECT_ROOT/docker-compose.nas.yml")
  fi
  docker compose "${compose_files[@]}" --project-directory "$PROJECT_ROOT" --env-file "$ENV_FILE" "$@"
}

set_state() {
  local next_state="$1"
  local message="$2"
  local current_state=""
  [[ -f "$STATE_FILE" ]] && current_state="$(<"$STATE_FILE")"
  if [[ "$current_state" != "$next_state" ]]; then
    queue_state_event "$current_state" "$next_state" "$message"
    printf '%s' "$next_state" > "$STATE_FILE"
    log "$message"
  fi
}

set_storage_ready() {
  printf '%s' "$(date +%s)" > "$LAST_SUCCESS_FILE"
  set_state "ready" "$1"
}

set_storage_guard() {
  (umask 022; : > "$NAS_DISABLED_HOST_FILE") && chmod 644 "$NAS_DISABLED_HOST_FILE"
}

mark_recovery_pending() {
  # Persist the need to refresh Docker's bind mount after the NAS becomes writable again.
  # 持久记录待恢复状态，NAS 可读写后必须重建容器以刷新 bind mount。
  if ! printf '%s' "$(date +%s)" > "$RECOVERY_PENDING_FILE"; then
    # Keep a retryable state when the durable marker cannot be written.
    # 持久标记写入失败时保留重试状态，避免下轮误判为已恢复。
    set_state "recovery-pending-write-failed" "NAS supervisor: recovery marker could not be persisted; storage guard stays active and will retry"
    return 1
  fi
}

clear_recovery_pending() {
  rm -f "$RECOVERY_PENDING_FILE"
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

find_app_container() {
  local container_ids=""
  container_ids="$(run_with_timeout "$DOCKER_TIMEOUT_SECONDS" docker ps \
    --filter label=com.docker.compose.project=fgai-app \
    --filter label=com.docker.compose.service="$APP_SERVICE" \
    --format '{{.ID}}')" || return 1
  printf '%s\n' "$container_ids" | head -n 1
}

find_app_image() {
  docker ps -a \
    --filter label=com.docker.compose.project=fgai-app \
    --filter label=com.docker.compose.service="$APP_SERVICE" \
    --format '{{.Image}}' | head -n 1
}

app_uses_nas_mount() {
  local container="$1"
  local app_env
  # Return 2 when Docker cannot confirm the mode, distinct from a confirmed offline container.
  # Docker 无法读取容器环境时返回 2，与已确认的离线容器区分开。
  if ! app_env="$(run_with_timeout 10 docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" 2>/dev/null)"; then
    return 2
  fi
  grep -Fxq 'NAS_STORAGE_MODE=nas' <<< "$app_env"
}

app_has_shared_guard_mount() {
  local container="$1"
  local mounts
  mounts="$(run_with_timeout 10 docker inspect --format '{{range .Mounts}}{{printf "%s|%s|%s\n" .Destination .Type .Source}}{{end}}' "$container" 2>/dev/null || true)"
  grep -Fqx "/run/fg-nas|bind|$NAS_GUARD_ROOT" <<< "$mounts"
}

protect_running_storage() {
  local container="$1"
  local host_guard_ready=0
  # The shared local guard works even when Docker exec or the SMB mount is stalled.
  # 本地共享守卫不依赖 Docker exec，也不会被 SMB 挂载卡住。
  if set_storage_guard 2>/dev/null; then
    host_guard_ready=1
  fi
  if (( host_guard_ready )) && app_has_shared_guard_mount "$container"; then
    return 0
  fi
  # Older containers lack the shared guard mount, so retain a container-local fallback.
  # 旧容器尚未挂载共享守卫目录时，退回写入容器本地标记。
  if run_with_timeout "$DOCKER_TIMEOUT_SECONDS" docker exec "$container" sh -c 'touch "$1"' sh "$APP_DISABLED_FILE" >/dev/null 2>&1; then
    return 0
  fi
  log "NAS supervisor: could not set the App-local NAS guard; storage probe remains failed"
  return 1
}

clear_storage_guard() {
  local container="${1:-}"
  # Remove the container-local fallback first and the shared host guard last.
  # 先清容器内备用标记，最后移除共享 host guard，避免 exec 失败时提前放开媒体 I/O。
  if [[ -n "$container" ]] && ! run_with_timeout 10 docker exec "$container" sh -c 'rm -f "$1"' sh "$APP_DISABLED_FILE" >/dev/null 2>&1; then
    return 1
  fi
  rm -f "$NAS_DISABLED_HOST_FILE"
}

acquire_recreate_lock() {
  local migration_status=0
  local lock_status=0
  mkdir -p "$(dirname "$RECREATE_LOCK_FILE")"
  cleanup_legacy_lock_directory "$RECREATE_LOCK_FILE" || migration_status=$?
  if (( migration_status == 2 )); then
    log "NAS supervisor: legacy App recreation lock migration failed"
    return 1
  fi
  if (( migration_status != 0 )); then
    return 1
  fi
  if ! exec 9>>"$RECREATE_LOCK_FILE"; then
    log "NAS supervisor: cannot open the App recreation lock file"
    return 1
  fi
  /usr/bin/lockf -s -t 0 9 || lock_status=$?
  if (( lock_status != 0 )); then
    exec 9>&-
    if (( lock_status != 75 )); then
      log "NAS supervisor: lockf failed for the App recreation lock (exit $lock_status)"
    fi
    return 1
  fi
  RECREATE_LOCK_HELD=1
}

release_recreate_lock() {
  if (( RECREATE_LOCK_HELD )); then
    exec 9>&-
    RECREATE_LOCK_HELD=0
  fi
}

start_offline_app_if_missing() {
  local container
  # Cold starts use the read-only named volume until a fresh NAS bind probe succeeds.
  # 冷启动先使用只读 named volume，直到真实 NAS bind 的新读写探测通过。
  if ! run_with_timeout "$DOCKER_TIMEOUT_SECONDS" docker info >/dev/null 2>&1; then
    set_state "docker-offline" "NAS supervisor: Docker is unavailable; waiting to start App in offline storage mode"
    return 0
  fi
  if ! container="$(find_app_container 2>/dev/null)"; then
    set_state "probe-unavailable" "NAS supervisor: Docker could not confirm whether an App container is running; refusing offline replacement"
    return 1
  fi
  if [[ -n "$container" ]]; then
    if ! protect_running_storage "$container"; then
      set_state "storage-guard-failed" "NAS supervisor: could not guard the running App; leaving it running without a NAS restart"
      return 1
    fi
    return 0
  fi
  if ! acquire_recreate_lock; then
    set_state "app-transitioning" "NAS supervisor: App recreation is already in progress; waiting before offline start"
    return 0
  fi
  COMPOSE_STORAGE_MODE="offline"
  if ! CLOUDFLARE_TUNNEL_TOKEN="${CLOUDFLARE_TUNNEL_TOKEN:-nas-supervisor-not-used}" compose up -d "$APP_SERVICE" >/dev/null; then
    release_recreate_lock
    set_state "app-start-failed" "NAS supervisor: NAS is unavailable and App could not start with isolated offline storage"
    return 1
  fi
  container="$(find_app_container 2>/dev/null || true)"
  release_recreate_lock
  if [[ -z "$container" ]]; then
    set_state "app-start-failed" "NAS supervisor: offline Compose start returned without a running App container"
    return 1
  fi
  set_state "nas-offline-app-running" "NAS supervisor: App is running with NAS storage isolated; media operations are disabled"
}

restore_offline_app_after_recreate_failure() {
  # Keep the guarded App available when NAS recovery recreation cannot finish.
  # NAS 恢复重建失败时，先守卫现有 App 或启动离线 App，再等待下一轮探测。
  local reason="$1"
  local container=""

  if ! set_storage_guard 2>/dev/null; then
    container="$(find_app_container 2>/dev/null || true)"
    if [[ -n "$container" ]] && ! protect_running_storage "$container"; then
      release_recreate_lock
      set_state "storage-guard-failed" "NAS supervisor: $reason; the running App could not be guarded"
      return 1
    fi
  fi

  release_recreate_lock
  COMPOSE_STORAGE_MODE="offline"
  if ! start_offline_app_if_missing; then
    set_state "app-start-failed" "NAS supervisor: $reason; offline App fallback failed"
    return 1
  fi
  container="$(find_app_container 2>/dev/null || true)"
  if [[ -z "$container" ]]; then
    set_state "app-start-failed" "NAS supervisor: $reason; offline fallback has no confirmed running App"
    return 1
  fi
  if ! mark_recovery_pending; then
    log "NAS supervisor: could not persist recovery state after offline fallback; App remains guarded"
    return 1
  fi
  set_state "recovery-recreate-failed" "NAS supervisor: $reason; App remains running with NAS storage guarded"
}

probe_running_storage() {
  local container="$1"
  local marker_path="$APP_CONTAINER_PATH/$MARKER_NAME"
  local probe_path="$APP_CONTAINER_PATH/.fg-studio-container-probe"
  # Keep one stable probe because deleting an open SMB file creates persistent .smbdelete files.
  # 保留单个稳定探针，避免删除 SMB 占用文件后持续产生 .smbdelete 文件。
  run_with_timeout "$DOCKER_TIMEOUT_SECONDS" docker exec "$container" sh -c \
    'lock=/tmp/fg-studio-storage-probe-lock;
     if ! mkdir "$lock" 2>/dev/null; then
       owner=$(cat "$lock/pid" 2>/dev/null || true);
       case "$owner" in ""|*[!0-9]*) exit 20;; esac;
       kill -0 "$owner" 2>/dev/null && exit 20;
       rm -f "$lock/pid"; rmdir "$lock" 2>/dev/null || exit 20;
       mkdir "$lock" 2>/dev/null || exit 20;
     fi;
     printf "%s" "$$" > "$lock/pid";
     trap "rm -f \"$lock/pid\"; rmdir \"$lock\" 2>/dev/null || true" EXIT;
     grep -qx "fg-studio-media:v1" "$1" || exit 10;
     printf probe > "$2" || exit 11;
     grep -qx probe "$2" || exit 12' \
    sh "$marker_path" "$probe_path" >/dev/null 2>&1
}

probe_new_mount() {
  local image="$1"
  local marker_path="$APP_CONTAINER_PATH/$MARKER_NAME"
  local probe_path="$APP_CONTAINER_PATH/.fg-studio-container-probe"
  local probe_container="fg-studio-nas-probe"
  local probe_exit=0
  run_with_timeout 5 docker rm -f "$probe_container" >/dev/null 2>&1 || true
  run_with_timeout 5 docker run --rm --name "$probe_container" \
    --mount "type=bind,source=$NAS_PATH,target=$APP_CONTAINER_PATH" \
    --entrypoint sh "$image" -c \
    'grep -qx "fg-studio-media:v1" "$1" || exit 10; printf probe > "$2" || exit 11; grep -qx probe "$2" || exit 12' \
    sh "$marker_path" "$probe_path" >/dev/null 2>&1 || probe_exit=$?
  run_with_timeout 5 docker rm -f "$probe_container" >/dev/null 2>&1 || true
  return "$probe_exit"
}

request_mount() {
  local mount_url="$1"
  local smb_user="$2"
  local now
  local last_attempt=0
  local mount_exit=0
  now="$(date +%s)"
  [[ -f "$MOUNT_RETRY_FILE" ]] && last_attempt="$(<"$MOUNT_RETRY_FILE")"
  if ((now - last_attempt < 30)); then
    return
  fi
  printf '%s' "$now" > "$MOUNT_RETRY_FILE"

  # Read and encode the secret inside JXA so it never appears in shell arguments, environment, or logs.
  # 在 JXA 内部读取并编码凭据，避免密码出现在 Shell 参数、环境变量或日志中。
  export FG_NAS_MOUNT_URL="$mount_url"
  export FG_NAS_MOUNT_USER="$smb_user"
  export FG_NAS_KEYCHAIN_SERVICE="$KEYCHAIN_SERVICE"
  run_with_timeout 20 /usr/bin/osascript -l JavaScript \
    -e 'ObjC.import("stdlib");' \
    -e 'const app = Application.currentApplication();' \
    -e 'app.includeStandardAdditions = true;' \
    -e 'const env = name => ObjC.unwrap($.getenv(name));' \
    -e 'const shellQuote = value => `\u0027${value.replace(/\u0027/g, `\u0027\\\u0027\u0027`)}\u0027`;' \
    -e 'const mountUrl = env("FG_NAS_MOUNT_URL");' \
    -e 'const mountUser = env("FG_NAS_MOUNT_USER");' \
    -e 'const keychainService = env("FG_NAS_KEYCHAIN_SERVICE");' \
    -e 'const password = app.doShellScript(`/usr/bin/security find-generic-password -a ${shellQuote(mountUser)} -s ${shellQuote(keychainService)} -w`);' \
    -e 'const shareUrl = mountUrl.replace(/^smb:\/\/[^@]*@/, "smb://");' \
    -e 'const credentialUrl = `smb://${encodeURIComponent(mountUser)}:${encodeURIComponent(password)}@${shareUrl.slice(6)}`;' \
    -e 'app.mountVolume(credentialUrl);' \
    >/dev/null 2>&1 || mount_exit=$?
  unset FG_NAS_MOUNT_URL FG_NAS_MOUNT_USER FG_NAS_KEYCHAIN_SERVICE
  return "$mount_exit"
}

request_mount_for_recovery() {
  (( MOUNT_REQUESTED == 0 )) || return 0
  MOUNT_REQUESTED=1
  if request_mount "$MOUNT_URL" "$SMB_USER"; then
    log "NAS supervisor: requested SMB recovery while the mount entry is still present"
    return 0
  fi
  log "NAS supervisor: SMB recovery request failed; App remains running with storage guarded"
  return 1
}

if [[ ! -f "$ENV_FILE" ]]; then
  if ! set_storage_guard 2>/dev/null; then
    log "NAS supervisor: local NAS guard could not be written; checking the running App's local guard"
  fi
  if run_with_timeout "$DOCKER_TIMEOUT_SECONDS" docker info >/dev/null 2>&1; then
    if ! APP_CONTAINER="$(find_app_container 2>/dev/null)"; then
      set_state "probe-unavailable" "NAS supervisor: environment file is missing and Docker could not confirm the running App"
      exit 1
    fi
      if [[ -n "$APP_CONTAINER" ]] && ! protect_running_storage "$APP_CONTAINER"; then
        set_state "storage-guard-failed" "NAS supervisor: environment file is missing and the running App could not be guarded"
        mark_recovery_pending
        exit 1
    fi
  fi
  mark_recovery_pending
  set_state "config-missing" "NAS supervisor: environment file is missing; App remains running with NAS storage guarded"
  exit 1
fi
NAS_PATH="$(read_env_value NAS_MEDIA_PATH)"
EXPECTED_HOST="$(read_env_value NAS_EXPECTED_HOST)"
EXPECTED_SHARE="$(read_env_value NAS_EXPECTED_SHARE)"
MARKER_NAME="$(read_env_value NAS_READY_MARKER)"
MOUNT_URL="$(read_env_value NAS_MOUNT_URL)"
MARKER_NAME="${MARKER_NAME:-$DEFAULT_MARKER_NAME}"
SMB_USER="${MOUNT_URL#smb://}"
SMB_USER="${SMB_USER%%@*}"

if [[ -z "$NAS_PATH" || "$NAS_PATH" != /* || -z "$EXPECTED_HOST" || -z "$EXPECTED_SHARE" || "$MOUNT_URL" != smb://*@* || -z "$SMB_USER" ]]; then
  start_offline_app_if_missing || exit 1
  if ! set_storage_guard 2>/dev/null; then
    log "NAS supervisor: local guard unavailable; offline media volume or App-local guard remains active"
  fi
  mark_recovery_pending
  set_state "config-invalid" "NAS supervisor: NAS configuration is invalid; App remains running and storage stays guarded"
  exit 0
fi

CURRENT_STATE=""
[[ -f "$STATE_FILE" ]] && CURRENT_STATE="$(<"$STATE_FILE")"
case "$CURRENT_STATE" in
  mount-requested|mount-failed|nas-readonly|container-mount-failed|recovery-recreate-failed|recovery-pending-write-failed|storage-guard-failed|stop-failed|config-invalid|app-start-failed|docker-offline|probe-unavailable)
    if ! set_storage_guard 2>/dev/null; then
      log "NAS supervisor: shared guard could not be refreshed; checking the running App's local guard"
    fi
    if run_with_timeout "$DOCKER_TIMEOUT_SECONDS" docker info >/dev/null 2>&1; then
      if ! CURRENT_APP="$(find_app_container 2>/dev/null)"; then
        set_state "probe-unavailable" "NAS supervisor: Docker could not confirm the running App during pending recovery"
        exit 1
      fi
      if [[ -n "$CURRENT_APP" ]] && ! protect_running_storage "$CURRENT_APP"; then
        set_state "storage-guard-failed" "NAS supervisor: previous recovery is pending but the running App could not be guarded"
        mark_recovery_pending
        exit 1
      fi
    fi
    mark_recovery_pending
    ;;
esac

# Read the mount table before touching the network path so a stale SMB session cannot block the supervisor.
# 先读取挂载表再访问网络目录，避免失效的 SMB 会话永久阻塞守护进程。
read_expected_mount_point() {
  local mount_line
  mount_line="$(/sbin/mount | awk -v source="@$EXPECTED_HOST/$EXPECTED_SHARE on " 'index($0, source) { print; exit }')" || return 1
  [[ -n "$mount_line" ]] || return 1
  sed -E 's#^.* on (.*) \(smbfs,.*$#\1#' <<< "$mount_line"
}

# `mount` can return transiently empty or stale output while the SMB client renegotiates
# a keepalive, even though the share stays mounted; retry once before treating it as gone.
# `mount` 在 SMB 客户端重协商 keepalive 时可能瞬时返回空或过期结果，即使挂载点仍在；
# 判定为挂载丢失前先重试一次，避免命令输出抖动误杀正在运行的 App。
MOUNT_POINT="$(read_expected_mount_point)" || MOUNT_POINT=""
if [[ -z "$MOUNT_POINT" ]]; then
  sleep 1
  MOUNT_POINT="$(read_expected_mount_point)" || MOUNT_POINT=""
fi
if [[ -z "$MOUNT_POINT" || ( "$NAS_PATH" != "$MOUNT_POINT" && "$NAS_PATH" != "$MOUNT_POINT/"* ) ]]; then
  if ! set_storage_guard 2>/dev/null; then
    log "NAS supervisor: shared guard could not be written; checking the running App's local guard"
  fi
  if ! run_with_timeout "$DOCKER_TIMEOUT_SECONDS" docker info >/dev/null 2>&1; then
    if ! set_storage_guard 2>/dev/null; then
      mark_recovery_pending
      set_state "storage-guard-failed" "NAS supervisor: Docker is unavailable and no storage guard could be confirmed; delaying SMB recovery"
    else
      mark_recovery_pending
      set_state "docker-offline" "NAS supervisor: Docker is unavailable; shared guard was written and SMB recovery is deferred"
    fi
    exit 0
  fi
  if ! APP_CONTAINER="$(find_app_container 2>/dev/null)"; then
    mark_recovery_pending
    set_state "probe-unavailable" "NAS supervisor: Docker could not confirm the running App; delaying SMB recovery"
    exit 0
  fi
  if [[ -n "$APP_CONTAINER" ]] && ! protect_running_storage "$APP_CONTAINER"; then
    mark_recovery_pending
    set_state "storage-guard-failed" "NAS supervisor: could not guard the running App; leaving it running while NAS is unavailable"
    exit 1
  fi
  APP_START_FAILED=0
  if [[ -z "$APP_CONTAINER" ]] && ! start_offline_app_if_missing; then
    APP_START_FAILED=1
  fi
  if [[ -z "$APP_CONTAINER" && "$APP_START_FAILED" == 0 ]]; then
    if ! APP_CONTAINER="$(find_app_container 2>/dev/null)" || [[ -z "$APP_CONTAINER" ]]; then
      APP_START_FAILED=1
    fi
  fi
  if [[ "$APP_START_FAILED" == 1 ]]; then
    mark_recovery_pending
    set_state "app-start-failed" "NAS supervisor: offline App could not be confirmed; deferring SMB recovery while keeping NAS storage guarded"
    exit 0
  fi
  mark_recovery_pending
  if request_mount "$MOUNT_URL" "$SMB_USER"; then
    set_state "mount-requested" "NAS supervisor: SMB mount requested; App remains running and storage stays guarded"
  else
    set_state "mount-failed" "NAS supervisor: SMB mount failed; App remains running and storage stays guarded; check the dedicated Keychain credential"
  fi
  exit 0
fi

if ! run_with_timeout "$DOCKER_TIMEOUT_SECONDS" docker info >/dev/null 2>&1; then
  if ! set_storage_guard 2>/dev/null; then
    log "NAS supervisor: Docker is unavailable and the shared NAS guard could not be written"
  fi
  mark_recovery_pending
  set_state "docker-offline" "NAS supervisor: Docker is unavailable; waiting"
  exit 0
fi

if ! APP_CONTAINER="$(find_app_container 2>/dev/null)"; then
  if ! set_storage_guard 2>/dev/null; then
    log "NAS supervisor: Docker could not list App and the shared NAS guard could not be written"
  fi
  mark_recovery_pending
  set_state "probe-unavailable" "NAS supervisor: Docker could not list the App container"
  exit 1
fi
if [[ -z "$APP_CONTAINER" ]]; then
  if ! start_offline_app_if_missing; then
    exit 1
  fi
  APP_CONTAINER="$(find_app_container 2>/dev/null || true)"
  if [[ -z "$APP_CONTAINER" ]]; then
    set_state "app-transitioning" "NAS supervisor: waiting for the offline App start or an active deployment"
    exit 0
  fi
fi
if [[ -n "$APP_CONTAINER" ]] && app_uses_nas_mount "$APP_CONTAINER"; then
  STORAGE_PROBE_EXIT=0
  probe_running_storage "$APP_CONTAINER" || STORAGE_PROBE_EXIT=$?
  STORAGE_FIRST_EXIT="$STORAGE_PROBE_EXIT"
  if (( STORAGE_PROBE_EXIT != 0 )); then
    if ! protect_running_storage "$APP_CONTAINER"; then
      set_state "storage-guard-failed" "NAS supervisor: could not guard the running App; leaving it running without a NAS restart"
      mark_recovery_pending
      exit 1
    fi
    mark_recovery_pending
    # Retry once to separate a transient Docker exec failure from NAS I/O failure.
    # 重试一次，区分 Docker exec 瞬时失败与 NAS 实际读写失败。
    STORAGE_RETRY_EXIT=0
    probe_running_storage "$APP_CONTAINER" || STORAGE_RETRY_EXIT=$?
    if (( STORAGE_RETRY_EXIT == 0 )); then
      STORAGE_PROBE_EXIT=0
    else
      STORAGE_PROBE_EXIT="$STORAGE_RETRY_EXIT"
    fi
  fi
  if (( STORAGE_PROBE_EXIT == 0 )); then
    if [[ ! -f "$RECOVERY_PENDING_FILE" ]]; then
      if ! acquire_recreate_lock; then
        set_state "app-transitioning" "NAS supervisor: App deployment is in progress; keeping the NAS guard until it finishes"
        exit 0
      fi
      if ! clear_storage_guard "$APP_CONTAINER"; then
        release_recreate_lock
        set_state "storage-guard-failed" "NAS supervisor: storage probe passed but the local NAS guard could not be cleared"
        exit 1
      fi
      set_storage_ready "NAS supervisor: mounted App storage is readable and writable"
      release_recreate_lock
      exit 0
    fi
    log "NAS supervisor: storage recovered; verifying a fresh bind mount before restarting App"
  else
    CURRENT_APP="$(find_app_container 2>/dev/null || true)"
    if [[ "$CURRENT_APP" != "$APP_CONTAINER" ]]; then
      set_state "app-transitioning" "NAS supervisor: App container changed during storage probe; waiting"
      exit 0
    fi
    SMB_PORT_STATUS="unreachable"
    if run_with_timeout 4 /usr/bin/nc -G 2 -z "$EXPECTED_HOST" 445 >/dev/null 2>&1; then
      SMB_PORT_STATUS="reachable"
    fi
    # A timed-out probe with SMB reachable is uncertain Docker control-plane state, not proof of a NAS failure.
    # SMB 可达时探针超时只代表 Docker 状态不确定，不能据此认定 NAS 故障。
    PROBE_UNCONFIRMED=0
    NAS_FAILURE_CONFIRMED=0
    for probe_exit in "$STORAGE_FIRST_EXIT" "$STORAGE_RETRY_EXIT"; do
      if (( probe_exit >= 10 && probe_exit <= 12 )); then
        NAS_FAILURE_CONFIRMED=1
        continue
      fi
      if (( probe_exit == 137 || probe_exit == 143 )) && [[ "$SMB_PORT_STATUS" == "unreachable" ]]; then
        NAS_FAILURE_CONFIRMED=1
        continue
      fi
      PROBE_UNCONFIRMED=1
    done
    if (( NAS_FAILURE_CONFIRMED || PROBE_UNCONFIRMED )); then
      mark_recovery_pending
    fi
    if (( NAS_FAILURE_CONFIRMED )); then
      request_mount_for_recovery || true
    fi
    CURRENT_STATE=""
    [[ -f "$STATE_FILE" ]] && CURRENT_STATE="$(<"$STATE_FILE")"
    if [[ "$CURRENT_STATE" == "recovery-recreate-failed" ]]; then
      mark_recovery_pending
      set_state "recovery-recreate-failed" "NAS supervisor: App storage is still unavailable or unconfirmed after recovery restart; App remains running"
      exit 0
    fi
    if (( PROBE_UNCONFIRMED )); then
      set_state "probe-unavailable" "NAS supervisor: Docker exec could not confirm App storage ($STORAGE_FIRST_EXIT/$STORAGE_RETRY_EXIT; TCP 445=$SMB_PORT_STATUS); App remains running"
      exit 0
    fi
    mark_recovery_pending
    set_state "container-mount-failed" "NAS supervisor: App storage probe failed ($STORAGE_FIRST_EXIT/$STORAGE_RETRY_EXIT; TCP 445=$SMB_PORT_STATUS); App remains running and storage stays guarded"
  fi
fi

if [[ -n "$APP_CONTAINER" ]]; then
  # Keep offline and unconfirmed containers guarded while probing the NAS recovery path.
  # 离线或模式未知的容器在验证 NAS 恢复期间继续保持守卫。
  APP_MODE_STATUS=0
  if app_uses_nas_mount "$APP_CONTAINER"; then
    APP_MODE_STATUS=0
  else
    APP_MODE_STATUS=$?
  fi
  if (( APP_MODE_STATUS != 0 )); then
    if (( APP_MODE_STATUS == 2 )) && ! protect_running_storage "$APP_CONTAINER"; then
      set_state "storage-guard-failed" "NAS supervisor: App mode could not be inspected or safely guarded"
      mark_recovery_pending
      exit 1
    fi
    if ! set_storage_guard 2>/dev/null; then
      mark_recovery_pending
      set_state "storage-guard-failed" "NAS supervisor: could not write the local NAS guard before enabling a recovered mount"
      exit 1
    fi
    mark_recovery_pending
    log "NAS supervisor: App is offline or its storage mode is unconfirmed; verifying NAS before switching it online"
  fi
fi

CURRENT_STATE=""
[[ -f "$STATE_FILE" ]] && CURRENT_STATE="$(<"$STATE_FILE")"
if [[ "$CURRENT_STATE" == "ready" ]]; then
  # Give Docker Compose one supervisor interval to replace the app during a deployment.
  # 部署期间给 Docker Compose 一个守护周期完成 App 替换，避免并发 force-recreate 删除新容器。
  set_state "app-transitioning" "NAS supervisor: app is transitioning; waiting before recovery"
  exit 0
fi

if ! APP_IMAGE="$(find_app_image 2>/dev/null)"; then
  set_state "probe-unavailable" "NAS supervisor: Docker could not find the App image"
  exit 1
fi
APP_IMAGE="${APP_IMAGE:-fgai-app-app}"
if ! docker image inspect "$APP_IMAGE" >/dev/null 2>&1; then
  set_state "probe-unavailable" "NAS supervisor: App image is unavailable; cannot verify mounted storage"
  exit 1
fi
PROBE_EXIT=0
probe_new_mount "$APP_IMAGE" || PROBE_EXIT=$?
if (( PROBE_EXIT != 0 )); then
  if [[ -z "$APP_CONTAINER" ]]; then
    if ! set_storage_guard 2>/dev/null; then
      log "NAS supervisor: local guard unavailable; offline Compose mode still blocks App media I/O"
    fi
    if ! start_offline_app_if_missing; then
      mark_recovery_pending
      exit 1
    fi
  elif ! protect_running_storage "$APP_CONTAINER"; then
    mark_recovery_pending
    set_state "storage-guard-failed" "NAS supervisor: fresh NAS probe failed and the running App could not be guarded; leaving it running"
    exit 1
  fi
  if (( PROBE_EXIT >= 10 && PROBE_EXIT <= 12 )); then
    mark_recovery_pending
    request_mount_for_recovery || true
    set_state "nas-readonly" "NAS supervisor: fresh NAS storage probe failed at stage $PROBE_EXIT; App stays running with NAS storage disabled"
  else
    set_state "probe-unavailable" "NAS supervisor: fresh container storage probe could not complete (exit=$PROBE_EXIT); App remains unchanged"
  fi
  exit 1
fi

# Recreate the app after every recovered mount so Docker cannot retain a stale bind mount.
# 每次 NAS 恢复后都重建 App，避免 Docker 继续持有失效的 bind mount。
if ! acquire_recreate_lock; then
  set_state "app-transitioning" "NAS supervisor: App recreation is already in progress; waiting"
  exit 0
fi
# Recheck under the shared lock so a mount loss during lock acquisition cannot restart App.
# 获取共享锁后再次读写探测，避免等待期间 NAS 掉线仍触发 App 重启。
LOCKED_PROBE_EXIT=0
probe_new_mount "$APP_IMAGE" || LOCKED_PROBE_EXIT=$?
if (( LOCKED_PROBE_EXIT != 0 )); then
  APP_CONTAINER="$(find_app_container 2>/dev/null || true)"
  if [[ -n "$APP_CONTAINER" ]] && ! protect_running_storage "$APP_CONTAINER"; then
    release_recreate_lock
    mark_recovery_pending
    set_state "storage-guard-failed" "NAS supervisor: locked NAS probe failed and the running App could not be guarded"
    exit 1
  fi
  if [[ -z "$APP_CONTAINER" ]] && ! set_storage_guard 2>/dev/null; then
    log "NAS supervisor: local guard unavailable before offline fallback; base Compose remains read-only"
  fi
  release_recreate_lock
  if [[ -z "$APP_CONTAINER" ]] && ! start_offline_app_if_missing; then
    mark_recovery_pending
    exit 1
  fi
  mark_recovery_pending
  if (( LOCKED_PROBE_EXIT >= 10 && LOCKED_PROBE_EXIT <= 12 )); then
    request_mount_for_recovery || true
    set_state "nas-readonly" "NAS supervisor: locked pre-restart storage probe failed at stage $LOCKED_PROBE_EXIT; App remains running"
  else
    set_state "probe-unavailable" "NAS supervisor: locked pre-restart storage probe could not confirm NAS read/write; App remains running"
  fi
  exit 0
fi
COMPOSE_STORAGE_MODE="nas"
if ! CLOUDFLARE_TUNNEL_TOKEN="${CLOUDFLARE_TUNNEL_TOKEN:-nas-supervisor-not-used}" \
  compose up -d --no-deps --force-recreate "$APP_SERVICE" >/dev/null; then
  if ! restore_offline_app_after_recreate_failure "NAS-mounted App recreation failed"; then
    exit 1
  fi
  exit 0
fi

if ! APP_CONTAINER="$(find_app_container 2>/dev/null)"; then
  if ! restore_offline_app_after_recreate_failure "Docker could not inspect the recreated App"; then
    exit 1
  fi
  exit 0
fi
if [[ -z "$APP_CONTAINER" ]]; then
  if ! restore_offline_app_after_recreate_failure "Docker Compose returned without a running NAS App"; then
    exit 1
  fi
  exit 0
fi
RECREATED_PROBE_EXIT=0
probe_running_storage "$APP_CONTAINER" || RECREATED_PROBE_EXIT=$?
if (( RECREATED_PROBE_EXIT != 0 )); then
  if ! protect_running_storage "$APP_CONTAINER"; then
    mark_recovery_pending
    set_state "storage-guard-failed" "NAS supervisor: recreated App failed its storage probe and could not be guarded; leaving it running"
    exit 1
  fi
  mark_recovery_pending
  set_state "recovery-recreate-failed" "NAS supervisor: recreated App storage probe could not confirm NAS read/write (exit=$RECREATED_PROBE_EXIT); App remains running and storage stays guarded"
  exit 0
fi

if ! clear_storage_guard "$APP_CONTAINER"; then
  mark_recovery_pending
  set_state "storage-guard-failed" "NAS supervisor: recovered App passed read/write probe but the local guard could not be cleared"
  exit 1
fi
clear_recovery_pending
set_storage_ready "NAS supervisor: NAS recovered and app recreated"
release_recreate_lock
