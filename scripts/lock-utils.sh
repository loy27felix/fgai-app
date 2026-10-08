#!/usr/bin/env bash

FG_LOCK_PROTOCOL_ROOT="$HOME/Library/Application Support/fg-studio-app-recreate/protocol-v2"
FG_LOCK_PROTOCOL_START_TIME=""

# Record a process start time so a reused PID cannot masquerade as a current lock owner.
# 记录进程启动时间，避免 PID 重用时把旧标记误判成当前锁持有者。
register_lock_protocol_process() {
  mkdir -p "$FG_LOCK_PROTOCOL_ROOT" || return 1
  FG_LOCK_PROTOCOL_START_TIME="$(/bin/ps -p "$$" -o lstart= 2>/dev/null | sed 's/^ *//; s/ *$//')"
  [[ -n "$FG_LOCK_PROTOCOL_START_TIME" ]] || return 1
  printf '%s\n' "$FG_LOCK_PROTOCOL_START_TIME" > "$FG_LOCK_PROTOCOL_ROOT/$$"
}

unregister_lock_protocol_process() {
  local registered_start_time=""
  local marker="$FG_LOCK_PROTOCOL_ROOT/$$"
  [[ -f "$marker" ]] && registered_start_time="$(<"$marker")"
  if [[ "$registered_start_time" == "$FG_LOCK_PROTOCOL_START_TIME" ]]; then
    rm -f "$marker"
  fi
}

is_current_lock_protocol_process() {
  local process_id="$1"
  local marker_start_time=""
  local process_start_time=""
  local marker="$FG_LOCK_PROTOCOL_ROOT/$process_id"

  [[ -f "$marker" ]] || return 1
  marker_start_time="$(<"$marker")"
  process_start_time="$(/bin/ps -p "$process_id" -o lstart= 2>/dev/null | sed 's/^ *//; s/ *$//')"
  [[ -n "$process_start_time" && "$marker_start_time" == "$process_start_time" ]]
}

legacy_lock_process_running() {
  local process_id
  local pattern

  for pattern in 'nas-supervisor\.sh' 'auto-deploy\.sh'; do
    while IFS= read -r process_id; do
      [[ -n "$process_id" && "$process_id" != "$$" ]] || continue
      if ! is_current_lock_protocol_process "$process_id"; then
        return 0
      fi
    done < <(/usr/bin/pgrep -f "$pattern" 2>/dev/null || true)
  done
  return 1
}

# Reclaim only abandoned directory locks from the previous protocol.
# 只回收旧协议遗留且确认无人运行的目录锁。
cleanup_legacy_lock_directory() {
  local lock_path="$1"
  local migration_lock="${lock_path}.migration"
  local owner_pid=""
  local owner_command=""
  local lock_status=0

  [[ -d "$lock_path" && ! -L "$lock_path" ]] || return 0
  if ! exec 7>>"$migration_lock"; then
    printf 'Lock migration: cannot open mutex %s\n' "$migration_lock" >&2
    return 2
  fi
  /usr/bin/lockf -s -t 0 7 || lock_status=$?
  if (( lock_status != 0 )); then
    exec 7>&-
    (( lock_status == 75 )) && return 1
    printf 'Lock migration: lockf failed for %s (exit %s)\n' "$migration_lock" "$lock_status" >&2
    return 2
  fi

  if [[ ! -d "$lock_path" || -L "$lock_path" ]]; then
    exec 7>&-
    return 0
  fi
  owner_pid="$(<"$lock_path/pid" 2>/dev/null || true)"
  if [[ "$owner_pid" != "$$" ]] && legacy_lock_process_running; then
    exec 7>&-
    return 1
  fi
  if [[ "$owner_pid" =~ ^[0-9]+$ ]] && kill -0 "$owner_pid" 2>/dev/null; then
    owner_command="$(/bin/ps -p "$owner_pid" -o command= 2>/dev/null || true)"
    case "$owner_command" in
      *nas-supervisor.sh*|*auto-deploy.sh*)
        if [[ "$owner_pid" != "$$" ]]; then
          exec 7>&-
          return 1
        fi
        ;;
    esac
  fi

  rm -f "$lock_path/pid" || {
    exec 7>&-
    printf 'Lock migration: cannot remove stale PID from %s\n' "$lock_path" >&2
    return 2
  }
  if ! rmdir "$lock_path" 2>/dev/null; then
    exec 7>&-
    if [[ ! -d "$lock_path" ]]; then
      return 0
    fi
    printf 'Lock migration: legacy lock directory contains unexpected entries: %s\n' "$lock_path" >&2
    return 2
  fi
  # New lock files are acquired only after the stale directory is removed under the migration mutex.
  # 只有在迁移互斥锁保护下清理旧目录后，才创建新的文件锁。
  exec 7>&-
}
