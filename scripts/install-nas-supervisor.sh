#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.fgstudio.nas-supervisor"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs"
USER_DOMAIN="gui/$(id -u)"
DOCKER_BIN_DIR="$(dirname "$(command -v docker)")"
ENV_FILE="$PROJECT_ROOT/.env.docker"
KEYCHAIN_SERVICE="com.fgstudio.nas-supervisor.smb"

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

[[ -f "$ENV_FILE" ]] || { printf 'Missing environment file: %s\n' "$ENV_FILE" >&2; exit 1; }
MOUNT_URL="$(read_env_value NAS_MOUNT_URL)"
SMB_USER="${MOUNT_URL#smb://}"
SMB_USER="${SMB_USER%%@*}"
if [[ "$MOUNT_URL" != smb://*@* || -z "$SMB_USER" ]]; then
  printf 'NAS_MOUNT_URL must include the SMB account, for example smb://user@host/share\n' >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

printf 'Enter the NAS password for %s. It will be stored only in macOS Keychain.\n' "$SMB_USER"
# Let security read the secret directly so it never enters shell history, arguments, or repository files.
# 由 security 直接读取密码，避免密码进入 Shell 历史、进程参数或仓库文件。
/usr/bin/security add-generic-password -U \
  -a "$SMB_USER" \
  -s "$KEYCHAIN_SERVICE" \
  -l "FG Studio NAS supervisor" \
  -w

TEMP_PLIST="$(mktemp "${TMPDIR:-/tmp}/fg-studio-nas-supervisor.XXXXXX")"
cleanup() {
  rm -f "$TEMP_PLIST"
}
trap cleanup EXIT

cat > "$TEMP_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PROJECT_ROOT/scripts/nas-supervisor.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$DOCKER_BIN_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/fg-studio-nas-supervisor.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/fg-studio-nas-supervisor.error.log</string>
</dict>
</plist>
PLIST

plutil -lint "$TEMP_PLIST" >/dev/null
install -m 600 "$TEMP_PLIST" "$PLIST_PATH"
launchctl bootout "$USER_DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$USER_DOMAIN" "$PLIST_PATH"
launchctl kickstart -k "$USER_DOMAIN/$LABEL"

printf 'NAS supervisor installed: %s\n' "$PLIST_PATH"
