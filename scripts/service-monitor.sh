#!/usr/bin/env bash

set -Eeuo pipefail

# launchd uses a minimal PATH and cannot discover Docker Desktop by default.
# launchd 默认 PATH 无法发现 Docker Desktop，监控脚本必须显式补齐。
export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/bin:/bin:/usr/sbin:/sbin"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${FG_MONITOR_ENV_FILE:-$PROJECT_ROOT/.env.docker}"
STATE_ROOT="${FG_MONITOR_STATE_DIR:-$HOME/Library/Application Support/fg-studio-monitor}"
LOG_ROOT="${FG_MONITOR_LOG_DIR:-$HOME/Library/Logs/fg-studio-monitor}"
APP_LOG_ROOT="${FG_APP_LOG_DIR:-$HOME/Library/Logs/fg-studio-app}"
LOCK_FILE="$STATE_ROOT/monitor.lock"
DISK_THRESHOLD="${FG_MONITOR_DISK_THRESHOLD:-90}"
DOCKER_TIMEOUT_SECONDS=5
MAX_OBSERVABILITY_EVENTS_PER_RUN="${FG_MONITOR_MAX_OBSERVABILITY_EVENTS_PER_RUN:-5}"
TUNNEL_FAILURE_THRESHOLD="${FG_MONITOR_TUNNEL_FAILURE_THRESHOLD:-2}"
TUNNEL_PROBE_TIMEOUT_SECONDS="${FG_MONITOR_TUNNEL_PROBE_TIMEOUT_SECONDS:-20}"
USER_DOMAIN="gui/$(id -u)"
AUTO_DEPLOY_LABEL="com.fgstudio.auto-deploy"
AUTO_DEPLOY_PLIST="$HOME/Library/LaunchAgents/$AUTO_DEPLOY_LABEL.plist"
NAS_SUPERVISOR_LABEL="com.fgstudio.nas-supervisor"
NAS_SUPERVISOR_PLIST="$HOME/Library/LaunchAgents/$NAS_SUPERVISOR_LABEL.plist"
NAS_SUPERVISOR_AGENT_STATUS="unchecked"
REPORT_SCHEDULER_LABEL="com.fgstudio.report-scheduler"
REPORT_SCHEDULER_PLIST="$HOME/Library/LaunchAgents/$REPORT_SCHEDULER_LABEL.plist"

source "$PROJECT_ROOT/scripts/observability-outbox.sh"

mkdir -p "$STATE_ROOT" "$LOG_ROOT" "$HOME/Library/Application Support/fg-studio-nas-state"
# Use an OS advisory file lock; the legacy empty directory is left untouched and ignored.
# 使用 OS advisory file lock；保留但忽略旧空目录，进程退出时内核自动释放文件锁。
if ! exec 8>>"$LOCK_FILE"; then
  printf '%s Monitor: cannot open singleton lock file %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$LOCK_FILE" >&2
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
  printf '%s Monitor: lockf failed for %s (exit %s)\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$LOCK_FILE" "$LOCK_RESULT" >&2
  exit 1
fi

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
  local host observed_at event_key payload
  local heartbeat=false
  host="$(hostname -s 2>/dev/null || hostname)"
  observed_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  event_key="monitor-${host}-${service}-$(/usr/bin/uuidgen)"
  [[ "$service" == "tunnel" || "$service" == "public-media" ]] && [[ "$state" == "unhealthy" && "$previous" == "$state" ]] && heartbeat=true
  # Queue before advancing state; retries retain the observation time and event identity.
  # 状态推进前持久化采样，重试保留原始采样时间和事件标识。
  payload="{\"observedAt\":\"$observed_at\",\"host\":\"$(json_escape "$host")\",\"service\":\"$(json_escape "$service")\",\"checkName\":\"health\",\"state\":\"$(json_escape "$state")\",\"previousState\":\"$(json_escape "$previous")\",\"message\":\"$(json_escape "$message")\",\"eventKey\":\"$(json_escape "$event_key")\",\"metadata\":{\"monitorHeartbeat\":$heartbeat}}"
  if [[ "$service" == "tunnel" || "$service" == "public-media" ]]; then
    fg_obs_queue_event monitor "$payload"
    return
  fi
  local secret base_url
  secret="$(observability_secret)"
  [[ -n "$secret" ]] || return 0
  base_url="$(read_env_value FG_OBSERVABILITY_URL)"
  base_url="${base_url:-$(app_base_url)}"
  (
    /usr/bin/curl -fsS --connect-timeout 1 --max-time 2 \
      -H "x-fg-observability-secret: $secret" -H 'Content-Type: application/json' \
      -d "$payload" "${base_url%/}/api/observability/monitor-events" >/dev/null 2>&1 || true
  ) &
}

send_app_error_event() {
  local line="$1"
  local event_key
  local payload
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
    ')" || return 1
  else
    local occurred_at="${line%% *}"
    local message
    message="$(printf '%s' "$line" | sed -E 's/^[0-9-]+T[0-9:.+-]+Z[[:space:]]*//')"
    [[ -n "$message" ]] || return 0
    event_key="$(printf '%s' "$line" | /usr/bin/shasum -a 256 | awk '{print "app-log-" $1}')"
    payload="{\"occurredAt\":\"$(json_escape "$occurred_at")\",\"source\":\"app\",\"service\":\"app\",\"severity\":\"error\",\"impact\":\"unknown\",\"code\":\"app_log\",\"message\":\"$(json_escape "$message")\",\"eventKey\":\"$(json_escape "$event_key")\"}"
  fi
  [[ -n "$payload" ]] || return 1
  fg_obs_queue_event error "$payload"
}

structured_app_error_lines() {
  # A recoverable provider poll warning keeps its diagnostic stage name but is not an application error.
  # 可恢复的供应商轮询告警会保留诊断 stage 名称，但不属于应用错误。
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
          const recoverablePoll = stage === "provider_poll_failed" && outcome === "unknown";
          if (!recoverablePoll && (["error", "critical"].includes(level) || ["failed", "error", "unknown"].includes(outcome) || /failed|error/.test(stage) || /\b(fatal|panic|exception)\b/.test(`${event} ${message}`))) console.log(line);
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
      recoverable_poll = stage == "provider_poll_failed" && outcome == "unknown"
      failed = !recoverable_poll && (%w[error critical].include?(level) || %w[failed error unknown].include?(outcome) ||
        stage.match?(/failed|error/) || event_and_message.match?(/\b(fatal|panic|exception)\b/))
      puts line if failed
    rescue JSON::ParserError
      puts line if line.match?(/\b(error|failed|failure|fatal|panic|exception)\b/i)
    end
  '
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
  # Retain unhealthy samples for availability accounting; only their log presentation is deduplicated.
  # 保留异常心跳用于可用率统计；重复异常仅在日志展示层去重。
  if [[ "$service" == "tunnel" || "$service" == "public-media" || "$previous" != "$next" || "$emit_repeated" == "true" ]]; then
    if ! send_monitor_event "$service" "$next" "$previous" "$message"; then
      log "Monitor: observability enqueue failed for $service; keeping previous state for retry"
      return 0
    fi
  fi
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

run_with_timeout() {
  local timeout_seconds="$1"
  shift
  # Isolate only this CLI process tree; never signal Docker or container services.
  # 只隔离并终止本次 CLI 进程树，超时不得停止 Docker daemon 或容器服务。
  /usr/bin/python3 -c '
import os, signal, subprocess, sys
process = subprocess.Popen(sys.argv[2:], start_new_session=True)
try:
    sys.exit(process.wait(timeout=float(sys.argv[1])))
except subprocess.TimeoutExpired:
    os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=1)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
    sys.exit(124)
' "$timeout_seconds" "$@"
}

monitor_docker() {
  run_with_timeout "$DOCKER_TIMEOUT_SECONDS" docker "$@"
}

compose() {
  local compose_profile
  compose_profile="$(read_env_value FG_COMPOSE_PROFILE)"
  if [[ -n "$compose_profile" ]]; then
    monitor_docker compose --project-directory "$PROJECT_ROOT" --project-name fgai-app --env-file "$ENV_FILE" --profile "$compose_profile" "$@"
    return
  fi
  # Do not expand an empty Bash array under nounset when HTTPS is disabled.
  # 未启用 HTTPS 时不展开空 Bash array，避免 nounset 导致监控脚本失败。
  monitor_docker compose --project-directory "$PROJECT_ROOT" --project-name fgai-app --env-file "$ENV_FILE" "$@"
}

container_id() {
  compose ps -q "$1" 2>/dev/null || true
}

check_nas() {
  local supervisor_root="${TMPDIR:-/tmp}/fg-studio-nas-supervisor-$(id -u)"
  local supervisor_state=""
  local last_success=0
  local now
  [[ -f "$supervisor_root/state" ]] && supervisor_state="$(<"$supervisor_root/state")"
  [[ -f "$supervisor_root/last-storage-success" ]] && last_success="$(<"$supervisor_root/last-storage-success")"
  [[ "$last_success" =~ ^[0-9]+$ ]] || last_success=0
  now="$(date +%s)"
  if [[ "$NAS_SUPERVISOR_AGENT_STATUS" == "missing-plist" ]]; then
    update_state nas unhealthy "NAS supervisor LaunchAgent plist is missing: $NAS_SUPERVISOR_PLIST"
  elif [[ "$NAS_SUPERVISOR_AGENT_STATUS" == "disabled" ]]; then
    update_state nas unhealthy "NAS supervisor LaunchAgent is explicitly disabled; leaving it disabled"
  elif [[ "$NAS_SUPERVISOR_AGENT_STATUS" == "bootstrap-failed" ]]; then
    update_state nas unhealthy "NAS supervisor LaunchAgent bootstrap failed; see service monitor log"
  elif [[ "$NAS_SUPERVISOR_AGENT_STATUS" == "disabled-state-unavailable" ]]; then
    update_state nas unknown "Cannot confirm whether NAS supervisor LaunchAgent is allowed to start"
  elif [[ "$NAS_SUPERVISOR_AGENT_STATUS" == "bootstrapped" ]]; then
    update_state nas unknown "NAS supervisor LaunchAgent was bootstrapped; waiting for its first storage probe"
  elif [[ "$supervisor_state" == "ready" ]] && (( now - last_success <= 25 && now >= last_success )); then
    update_state nas healthy "App container NAS read/write probe passed within 25 seconds"
  elif [[ "$supervisor_state" == "app-transitioning" || "$supervisor_state" == "mount-requested" ]]; then
    update_state nas unknown "NAS supervisor is waiting for App deployment or SMB mount"
  elif [[ -z "$supervisor_state" || "$supervisor_state" == "ready" || "$supervisor_state" == "docker-offline" || "$supervisor_state" == "probe-unavailable" || "$supervisor_state" == "app-start-failed" || "$supervisor_state" == "config-missing" || "$supervisor_state" == "config-invalid" || "$supervisor_state" == "stop-failed" ]]; then
    update_state nas unknown "NAS storage probe is unavailable or stale (supervisor=$supervisor_state)"
  else
    update_state nas unhealthy "NAS supervisor storage state=$supervisor_state"
  fi
}

ensure_nas_supervisor_agent() {
  local disabled_entry=""
  local bootstrap_error=""

  if launchctl print "$USER_DOMAIN/$NAS_SUPERVISOR_LABEL" >/dev/null 2>&1; then
    NAS_SUPERVISOR_AGENT_STATUS="loaded"
    return 0
  fi

  if [[ ! -f "$NAS_SUPERVISOR_PLIST" ]]; then
    NAS_SUPERVISOR_AGENT_STATUS="missing-plist"
    return 1
  fi

  if ! disabled_entry="$(launchctl print-disabled "$USER_DOMAIN" 2>/dev/null)"; then
    NAS_SUPERVISOR_AGENT_STATUS="disabled-state-unavailable"
    return 1
  fi
  if printf '%s\n' "$disabled_entry" | awk -v label="$NAS_SUPERVISOR_LABEL" '$1 == "\"" label "\"" && $2 == "=>" && $3 == "disabled" { found = 1 } END { exit !found }'; then
    NAS_SUPERVISOR_AGENT_STATUS="disabled"
    return 1
  fi

  # Bootstrap only an installed, enabled LaunchAgent. RunAtLoad starts its process;
  # kickstart -k could forcibly terminate an already starting NAS recovery process.
  # 仅注册已安装且允许启动的 LaunchAgent；RunAtLoad 会启动进程，kickstart -k 可能杀掉正在恢复的守护进程。
  if bootstrap_error="$(launchctl bootstrap "$USER_DOMAIN" "$NAS_SUPERVISOR_PLIST" 2>&1)"; then
    NAS_SUPERVISOR_AGENT_STATUS="bootstrapped"
    log "Monitor: NAS supervisor LaunchAgent was bootstrapped; waiting for its storage probe"
    return 0
  fi

  NAS_SUPERVISOR_AGENT_STATUS="bootstrap-failed"
  log "Monitor: NAS supervisor LaunchAgent bootstrap failed${bootstrap_error:+: $bootstrap_error}"
  return 1
}

check_app() {
  local container
  local health="missing"
  local http_status
  container="$(container_id app)"
  [[ -n "$container" ]] && health="$(monitor_docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)"
  # Probe a lightweight public endpoint instead of rendering the homepage, so monitoring measures app readiness rather than page cost.
  # 使用无需登录的轻量接口，监控应用是否就绪，而不是把首页渲染耗时误判为服务异常。
  http_status="$(/usr/bin/curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$(app_base_url)/api/version" 2>/dev/null || printf 'unreachable')"
  if [[ "$health" == "healthy" ]] && [[ "$http_status" == "200" ]]; then
    clear_failures app
    update_state app healthy "container health=healthy; HTTP /api/version=200"
  else
    update_state app unhealthy "container health=$health; HTTP /api/version=$http_status"
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
  [[ -n "$container" ]] && health="$(monitor_docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)"
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

check_nginx_5xx() {
  local compose_profile
  local container
  local cursor_file="$STATE_ROOT/nginx-log-cursor"
  local cursor="2m"
  local scan_started_at
  local host

  compose_profile="$(read_env_value FG_COMPOSE_PROFILE)"
  [[ "$compose_profile" == "https" ]] || return 0
  container="$(container_id nginx)"
  [[ -n "$container" ]] || return 0
  [[ -s "$cursor_file" ]] && cursor="$(<"$cursor_file")"
  scan_started_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  host="$(hostname -s 2>/dev/null || hostname)"
  # Stream Docker output so a long outage cannot load the full rotated log window into memory.
  # 逐行处理 Docker 输出，避免长时间中断后将整段轮转日志一次性载入内存。
  if ! monitor_docker logs --since "$cursor" --timestamps "$container" 2>/dev/null | /usr/bin/ruby -rjson -rdigest -e '
    host = ARGV.fetch(0)
    STDIN.each_line do |line|
      match = line.match(/\A(\S+)\s+(\{.*\})\s*\z/)
      next unless match
      docker_timestamp, raw = match.captures
      begin
        entry = JSON.parse(raw)
      rescue JSON::ParserError
        next
      end
      next unless entry.is_a?(Hash)
      status = Integer(entry["status"], exception: false)
      next unless status && status >= 500 && status <= 599
      trace_id = entry["traceId"].to_s
      trace_id = nil unless trace_id.match?(/\A[A-Za-z0-9._:-]{8,128}\z/)
      request_id = entry["requestId"].to_s
      request_id = nil if request_id.empty? || request_id.length > 160
      upstream_status = entry["upstreamStatus"].to_s.slice(0, 120)
      key_material = request_id ? "#{host}|#{request_id}" : "#{host}|#{docker_timestamp}|#{raw}"
      event_key = "nginx-#{Digest::SHA256.hexdigest(key_material)}"
      message = "Nginx returned HTTP #{status}"
      message += " (upstream #{upstream_status})" unless upstream_status.empty?
      payload = {
        occurredAt: entry["timestamp"].to_s.empty? ? docker_timestamp : entry["timestamp"],
        source: "infra",
        service: "nginx",
        severity: "error",
        impact: "blocked",
        code: "nginx_http_#{status}",
        message: message,
        traceId: trace_id,
        requestId: request_id,
        route: entry["uri"].to_s.slice(0, 240),
        httpStatus: status,
        eventKey: event_key,
        metadata: {
          component: "nginx",
          host: host,
          method: entry["method"].to_s.slice(0, 16),
          upstreamStatus: upstream_status,
          upstreamAddress: entry["upstreamAddress"].to_s.slice(0, 160),
          upstreamConnectTime: entry["upstreamConnectTime"].to_s.slice(0, 80),
          upstreamHeaderTime: entry["upstreamHeaderTime"].to_s.slice(0, 80),
          upstreamResponseTime: entry["upstreamResponseTime"].to_s.slice(0, 80),
          requestTime: entry["requestTime"].to_s.slice(0, 80),
          cfRay: entry["cfRay"].to_s.slice(0, 80)
        }
      }
      puts JSON.generate(payload)
    end
  ' "$host" 2>/dev/null | while IFS= read -r payload; do
    [[ -n "$payload" ]] || continue
    fg_obs_queue_event error "$payload" || exit 1
  done; then
    return 0
  fi
  # Advance only after every captured line has been safely queued; the next scan overlaps at the start time.
  # 所有采集行安全写入 outbox 后才推进游标；下轮从本轮开始时间读取，边界重复由 eventKey 去重。
  printf '%s' "$scan_started_at" > "$cursor_file"
}

flush_observability_outbox() {
  local base_url
  local secret
  base_url="$(read_env_value FG_OBSERVABILITY_URL)"
  base_url="${base_url:-$(app_base_url)}"
  secret="$(observability_secret)"
  fg_obs_flush_outbox "$base_url" "$secret" "$MAX_OBSERVABILITY_EVENTS_PER_RUN"
}

check_postgres() {
  local container
  local health="missing"
  local count
  container="$(container_id postgres)"
  [[ -n "$container" ]] && health="$(monitor_docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)"
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
  local provider_url
  local ready_output=""
  local ready_invalid=false
  local container_present=false
  local ready_exit=1
  local probe_status
  local probe_exit=0
  local count

  [[ "$TUNNEL_FAILURE_THRESHOLD" =~ ^[1-9][0-9]*$ ]] || TUNNEL_FAILURE_THRESHOLD=2
  [[ "$TUNNEL_PROBE_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || TUNNEL_PROBE_TIMEOUT_SECONDS=20

  container="$(container_id cloudflared)"
  if [[ -n "$container" ]]; then
    container_present=true
    # Capture CLI output because invalid flag order can print usage and exit successfully.
    # 捕获 CLI 输出，避免参数顺序错误时打印 usage 却返回成功造成假健康。
    ready_exit=0
    ready_output="$(monitor_docker exec "$container" cloudflared tunnel --metrics 127.0.0.1:20241 ready 2>&1)" || ready_exit=$?
  fi
  if [[ "$ready_output" =~ [Ii]ncorrect[[:space:]][Uu]sage|[Uu][Ss][Aa][Gg][Ee]:|[Uu]nknown[[:space:]]flag|flag[[:space:]]provided[[:space:]]but[[:space:]]not[[:space:]]defined ]]; then
    ready_invalid=true
    ready_exit=1
  fi

  if [[ "$ready_exit" == "0" ]]; then
    clear_failures tunnel
    update_state tunnel healthy "Cloudflare connector is ready"
  else
    count="$(failure_count tunnel)"
    if ((count >= TUNNEL_FAILURE_THRESHOLD)); then
      update_state tunnel unhealthy "Cloudflare connector not ready; container-present=$container_present; exit=$ready_exit; invalid-cli=$ready_invalid; consecutive failures=$count" false
    fi
  fi

  provider_url="$(read_env_value PROVIDER_MEDIA_URL)"
  if [[ -z "$provider_url" ]]; then
    clear_failures public-media
    update_state public-media unknown "PROVIDER_MEDIA_URL is not configured; public reachability was not checked" false
    return
  fi

  # Public reachability includes host egress, DNS and TLS; it cannot justify restarting a ready connector.
  # 公网可达性还受主机出口、DNS 和 TLS 影响；探测失败只告警，禁止主动重启 connector。
  # Allow slower public TLS handshakes while keeping each probe bounded.
  # 为公网 TLS 握手留出余量，同时限制单次探测的总等待时间。
  probe_status="$(/usr/bin/curl -sS -o /dev/null -w '%{http_code}' \
    --connect-timeout 10 --max-time "$TUNNEL_PROBE_TIMEOUT_SECONDS" \
    "$provider_url" 2>/dev/null)" || probe_exit=$?
  # Only the unsigned bare content endpoint intentionally returns 400 for missing parameters.
  # 只有未带参数的裸 content 接口预期返回 400；鉴权、限流和路由错误不能算健康。
  local expected_bad_request=false
  [[ "$provider_url" =~ ^https?://[^/]+/api/local/storage/content/?$ ]] && expected_bad_request=true
  if ((probe_exit == 0)) && { [[ "$probe_status" =~ ^2[0-9]{2}$ ]] || [[ "$probe_status" == "400" && "$expected_bad_request" == true ]]; }; then
    clear_failures public-media
    update_state public-media healthy "public media probe HTTP $probe_status"
    return
  fi

  count="$(failure_count public-media)"
  if ((count < TUNNEL_FAILURE_THRESHOLD)); then
    log "Monitor: public media probe pending - curl exit=$probe_exit; HTTP=${probe_status:-unknown}; consecutive failures=$count"
    return
  fi
  update_state public-media unhealthy "public media probe failed; curl exit=$probe_exit; HTTP=${probe_status:-unknown}; consecutive failures=$count" false
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
  local container matches_file raw_file progress_file progress last_timestamp incomplete
  local line count=0 cursor_temporary collection_exit=0
  local cursor_file
  local cursor scan_started_at
  container="$(container_id app)"
  [[ -n "$container" ]] || return 0
  scan_started_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  cursor_file="$STATE_ROOT/app-errors-$container.cursor"
  cursor="1970-01-01T00:00:00Z"
  [[ -f "$cursor_file" ]] && cursor="$(<"$cursor_file")"
  # Read a closed time window without truncation; eventKey deduplicates overlap on retry.
  # 完整读取有上界的时间窗口，失败保留游标；重读边界由 eventKey 去重。
  matches_file="$(mktemp "$STATE_ROOT/.app-errors.XXXXXX")" || { log "Monitor: cannot stage App logs; retaining cursor"; return 0; }
  raw_file="$matches_file.raw"
  progress_file="$matches_file.progress"
  if ! (umask 077; : > "$raw_file"; : > "$progress_file"); then
    rm -f "$matches_file" "$raw_file" "$progress_file" || true
    log "Monitor: cannot stage App log data; retaining cursor"
    return 0
  fi
  monitor_docker logs --since "$cursor" --until "$scan_started_at" --timestamps "$container" > "$raw_file" 2>&1 || collection_exit=$?
  # Timeout may leave useful complete records; discard only its unterminated final line.
  # 超时仍可能取得完整日志行，只舍弃最后未完成行；原始纳秒时间用于安全补采。
  if ! run_with_timeout 5 /usr/bin/python3 -c '
import re, sys
last = ""
incomplete = 0
with open(sys.argv[1], "rb") as source:
    for line in source:
        if not line.endswith(b"\n"):
            incomplete = 1
            break
        match = re.match(rb"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z)\s+", line)
        if match:
            last = match.group(1).decode("ascii")
            sys.stdout.buffer.write(line)
with open(sys.argv[2], "w") as progress:
    progress.write(last + "|" + str(incomplete))
' "$raw_file" "$progress_file" | structured_app_error_lines > "$matches_file"; then
    rm -f "$matches_file" "$raw_file" "$progress_file" || true
    log "Monitor: App log parsing failed; retaining cursor for retry"
    return 0
  fi
  progress="$(<"$progress_file")"
  last_timestamp="${progress%%|*}"
  incomplete="${progress#*|}"
  if ((collection_exit != 0)) || [[ "$incomplete" == 1 ]]; then
    if [[ -z "$last_timestamp" ]]; then
      rm -f "$matches_file" "$raw_file" "$progress_file" || true
      log "Monitor: App log collection incomplete without complete records; retaining cursor"
      return 0
    fi
    # Since is inclusive: retry all records at the last timestamp instead of skipping its peers.
    # since 包含边界，重读最后时间戳的全部记录，由 eventKey 去重而不丢同时间的其他行。
    scan_started_at="$last_timestamp"
  fi
  if [[ -s "$matches_file" ]]; then
    while IFS= read -r line; do
      if ! send_app_error_event "$line"; then
        log "Monitor: App error enqueue failed; retaining cursor for retry"
        rm -f "$matches_file" "$raw_file" "$progress_file" || true
        return 0
      fi
      count=$((count + 1))
    done < "$matches_file"
    cat "$matches_file" >> "$LOG_ROOT/app-errors.log" || log "Monitor: could not append local App error log"
    update_state app-errors unhealthy "$count error/fail log events queued for observability" false
  else
    update_state app-errors healthy "no new error/fail events" false
  fi
  rm -f "$matches_file" "$raw_file" "$progress_file" || true
  cursor_temporary="$(mktemp "$STATE_ROOT/.app-cursor.XXXXXX")" || { log "Monitor: cannot stage App cursor; next scan will retry"; return 0; }
  if ! printf '%s' "$scan_started_at" > "$cursor_temporary" || ! mv "$cursor_temporary" "$cursor_file"; then
    rm -f "$cursor_temporary" || true
    log "Monitor: could not save App log cursor; next scan will retry"
  fi
}

check_archived_app_errors() {
  local archive archive_key cursor_file done_file cursor=0
  local chunk_file matches_file progress_file progress next_cursor completed line
  [[ -d "$APP_LOG_ROOT" ]] || return 0
  # Archives are published atomically; process one bounded chunk after live sampling.
  # 归档原子发布后才采集；实时采样完成后，每轮只处理一份归档的有限完整行。
  for archive in "$APP_LOG_ROOT"/app-*.log; do
    [[ -f "$archive" ]] || continue
    archive_key="${archive##*/}"
    cursor_file="$STATE_ROOT/app-archive-$archive_key.cursor"
    done_file="$STATE_ROOT/app-archive-$archive_key.done"
    [[ -f "$done_file" ]] && continue
    [[ -f "$cursor_file" ]] && cursor="$(<"$cursor_file")"
    [[ "$cursor" =~ ^[0-9]+$ ]] || cursor=0
    chunk_file="$(mktemp "$STATE_ROOT/.archive-chunk.XXXXXX")" || { log "Monitor: cannot stage App archive; retaining cursor"; return 0; }
    matches_file="$chunk_file.errors"
    progress_file="$chunk_file.progress"
    if ! (umask 077; : > "$matches_file"; : > "$progress_file"); then
      rm -f "$chunk_file" "$matches_file" "$progress_file" || true
      log "Monitor: cannot stage App archive data; retaining cursor"
      return 0
    fi
    if ! run_with_timeout 5 /usr/bin/python3 -c '
import sys
path, offset, progress_path = sys.argv[1:]
with open(path, "rb") as archive:
    archive.seek(int(offset))
    for _ in range(100):
        line = archive.readline()
        if not line:
            break
        if not line.startswith(b"#"):
            sys.stdout.buffer.write(line)
    end = archive.tell()
    completed = not archive.read(1)
with open(progress_path, "w") as progress:
    progress.write(f"{end}:{int(completed)}")
' "$archive" "$cursor" "$progress_file" > "$chunk_file" || ! structured_app_error_lines < "$chunk_file" > "$matches_file"; then
      log "Monitor: App archive collection failed; retaining cursor for $archive"
      rm -f "$chunk_file" "$matches_file" "$progress_file" || true
      return 0
    fi
    while IFS= read -r line; do
      if ! send_app_error_event "$line"; then
        log "Monitor: App archive enqueue failed; retaining cursor for $archive"
        rm -f "$chunk_file" "$matches_file" "$progress_file" || true
        return 0
      fi
    done < "$matches_file"
    progress="$(<"$progress_file")"
    next_cursor="${progress%%:*}"
    completed="${progress#*:}"
    if ! printf '%s' "$next_cursor" > "$progress_file" || ! mv "$progress_file" "$cursor_file"; then
      log "Monitor: App archive cursor could not be saved; queued events will be deduplicated on retry"
    elif [[ "$completed" == 1 ]]; then
      # The completion marker is written only after all captured events are durable.
      # 全部采集事件持久化后才能确认归档完成，失败不得提前跳过。
      : > "$done_file" || log "Monitor: App archive completion could not be saved; next round will retry"
    fi
    rm -f "$chunk_file" "$matches_file" "$progress_file" || true
    return 0
  done
  return 0
}

check_auto_deploy() {
  local disabled_entry=""
  if launchctl print "$USER_DOMAIN/$AUTO_DEPLOY_LABEL" >/dev/null 2>&1; then
    update_state auto-deploy healthy "LaunchAgent is loaded"
    return
  fi

  if [[ ! -f "$AUTO_DEPLOY_PLIST" ]]; then
    update_state auto-deploy unhealthy "LaunchAgent plist is missing: $AUTO_DEPLOY_PLIST"
    return
  fi

  if ! disabled_entry="$(launchctl print-disabled "$USER_DOMAIN" 2>/dev/null)"; then
    update_state auto-deploy unknown "Cannot confirm whether auto-deploy LaunchAgent is allowed to start"
    return
  fi
  if printf '%s\n' "$disabled_entry" | awk -v label="$AUTO_DEPLOY_LABEL" '$1 == "\"" label "\"" && $2 == "=>" && $3 == "disabled" { found = 1 } END { exit !found }'; then
    update_state auto-deploy unhealthy "LaunchAgent is explicitly disabled; leaving it disabled"
    return
  fi

  # RunAtLoad starts the missing agent without killing a newly spawned deployment.
  # 由 RunAtLoad 启动缺失任务，禁止强制重启刚开始运行的部署进程。
  if launchctl bootstrap "$USER_DOMAIN" "$AUTO_DEPLOY_PLIST" >/dev/null 2>&1; then
    update_state auto-deploy healthy "LaunchAgent was reloaded by service monitor"
  else
    update_state auto-deploy unhealthy "LaunchAgent is missing and automatic reload failed"
  fi
}

check_report_scheduler() {
  local disabled_entry=""
  if launchctl print "$USER_DOMAIN/$REPORT_SCHEDULER_LABEL" >/dev/null 2>&1; then
    update_state report-scheduler healthy "LaunchAgent is loaded"
    return
  fi
  if [[ ! -f "$REPORT_SCHEDULER_PLIST" ]]; then
    update_state report-scheduler unhealthy "LaunchAgent plist is missing: $REPORT_SCHEDULER_PLIST"
    return
  fi
  if ! disabled_entry="$(launchctl print-disabled "$USER_DOMAIN" 2>/dev/null)"; then
    update_state report-scheduler unknown "Cannot confirm whether report scheduler is allowed to start"
    return
  fi
  if printf '%s\n' "$disabled_entry" | awk -v label="$REPORT_SCHEDULER_LABEL" '$1 == "\"" label "\"" && $2 == "=>" && ($3 == "disabled" || $3 == "true") { found = 1 } END { exit !found }'; then
    update_state report-scheduler unhealthy "LaunchAgent is explicitly disabled; leaving it disabled"
    return
  fi
  # RunAtLoad starts only a missing, enabled agent; never restart a loaded job.
  # 仅恢复缺失且允许启动的报表任务，避免漏加载后持续停更。
  if launchctl bootstrap "$USER_DOMAIN" "$REPORT_SCHEDULER_PLIST" >/dev/null 2>&1; then
    update_state report-scheduler healthy "LaunchAgent was restored by service monitor"
  else
    update_state report-scheduler unhealthy "LaunchAgent is missing and automatic restoration failed"
  fi
}

[[ -f "$ENV_FILE" ]] || { log "Monitor: missing environment file $ENV_FILE"; exit 1; }
ensure_nas_supervisor_agent || true
check_report_scheduler
check_nas
# Capacity reporting only reads the host mount and atomically writes FG's local snapshot.
# 容量采集只读取宿主机挂载并原子更新本地快照，不依赖 Docker 可用。
/usr/bin/python3 "$PROJECT_ROOT/production-lab/yingce/collect-host-metrics.py" || true
if ! monitor_docker info >/dev/null 2>&1; then
  update_state docker unhealthy "Docker Desktop is unavailable; requesting application start"
  /usr/bin/open -gja Docker >/dev/null 2>&1 || true
  check_archived_app_errors
  flush_observability_outbox
  exit 0
fi

update_state docker healthy "Docker daemon is available"
check_app
check_nginx
check_nginx_5xx
check_postgres
check_tunnel
check_disk
check_app_errors
check_archived_app_errors
check_auto_deploy
flush_observability_outbox
