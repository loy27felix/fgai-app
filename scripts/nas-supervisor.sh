#!/usr/bin/env bash

set -Eeuo pipefail

# launchd and non-login SSH sessions use a minimal PATH that does not include Docker Desktop CLI.
# launchd 与非登录 SSH 的 PATH 不包含 Docker Desktop CLI，必须在脚本内固定补齐。
export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/bin:/bin:/usr/sbin:/sbin"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${FG_NAS_ENV_FILE:-$PROJECT_ROOT/.env.docker}"
# Keep supervisor events beside monitor state so they survive app outages.
# 将守护事件放在监控器的持久状态目录中，确保 App 离线时仍可等待投递。
export FG_MONITOR_STATE_DIR="${FG_MONITOR_STATE_DIR:-$HOME/Library/Application Support/fg-studio-monitor}"
source "$PROJECT_ROOT/scripts/observability-outbox.sh"
APP_SERVICE="app"
APP_CONTAINER_PATH="/data/media"
DEFAULT_MARKER_NAME=".fg-studio-nas-ready"
STATE_ROOT="${TMPDIR:-/tmp}/fg-studio-nas-supervisor-$(id -u)"
STATE_FILE="$STATE_ROOT/state"
LAST_SUCCESS_FILE="$STATE_ROOT/last-storage-success"
LOCK_DIR="$STATE_ROOT/lock"
MOUNT_RETRY_FILE="$STATE_ROOT/last-mount-attempt"
KEYCHAIN_SERVICE="com.fgstudio.nas-supervisor.smb"
RECREATE_LOCK_DIR="$HOME/Library/Application Support/fg-studio-app-recreate/lock"
STATE_TRANSITION_SEQUENCE=0

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
  release_recreate_lock
  rm -f "$LOCK_DIR/pid"
  rmdir "$LOCK_DIR" 2>/dev/null || true
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
    mount-failed|mount-check-unavailable|nas-readonly|container-mount-failed)
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
  docker ps \
    --filter label=com.docker.compose.project=fgai-app \
    --filter label=com.docker.compose.service="$APP_SERVICE" \
    --format '{{.ID}}' | head -n 1
}

find_app_image() {
  docker ps -a \
    --filter label=com.docker.compose.project=fgai-app \
    --filter label=com.docker.compose.service="$APP_SERVICE" \
    --format '{{.Image}}' | head -n 1
}

acquire_recreate_lock() {
  local owner_pid=""
  mkdir -p "$(dirname "$RECREATE_LOCK_DIR")"
  if ! mkdir "$RECREATE_LOCK_DIR" 2>/dev/null; then
    [[ -f "$RECREATE_LOCK_DIR/pid" ]] && owner_pid="$(<"$RECREATE_LOCK_DIR/pid")"
    if [[ "$owner_pid" =~ ^[0-9]+$ ]] && kill -0 "$owner_pid" 2>/dev/null; then
      return 1
    fi
    rm -f "$RECREATE_LOCK_DIR/pid"
    rmdir "$RECREATE_LOCK_DIR" 2>/dev/null || return 1
    mkdir "$RECREATE_LOCK_DIR" 2>/dev/null || return 1
  fi
  printf '%s' "$$" > "$RECREATE_LOCK_DIR/pid"
}

release_recreate_lock() {
  if [[ -f "$RECREATE_LOCK_DIR/pid" ]] && [[ "$(<"$RECREATE_LOCK_DIR/pid")" == "$$" ]]; then
    rm -f "$RECREATE_LOCK_DIR/pid"
    rmdir "$RECREATE_LOCK_DIR" 2>/dev/null || true
  fi
}

probe_running_storage() {
  local container="$1"
  local marker_path="$APP_CONTAINER_PATH/$MARKER_NAME"
  local probe_path="$APP_CONTAINER_PATH/.fg-studio-container-probe"
  # Keep one stable probe because deleting an open SMB file creates persistent .smbdelete files.
  # 保留单个稳定探针，避免删除 SMB 占用文件后持续产生 .smbdelete 文件。
  run_with_timeout 5 docker exec "$container" sh -c \
    'lock=/tmp/fg-studio-storage-probe-lock;
     if ! mkdir "$lock" 2>/dev/null; then
       owner=$(cat "$lock/pid" 2>/dev/null || true);
       case "$owner" in ""|*[!0-9]*) exit 20;; esac;
       kill -0 "$owner" 2>/dev/null && exit 20;
       rm -f "$lock/pid"; rmdir "$lock" 2>/dev/null || exit 20;
       mkdir "$lock" 2>/dev/null || exit 20;
     fi;
     printf "%s" "$$" > "$lock/pid";
     trap '\''rm -f "$lock/pid"; rmdir "$lock" 2>/dev/null || true'\'' EXIT;
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

stop_app() {
  local container
  local running
  container="${1:-}"
  [[ -n "$container" ]] || container="$(find_app_container 2>/dev/null)" || return 1
  if [[ -n "$container" ]]; then
    if ! run_with_timeout 15 docker stop -t 10 "$container" >/dev/null 2>&1; then
      run_with_timeout 5 docker kill "$container" >/dev/null 2>&1 || return 1
    fi
    running="$(docker ps -q --no-trunc --filter "id=$container" 2>/dev/null)" || return 1
    [[ -z "$running" ]]
  fi
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

[[ -f "$ENV_FILE" ]] || { set_state "config-missing" "NAS supervisor: environment file is missing"; exit 1; }
NAS_PATH="$(read_env_value NAS_MEDIA_PATH)"
EXPECTED_HOST="$(read_env_value NAS_EXPECTED_HOST)"
EXPECTED_SHARE="$(read_env_value NAS_EXPECTED_SHARE)"
MARKER_NAME="$(read_env_value NAS_READY_MARKER)"
MOUNT_URL="$(read_env_value NAS_MOUNT_URL)"
MARKER_NAME="${MARKER_NAME:-$DEFAULT_MARKER_NAME}"
SMB_USER="${MOUNT_URL#smb://}"
SMB_USER="${SMB_USER%%@*}"

if [[ -z "$NAS_PATH" || "$NAS_PATH" != /* || -z "$EXPECTED_HOST" || -z "$EXPECTED_SHARE" || "$MOUNT_URL" != smb://*@* || -z "$SMB_USER" ]]; then
  if ! stop_app; then
    set_state "stop-failed" "NAS supervisor: invalid NAS configuration; could not confirm app stopped"
    exit 1
  fi
  set_state "config-invalid" "NAS supervisor: NAS path, expected source, or mount URL is invalid; app stopped"
  exit 1
fi

# Read the mount table before touching the network path so a stale SMB session cannot block the supervisor.
# 先读取挂载表再访问网络目录，避免失效的 SMB 会话永久阻塞守护进程。
if ! MOUNT_LINE="$(/sbin/mount | awk -v source="@$EXPECTED_HOST/$EXPECTED_SHARE on " 'index($0, source) { print; exit }')"; then
  if ! stop_app; then
    set_state "stop-failed" "NAS supervisor: could not read SMB mount table or confirm App stopped"
    exit 1
  fi
  set_state "mount-check-unavailable" "NAS supervisor: could not read SMB mount table; app stopped"
  exit 1
fi
MOUNT_POINT="$(sed -E 's#^.* on (.*) \(smbfs,.*$#\1#' <<< "$MOUNT_LINE")"
if [[ -z "$MOUNT_LINE" || -z "$MOUNT_POINT" || ( "$NAS_PATH" != "$MOUNT_POINT" && "$NAS_PATH" != "$MOUNT_POINT/"* ) ]]; then
  if ! stop_app; then
    set_state "stop-failed" "NAS supervisor: expected SMB mount is absent; could not confirm app stopped"
    exit 1
  fi
  if request_mount "$MOUNT_URL" "$SMB_USER"; then
    set_state "mount-requested" "NAS supervisor: non-interactive SMB mount requested; app stopped until ready"
  else
    set_state "mount-failed" "NAS supervisor: non-interactive SMB mount failed; check the dedicated Keychain credential"
  fi
  exit 0
fi

if ! run_with_timeout 5 docker info >/dev/null 2>&1; then
  set_state "docker-offline" "NAS supervisor: Docker is unavailable; waiting"
  exit 0
fi

if ! APP_CONTAINER="$(find_app_container 2>/dev/null)"; then
  set_state "probe-unavailable" "NAS supervisor: Docker could not list the App container"
  exit 1
fi
if [[ -n "$APP_CONTAINER" ]]; then
  STORAGE_PROBE_EXIT=0
  probe_running_storage "$APP_CONTAINER" || STORAGE_PROBE_EXIT=$?
  if (( STORAGE_PROBE_EXIT == 0 )); then
    set_storage_ready "NAS supervisor: mounted App storage is readable and writable"
    exit 0
  fi
  # Retry once before stopping a live app; Docker exec and SMB I/O can both fail transiently.
  # 停止运行中的 App 前复核一次，避免 Docker exec 或 SMB I/O 的瞬时失败造成停机。
  STORAGE_RETRY_EXIT=0
  probe_running_storage "$APP_CONTAINER" || STORAGE_RETRY_EXIT=$?
  if (( STORAGE_RETRY_EXIT == 0 )); then
    set_storage_ready "NAS supervisor: mounted App storage recovered on retry"
    exit 0
  fi
  CURRENT_APP="$(find_app_container 2>/dev/null || true)"
  if [[ "$CURRENT_APP" != "$APP_CONTAINER" ]]; then
    set_state "app-transitioning" "NAS supervisor: App container changed during storage probe; waiting"
    exit 0
  fi
  # A timed-out Docker client does not cancel the container's filesystem I/O.
  # Treat timeouts and a still-running probe as unknown, never as permission to
  # stop/recreate a live app. Only two explicit storage failures justify that.
  if (( STORAGE_PROBE_EXIT < 10 || STORAGE_PROBE_EXIT > 12 )) \
    || (( STORAGE_RETRY_EXIT < 10 || STORAGE_RETRY_EXIT > 12 )); then
    set_state "probe-unavailable" "NAS supervisor: Docker exec could not confirm App storage ($STORAGE_PROBE_EXIT/$STORAGE_RETRY_EXIT)"
    exit 0
  fi
  if ! stop_app "$APP_CONTAINER"; then
    set_state "stop-failed" "NAS supervisor: App storage probe failed ($STORAGE_PROBE_EXIT/$STORAGE_RETRY_EXIT); could not confirm app stopped"
    exit 1
  fi
  SMB_PORT_STATUS="unreachable"
  if run_with_timeout 4 /usr/bin/nc -G 2 -z "$EXPECTED_HOST" 445 >/dev/null 2>&1; then
    SMB_PORT_STATUS="reachable"
  fi
  set_state "container-mount-failed" "NAS supervisor: running App storage probe failed twice ($STORAGE_PROBE_EXIT/$STORAGE_RETRY_EXIT); TCP 445=$SMB_PORT_STATUS; app stopped"
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
  if (( PROBE_EXIT >= 10 && PROBE_EXIT <= 12 )); then
    set_state "nas-readonly" "NAS supervisor: fresh container NAS storage probe failed at stage $PROBE_EXIT; app remains stopped"
  else
    set_state "probe-unavailable" "NAS supervisor: fresh container storage probe could not complete (exit=$PROBE_EXIT); app remains stopped"
  fi
  exit 1
fi

# Recreate the app after every recovered mount so Docker cannot retain a stale bind mount.
# 每次 NAS 恢复后都重建 App，避免 Docker 继续持有失效的 bind mount。
if ! acquire_recreate_lock; then
  set_state "app-transitioning" "NAS supervisor: App recreation is already in progress; waiting"
  exit 0
fi
if ! CLOUDFLARE_TUNNEL_TOKEN="${CLOUDFLARE_TUNNEL_TOKEN:-nas-supervisor-not-used}" \
  docker compose --project-directory "$PROJECT_ROOT" --env-file "$ENV_FILE" \
  up -d --no-deps --force-recreate "$APP_SERVICE" >/dev/null; then
  set_state "app-start-failed" "NAS supervisor: mounted storage probe passed, but Docker Compose could not start App"
  exit 1
fi

if ! APP_CONTAINER="$(find_app_container 2>/dev/null)"; then
  set_state "probe-unavailable" "NAS supervisor: Docker could not inspect the recreated App"
  exit 1
fi
if [[ -z "$APP_CONTAINER" ]]; then
  set_state "app-start-failed" "NAS supervisor: Docker Compose returned without a running App container"
  exit 1
fi
RECREATED_PROBE_EXIT=0
probe_running_storage "$APP_CONTAINER" || RECREATED_PROBE_EXIT=$?
if (( RECREATED_PROBE_EXIT != 0 )); then
  if (( RECREATED_PROBE_EXIT < 10 || RECREATED_PROBE_EXIT > 12 )); then
    set_state "probe-unavailable" "NAS supervisor: recreated App storage probe could not complete (exit=$RECREATED_PROBE_EXIT); waiting"
    exit 0
  fi
  if ! stop_app; then
    set_state "stop-failed" "NAS supervisor: recreated App storage probe failed; could not confirm app stopped"
    exit 1
  fi
  set_state "container-mount-failed" "NAS supervisor: recreated App storage probe failed; app stopped"
  exit 1
fi

set_storage_ready "NAS supervisor: NAS recovered and app recreated"
release_recreate_lock
