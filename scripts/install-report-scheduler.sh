#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.fgstudio.report-scheduler"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs"
USER_DOMAIN="gui/$(id -u)"
ENV_FILE="$PROJECT_ROOT/.env.docker"

[[ -f "$ENV_FILE" ]] || { printf 'Missing environment file: %s\n' "$ENV_FILE" >&2; exit 1; }

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

TEMP_PLIST="$(mktemp "${TMPDIR:-/tmp}/fg-studio-report-scheduler.XXXXXX")"
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
    <string>$PROJECT_ROOT/scripts/report-scheduler.sh</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>300</integer>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/fg-studio-report-scheduler.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/fg-studio-report-scheduler.error.log</string>
</dict>
</plist>
PLIST

plutil -lint "$TEMP_PLIST" >/dev/null
install -m 600 "$TEMP_PLIST" "$PLIST_PATH"
launchctl bootout "$USER_DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$USER_DOMAIN" "$PLIST_PATH"
launchctl kickstart -k "$USER_DOMAIN/$LABEL"

printf 'Report scheduler installed: %s\n' "$PLIST_PATH"
