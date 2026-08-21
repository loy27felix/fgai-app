#!/usr/bin/env bash

set -Eeuo pipefail

# launchd and non-login SSH sessions use a minimal PATH that does not include Docker Desktop CLI.
# launchd 与非登录 SSH 的 PATH 不包含 Docker Desktop CLI，必须在脚本内固定补齐。
export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/bin:/bin:/usr/sbin:/sbin"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${FG_NAS_ENV_FILE:-$PROJECT_ROOT/.env.docker}"
APP_SERVICE="app"
APP_CONTAINER_PATH="/data/media"
DEFAULT_MARKER_NAME=".fg-studio-nas-ready"
STATE_ROOT="${TMPDIR:-/tmp}/fg-studio-nas-supervisor-$(id -u)"
STATE_FILE="$STATE_ROOT/state"
LOCK_DIR="$STATE_ROOT/lock"
MOUNT_RETRY_FILE="$STATE_ROOT/last-mount-attempt"
KEYCHAIN_SERVICE="com.fgstudio.nas-supervisor.smb"

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
    printf '%s' "$next_state" > "$STATE_FILE"
    log "$message"
  fi
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
  docker ps -a \
    --filter label=com.docker.compose.project=fgai-app \
    --filter label=com.docker.compose.service="$APP_SERVICE" \
    --format '{{.Names}}' | head -n 1
}

probe_running_container() {
  local container="$1"
  local marker_path="$APP_CONTAINER_PATH/$MARKER_NAME"
  local probe_path="$APP_CONTAINER_PATH/.fg-studio-container-probe"
  # Keep one stable probe because deleting an open SMB file creates persistent .smbdelete files.
  # 保留单个稳定探针，避免删除 SMB 占用文件后持续产生 .smbdelete 文件。
  run_with_timeout 5 docker exec "$container" sh -c \
    'grep -qx "fg-studio-media:v1" "$1" && printf probe > "$2"' \
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
    'if [ ! -f "$1" ]; then printf "%s\n" "fg-studio-media:v1" > "$1"; fi; grep -qx "fg-studio-media:v1" "$1" && printf probe > "$2"' \
    sh "$marker_path" "$probe_path" >/dev/null 2>&1 || probe_exit=$?
  run_with_timeout 5 docker rm -f "$probe_container" >/dev/null 2>&1 || true
  return "$probe_exit"
}

stop_app() {
  local container
  container="$(find_app_container 2>/dev/null || true)"
  if [[ -n "$container" ]] && [[ "$(docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null || true)" == "true" ]]; then
    if ! run_with_timeout 15 docker stop -t 10 "$container" >/dev/null 2>&1; then
      run_with_timeout 5 docker kill "$container" >/dev/null 2>&1 || true
    fi
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
  stop_app
  set_state "config-invalid" "NAS supervisor: NAS path, expected source, or mount URL is invalid; app stopped"
  exit 1
fi

if ! run_with_timeout 4 /usr/bin/nc -G 2 -z "$EXPECTED_HOST" 445 >/dev/null 2>&1; then
  stop_app
  set_state "nas-offline" "NAS supervisor: SMB server is unreachable; app stopped"
  exit 0
fi

# Read the mount table before touching the network path so a stale SMB session cannot block the supervisor.
# 先读取挂载表再访问网络目录，避免失效的 SMB 会话永久阻塞守护进程。
MOUNT_LINE="$(/sbin/mount | awk -v host="$EXPECTED_HOST" -v share="/$EXPECTED_SHARE on " 'index($0, host) && index($0, share) { print; exit }')"
MOUNT_POINT="$(sed -E 's#^.* on (.*) \(smbfs,.*$#\1#' <<< "$MOUNT_LINE")"
if [[ -z "$MOUNT_LINE" || -z "$MOUNT_POINT" || ( "$NAS_PATH" != "$MOUNT_POINT" && "$NAS_PATH" != "$MOUNT_POINT/"* ) ]]; then
  stop_app
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

APP_CONTAINER="$(find_app_container 2>/dev/null || true)"
if [[ -n "$APP_CONTAINER" ]] && [[ "$(docker inspect --format '{{.State.Running}}' "$APP_CONTAINER" 2>/dev/null || true)" == "true" ]]; then
  if probe_running_container "$APP_CONTAINER"; then
    set_state "ready" "NAS supervisor: NAS and app are healthy"
    exit 0
  fi
  stop_app
  set_state "app-unhealthy" "NAS supervisor: running app lost NAS access; recovering"
fi

CURRENT_STATE=""
[[ -f "$STATE_FILE" ]] && CURRENT_STATE="$(<"$STATE_FILE")"
if [[ "$CURRENT_STATE" == "ready" ]]; then
  # Give Docker Compose one supervisor interval to replace the app during a deployment.
  # 部署期间给 Docker Compose 一个守护周期完成 App 替换，避免并发 force-recreate 删除新容器。
  set_state "app-transitioning" "NAS supervisor: app is transitioning; waiting before recovery"
  exit 0
fi

APP_IMAGE="$(docker inspect --format '{{.Config.Image}}' "$APP_CONTAINER" 2>/dev/null || true)"
APP_IMAGE="${APP_IMAGE:-fgai-app-app}"
if ! docker image inspect "$APP_IMAGE" >/dev/null 2>&1 || ! probe_new_mount "$APP_IMAGE"; then
  stop_app
  set_state "nas-readonly" "NAS supervisor: Docker write probe failed; app stopped"
  exit 1
fi

# Recreate the app after every recovered mount so Docker cannot retain a stale bind mount.
# 每次 NAS 恢复后都重建 App，避免 Docker 继续持有失效的 bind mount。
CLOUDFLARE_TUNNEL_TOKEN="${CLOUDFLARE_TUNNEL_TOKEN:-nas-supervisor-not-used}" \
  docker compose --project-directory "$PROJECT_ROOT" --env-file "$ENV_FILE" \
  up -d --no-deps --force-recreate "$APP_SERVICE" >/dev/null

APP_CONTAINER="$(find_app_container)"
if [[ -z "$APP_CONTAINER" ]] || ! probe_running_container "$APP_CONTAINER"; then
  stop_app
  set_state "container-mount-failed" "NAS supervisor: container cannot see NAS marker; app stopped"
  exit 1
fi

set_state "ready" "NAS supervisor: NAS recovered and app recreated"
