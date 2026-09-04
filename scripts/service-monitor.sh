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
MAX_APP_ERROR_LINES_PER_RUN="${FG_MONITOR_MAX_APP_ERROR_LINES_PER_RUN:-200}"
MAX_APP_ERROR_EVENTS_PER_RUN="${FG_MONITOR_MAX_APP_ERROR_EVENTS_PER_RUN:-20}"
USER_DOMAIN="gui/$(id -u)"
AUTO_DEPLOY_LABEL="com.fgstudio.auto-deploy"
AUTO_DEPLOY_PLIST="$HOME/Library/LaunchAgents/$AUTO_DEPLOY_LABEL.plist"

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

app_base_url() {
  local app_host_port
  app_host_port="$(read_env_value FG_APP_HOST_PORT)"
  [[ "$app_host_port" =~ ^[0-9]+$ ]] || app_host_port=3000
  printf 'http://127.0.0.1:%s' "$app_host_port"
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n' ' '
}

observability_secret() {
  local secret
  secret="$(read_env_value FG_OBSERVABILITY_SECRET)"
  printf '%s' "${secret:-$(read_env_value SESSION_SECRET)}"
}

send_monitor_event() {
  local service="$1"
  local state="$2"
  local previous="$3"
  local message="$4"
  local secret
  local endpoint
  local base_url
  local host
  local event_key
  local payload
  secret="$(observability_secret)"
  [[ -n "$secret" ]] || return 0
  base_url="$(read_env_value FG_OBSERVABILITY_URL)"
  base_url="${base_url:-$(app_base_url)}"
  endpoint="${base_url%/}/api/observability/monitor-events"
  host="$(hostname -s 2>/dev/null || hostname)"
  event_key="monitor-${host}-${service}-$(date -u '+%Y%m%dT%H%M%SZ')"
  payload="{\"host\":\"$(json_escape "$host")\",\"service\":\"$(json_escape "$service")\",\"checkName\":\"health\",\"state\":\"$(json_escape "$state")\",\"previousState\":\"$(json_escape "$previous")\",\"message\":\"$(json_escape "$message")\",\"eventKey\":\"$(json_escape "$event_key")\"}"
  (
    /usr/bin/curl -fsS --connect-timeout 1 --max-time 2 \
      -H "x-fg-observability-secret: $secret" -H 'Content-Type: application/json' \
      -d "$payload" "$endpoint" >/dev/null 2>&1 || true
  ) &
}

send_app_error_event() {
  local line="$1"
  local secret
  local endpoint
  local base_url
  local event_key
  local payload
  secret="$(observability_secret)"
  [[ -n "$secret" ]] || return 0
  base_url="$(read_env_value FG_OBSERVABILITY_URL)"
  base_url="${base_url:-$(app_base_url)}"
  endpoint="${base_url%/}/api/observability/error-events"
  if command -v node >/dev/null 2>&1; then
    # Parse the structured application line once so the error event keeps the
    # original trace, task, route and HTTP status instead of a generic summary.
    # 解析结构化应用日志，保留原始 trace、task、route 和 HTTP 状态，避免只上报泛化摘要。
    payload="$(printf '%s\n' "$line" | node -e '
      const crypto = require("node:crypto");
      const fs = require("node:fs");
      const line = fs.readFileSync(0, "utf8").trimEnd();
      const match = line.match(/^(\S+)\s+(\{.*\})\s*$/s);
      const dockerTimestamp = match?.[1] || "";
      const raw = match?.[2] || line.trim();
      let value = {};
      try { value = JSON.parse(raw); } catch {
        const message = raw.replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]").slice(0, 1000);
        process.stdout.write(JSON.stringify({ occurredAt: dockerTimestamp || undefined, source: "app", service: "app", severity: "error", impact: "unknown", code: "app_log", message, eventKey: `app-log-${crypto.createHash("sha256").update(line).digest("hex")}` }));
        process.exit(0);
      }
      const text = (candidate, limit = 240) => typeof candidate === "string" ? candidate.trim().slice(0, limit) : "";
      const trace = text(value.traceId || value.trace_id, 128);
      const requestId = text(value.requestId || value.request_id, 160);
      const taskId = text(value.taskId || value.task_id, 160);
      const userId = text(value.userId || value.user_id || value.actorId || value.actor_id, 80);
      const route = text(value.route || value.path, 240);
      const error = value.error && typeof value.error === "object" ? value.error : {};
      const status = Number(value.httpStatus || value.http_status);
      const httpStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
      const level = text(value.level, 20).toLowerCase();
      const stage = text(value.stage, 160);
      const outcome = text(value.outcome, 80).toLowerCase();
      const source = ["frontend", "app", "provider", "infra", "deploy", "billing", "data"].includes(text(value.source, 40))
        ? text(value.source, 40)
        : value.provider ? "provider" : "app";
      const message = text(value.message || error.message || stage || value.event || raw, 1000) || "application error";
      const severity = level === "critical" ? "critical" : level === "warning" || level === "warn" ? "warning" : "error";
      const impact = httpStatus >= 500 ? "blocked" : outcome === "unknown" || /unknown|reconciliation/i.test(`${stage} ${message}`) ? "unknown" : "degraded";
      const eventKey = text(value.eventId || value.event_id, 240) || `app-log-${crypto.createHash("sha256").update(line).digest("hex")}`;
      const payload = {
        occurredAt: text(value.timestampUtc, 80) || dockerTimestamp || undefined,
        source,
        service: text(value.service || value.feature || value.provider, 80) || "app",
        feature: text(value.feature, 120) || undefined,
        action: text(value.action, 120) || undefined,
        severity,
        impact,
        code: text(value.code || value.event || stage, 160) || "app_log",
        message,
        stack: text(error.stack || value.stack, 2000) || undefined,
        traceId: /^[A-Za-z0-9._:-]{8,128}$/.test(trace) ? trace : undefined,
        requestId: requestId || undefined,
        taskId: taskId || undefined,
        userId: userId || undefined,
        route: route || undefined,
        httpStatus,
        deploymentVersion: text(value.deploymentVersion, 160) || undefined,
        eventKey,
        metadata: { appLog: value },
      };
      process.stdout.write(JSON.stringify(payload));
    ' || true)"
  else
    local occurred_at="${line%% *}"
    local message
    message="$(printf '%s' "$line" | sed -E 's/^[0-9-]+T[0-9:.+-]+Z[[:space:]]*//')"
    [[ -n "$message" ]] || return 0
    event_key="$(printf '%s' "$line" | /usr/bin/shasum -a 256 | awk '{print "app-log-" $1}')"
    payload="{\"occurredAt\":\"$(json_escape "$occurred_at")\",\"source\":\"app\",\"service\":\"app\",\"severity\":\"error\",\"impact\":\"unknown\",\"code\":\"app_log\",\"message\":\"$(json_escape "$message")\",\"eventKey\":\"$(json_escape "$event_key")\"}"
  fi
  [[ -n "$payload" ]] || return 0
  (
    /usr/bin/curl -fsS --connect-timeout 1 --max-time 2 \
      -H "x-fg-observability-secret: $secret" -H 'Content-Type: application/json' \
      -d "$payload" "$endpoint" >/dev/null 2>&1 || true
  ) &
}

structured_app_error_lines() {
  if command -v node >/dev/null 2>&1; then
    node -e '
      const readline = require("node:readline");
      const rl = readline.createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        const match = line.match(/^(\S+)\s+(\{.*\})\s*$/s);
        const raw = match?.[2] || line.trim();
        try {
          const value = JSON.parse(raw);
          if (!value || Array.isArray(value)) return;
          const level = String(value.level || "").toLowerCase();
          const stage = String(value.stage || "").toLowerCase();
          const outcome = String(value.outcome || "").toLowerCase();
          const event = String(value.event || "").toLowerCase();
          const message = String(value.message || "").toLowerCase();
          if (["error", "critical"].includes(level) || ["failed", "error", "unknown"].includes(outcome) || /failed|error/.test(stage) || /\b(fatal|panic|exception)\b/.test(`${event} ${message}`)) console.log(line);
        } catch {
          if (/\b(error|failed|failure|fatal|panic|exception)\b/i.test(line)) console.log(line);
        }
      });
    '
    return
  fi
  # macOS ships Ruby even when launchd cannot see an nvm-managed Node binary.
  # macOS 自带 Ruby；当 launchd 找不到 nvm 管理的 Node 时仍按 JSON 字段判定，不能退化为关键词误报。
  /usr/bin/ruby -rjson -e '
    STDIN.each_line do |line|
      value = JSON.parse(line.sub(/\A\S+\s+/, ""))
      next unless value.is_a?(Hash)
      level = value.fetch("level", "").to_s.downcase
      stage = value.fetch("stage", "").to_s.downcase
      outcome = value.fetch("outcome", "").to_s.downcase
      event_and_message = "#{value.fetch("event", "")} #{value.fetch("message", "")}".downcase
      failed = %w[error critical].include?(level) || %w[failed error unknown].include?(outcome) ||
        stage.match?(/failed|error/) || event_and_message.match?(/\b(fatal|panic|exception)\b/)
      puts line if failed
    rescue JSON::ParserError
      puts line if line.match?(/\b(error|failed|failure|fatal|panic|exception)\b/i)
    end
  ' || true
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
  local emit_repeated="${4:-true}"
  local state_file="$STATE_ROOT/$service.state"
  local previous=""
  [[ -f "$state_file" ]] && previous="$(<"$state_file")"
  [[ "$previous" == "$next" && "$emit_repeated" != "true" ]] || send_monitor_event "$service" "$next" "$previous" "$message"
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
  local compose_profile
  compose_profile="$(read_env_value FG_COMPOSE_PROFILE)"
  if [[ -n "$compose_profile" ]]; then
    docker compose --project-directory "$PROJECT_ROOT" --project-name fgai-app --env-file "$ENV_FILE" --profile "$compose_profile" "$@"
    return
  fi
  # Do not expand an empty Bash array under nounset when HTTPS is disabled.
  # 未启用 HTTPS 时不展开空 Bash array，避免 nounset 导致监控脚本失败。
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
  local http_status
  container="$(container_id app)"
  [[ -n "$container" ]] && health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)"
  # Probe a lightweight public endpoint instead of rendering the homepage, so monitoring measures app readiness rather than page cost.
  # 使用无需登录的轻量接口，监控应用是否就绪，而不是把首页渲染耗时误判为服务异常。
  http_status="$(/usr/bin/curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$(app_base_url)/api/version" 2>/dev/null || printf 'unreachable')"
  if [[ "$health" == "healthy" ]] && [[ "$http_status" == "200" ]]; then
    clear_failures app
    update_state app healthy "container health=healthy; HTTP /api/version=200"
  else
    update_state app unhealthy "container health=$health; HTTP /api/version=$http_status; NAS supervisor will recover it"
  fi
}

check_nginx() {
  local compose_profile
  local container
  local health="missing"
  local nginx_host_port
  local http_status

  compose_profile="$(read_env_value FG_COMPOSE_PROFILE)"
  [[ "$compose_profile" == "https" ]] || return 0
  container="$(container_id nginx)"
  [[ -n "$container" ]] && health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)"
  nginx_host_port="$(read_env_value FG_NGINX_HOST_PORT)"
  [[ "$nginx_host_port" =~ ^[0-9]+$ ]] || nginx_host_port=3000
  http_status="$(/usr/bin/curl -ksS -o /dev/null -w '%{http_code}' --max-time 5 "https://127.0.0.1:$nginx_host_port/api/version" 2>/dev/null || printf 'unreachable')"
  if [[ "$health" == "healthy" ]] && [[ "$http_status" == "200" ]]; then
    clear_failures nginx
    update_state nginx healthy "container health=healthy; HTTPS /api/version=200"
  else
    update_state nginx unhealthy "container health=$health; HTTPS /api/version=$http_status"
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
  local reported=0
  container="$(container_id app)"
  [[ -n "$container" ]] || return 0
  [[ "$MAX_APP_ERROR_LINES_PER_RUN" =~ ^[1-9][0-9]*$ ]] || MAX_APP_ERROR_LINES_PER_RUN=200
  [[ "$MAX_APP_ERROR_EVENTS_PER_RUN" =~ ^[1-9][0-9]*$ ]] || MAX_APP_ERROR_EVENTS_PER_RUN=20
  # Cap collection and HTTP fan-out so an error storm cannot create a process storm on the Docker host.
  # 限制单轮采集与 HTTP 上报数量，避免错误风暴在 Docker 主机上放大成进程风暴。
  matches="$(docker logs --since 40s --timestamps "$container" 2>&1 | structured_app_error_lines | sed -n "1,${MAX_APP_ERROR_LINES_PER_RUN}p" || true)"
  if [[ -z "$matches" ]]; then
    update_state app-errors healthy "no new error/fail events" false
    return
  fi
  count="$(printf '%s\n' "$matches" | wc -l | tr -d ' ')"
  printf '%s\n' "$matches" >> "$LOG_ROOT/app-errors.log"
  while IFS= read -r line; do
    ((reported >= MAX_APP_ERROR_EVENTS_PER_RUN)) && break
    send_app_error_event "$line"
    reported=$((reported + 1))
  done <<< "$matches"
  update_state app-errors unhealthy "$count captured error/fail log events; $reported sent to observability; details saved to $LOG_ROOT/app-errors.log" false
}

check_auto_deploy() {
  if launchctl print "$USER_DOMAIN/$AUTO_DEPLOY_LABEL" >/dev/null 2>&1; then
    update_state auto-deploy healthy "LaunchAgent is loaded"
    return
  fi

  if [[ ! -f "$AUTO_DEPLOY_PLIST" ]]; then
    update_state auto-deploy unhealthy "LaunchAgent plist is missing: $AUTO_DEPLOY_PLIST"
    return
  fi

  # Reload the missing user agent so deployment monitoring survives an unload.
  # 服务被卸载后自动重新注册，避免只能依赖人工重新安装部署守护进程。
  if launchctl bootstrap "$USER_DOMAIN" "$AUTO_DEPLOY_PLIST" >/dev/null 2>&1 \
    && launchctl kickstart -k "$USER_DOMAIN/$AUTO_DEPLOY_LABEL" >/dev/null 2>&1; then
    update_state auto-deploy healthy "LaunchAgent was reloaded by service monitor"
  else
    update_state auto-deploy unhealthy "LaunchAgent is missing and automatic reload failed"
  fi
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
check_nginx
check_postgres
check_tunnel
check_disk
check_app_errors
check_auto_deploy
