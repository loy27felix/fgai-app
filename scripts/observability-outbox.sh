#!/usr/bin/env bash

set -Eeuo pipefail

case "${FG_RUNTIME_TARGET-platform}" in
  platform|native) ;;
  *)
    printf 'Observability: invalid FG_RUNTIME_TARGET (expected platform|native)\n' >&2
    return 2 2>/dev/null || exit 2
    ;;
esac

fg_obs_outbox_dir() {
  local state_root="${FG_MONITOR_STATE_DIR:-$HOME/Library/Application Support/fg-studio-monitor}"
  printf '%s/outbox' "$state_root"
}

fg_obs_queue_event() {
  local kind="$1"
  local payload="$2"
  local outbox digest destination temporary
  case "$kind" in
    monitor|error) ;;
    *) return 2 ;;
  esac
  [[ -n "$payload" ]] || return 2
  outbox="$(fg_obs_outbox_dir)" || return 1
  (umask 077 && mkdir -p "$outbox") || return 1
  chmod 700 "$outbox" || return 1
  digest="$(printf '%s' "$payload" | /usr/bin/shasum -a 256 | awk '{print $1}')" || return 1
  destination="$outbox/$digest.$kind.json"
  [[ -f "$destination" ]] && return 0
  temporary="$(mktemp "$outbox/.pending.XXXXXX")" || return 1
  if ! chmod 600 "$temporary" || ! printf '%s\n' "$payload" > "$temporary"; then
    rm -f "$temporary" || true
    return 1
  fi
  # Hard-link publication cannot overwrite an event concurrently enqueued by another producer.
  # 使用 hard link 原子发布，避免并发生产者覆盖已入队事件及重试顺序。
  if ln "$temporary" "$destination" 2>/dev/null; then
    rm -f "$temporary" || return 1
  elif [[ -f "$destination" ]]; then
    rm -f "$temporary" || return 1
  else
    rm -f "$temporary" || true
    return 1
  fi
}

fg_obs_flush_outbox() {
  case "${FG_RUNTIME_TARGET-platform}" in
    native)
      # Only an explicit native sink may consume this queue, never a legacy fallback.
      # 只有显式原生接收端可以消费队列，禁止回退旧站地址。
      if [[ -z "${1:-}" || -z "${2:-}" ]]; then
        printf 'Observability: native flush deferred; explicit native URL/secret missing, queued events retained\n' >&2
        return 75
      fi
      ;;
    platform) ;;
    *) printf 'Observability: invalid FG_RUNTIME_TARGET (expected platform|native)\n' >&2; return 2 ;;
  esac
  local base_url="$1"
  local secret="$2"
  local limit="${3:-5}"
  local outbox
  [[ -n "$base_url" && -n "$secret" ]] || return 0
  outbox="$(fg_obs_outbox_dir)" || return 1
  [[ -d "$outbox" ]] || return 0
  python3 - "$outbox" "$base_url" "$secret" "$limit" "${FG_RUNTIME_TARGET-platform}" <<'PY'
import heapq
import json
import os
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit

os.umask(0o077)
outbox, base_url, secret, raw_limit, target = sys.argv[1:]
native = target == 'native'
max_event_bytes = 512 * 1024
if native:
    try:
        url = urlsplit(base_url)
        valid = (url.scheme == 'http' and url.hostname in ('127.0.0.1', 'localhost', '::1')
                 and url.port is not None and 1 <= url.port <= 65535
                 and not url.username and not url.password and not url.query and not url.fragment
                 and url.path in ('', '/') and len(secret) >= 32)
    except ValueError:
        valid = False
    if not valid:
        print('observability outbox: invalid native loopback URL or dedicated secret; queue untouched', file=sys.stderr)
        sys.exit(2)
limit = int(raw_limit) if raw_limit.isdigit() and int(raw_limit) > 0 else 5
# Gate delivery before POST: old deployed APIs silently drop heartbeat metadata.
# 投递前校验协议；旧部署接口会静默丢弃心跳标记，必须保留队列等待新接口。
try:
    capability = subprocess.run([
        '/usr/bin/curl', *(['-q', '--noproxy', '*'] if native else []),
        '-fsS', '--connect-timeout', '1', '--max-time', '2',
        '--max-filesize', '1024', '-H', 'x-fg-observability-secret: ' + secret,
        base_url.rstrip('/') + '/api/observability/monitor-events',
    ], text=True, capture_output=True, timeout=3)
except subprocess.TimeoutExpired:
    sys.exit(75 if native else 0)
if capability.returncode != 0:
    sys.exit(75 if native else 0)
try:
    protocol = json.loads(capability.stdout)
except (ValueError, TypeError):
    sys.exit(75 if native else 0)
if (not isinstance(protocol, dict)
        or type(protocol.get('monitorHeartbeatProtocol')) is not int
        or protocol['monitorHeartbeatProtocol'] != 1):
    sys.exit(75 if native else 0)
if native and (protocol.get('runtimeTarget') != 'native'
               or type(protocol.get('durableEventAckProtocol')) is not int
               or protocol['durableEventAckProtocol'] != 1):
    print('observability outbox: native durable acknowledgment protocol missing; queue untouched', file=sys.stderr)
    sys.exit(75)
queues = {'monitor': [], 'error': []}
# One O(N) directory scan with O(limit) memory; no repeated scan or full backlog sort.
# 每轮仅扫描目录一次，内存受 limit 限制，不对整个积压排序或每次请求重新扫描。
with os.scandir(outbox) as entries:
    for entry in entries:
        kind = next((kind for kind in queues if entry.name.endswith('.' + kind + '.json')), None)
        if kind is None or not entry.is_file(follow_symlinks=False):
            continue
        item = (-entry.stat(follow_symlinks=False).st_mtime_ns, entry.name)
        heap = queues[kind]
        if len(heap) < limit:
            heapq.heappush(heap, item)
        elif item > heap[0]:
            heapq.heapreplace(heap, item)
queues = {kind: [name for _, name in sorted(items, key=lambda item: (-item[0], item[1]))]
          for kind, items in queues.items()}
state = os.path.join(outbox, '.next-kind')
try:
    with open(state) as stream:
        kind = stream.read().strip()
except FileNotFoundError:
    kind = 'monitor'
if kind not in queues:
    kind = 'monitor'

def same_event(path, original):
    try:
        current = os.stat(path, follow_symlinks=False)
        return (current.st_dev, current.st_ino, current.st_size, current.st_mtime_ns) == (original.st_dev, original.st_ino, original.st_size, original.st_mtime_ns)
    except OSError:
        return False

def quarantine_event(path, reason):
    quarantine = os.path.join(outbox, 'quarantine')
    os.makedirs(quarantine, mode=0o700, exist_ok=True)
    os.chmod(quarantine, 0o700)
    destination = os.path.join(quarantine, os.path.basename(path))
    # Persist local rejection reason before moving the original event out of delivery.
    # 先保存拒绝原因再隔离原事件，鉴权/部署/限流错误继续留队重试。
    with open(destination + '.reason', 'w') as stream:
        stream.write(reason + ': payload rejected\n')
    os.chmod(destination + '.reason', 0o600)
    os.replace(path, destination)
    print('observability outbox: quarantined ' + os.path.basename(path) + ' (' + reason + ')', file=sys.stderr)

for _ in range(limit):
    alternate = 'error' if kind == 'monitor' else 'monitor'
    if not queues[kind]:
        kind = alternate
    if not queues[kind]:
        break
    path = os.path.join(outbox, queues[kind].pop(0))
    endpoint = base_url.rstrip('/') + '/api/observability/' + (
        'monitor-events' if kind == 'monitor' else 'error-events')
    kind = 'error' if kind == 'monitor' else 'monitor'
    # Preserve fairness across rounds, including crashes; the flush consumer is single-owner.
    # 下一轮类别原子落盘，即使中途失败也保留公平顺序；投递仅允许一个消费者。
    descriptor, temporary = tempfile.mkstemp(prefix='.next-kind.', dir=outbox)
    with os.fdopen(descriptor, 'w') as stream:
        stream.write(kind)
    os.replace(temporary, state)
    # Rotate a failed event without changing payload, eventKey or observedAt.
    # 请求前更新时间，使失败事件移到队尾，保留原始 payload 和采样时间。
    os.utime(path, None, follow_symlinks=not native)
    payload, key, original = None, None, None
    if native:
        # Send exactly the event we inspected; never follow a substituted symlink.
        # 只发送实际检查过的事件字节，不跟随被替换的符号链接。
        import stat
        try:
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(descriptor, 'rb') as stream:
                original = os.fstat(stream.fileno())
                if not stat.S_ISREG(original.st_mode):
                    continue
                payload = stream.read(max_event_bytes + 1)
            if len(payload) > max_event_bytes:
                if same_event(path, original):
                    quarantine_event(path, 'Local 413 (event exceeds 512 KiB)')
                continue
            try:
                value = json.loads(payload)
                key = value.get('eventKey') if isinstance(value, dict) else None
            except (ValueError, TypeError):
                if same_event(path, original):
                    quarantine_event(path, 'Local 400 (invalid JSON)')
                continue
        except OSError:
            continue
    try:
        result = subprocess.run([
            '/usr/bin/curl', *(['-q', '--noproxy', '*'] if native else []),
            '-sS', '--connect-timeout', '1', '--max-time', '2',
            *(['--max-filesize', '4096', '-w', '\n%{http_code}'] if native else ['-o', '/dev/null', '-w', '%{http_code}']),
            '-H', 'x-fg-observability-secret: ' + secret,
            '-H', 'Content-Type: application/json', '--data-binary', '@-' if native else '@' + path, endpoint,
        ], input=payload if native else None, text=not native, capture_output=True, timeout=3)
    except subprocess.TimeoutExpired:
        continue
    output = result.stdout.decode('utf8', errors='replace') if native else result.stdout
    response, _, raw_status = output.rpartition('\n') if native else ('', '', output)
    status = int(raw_status) if raw_status.isdigit() else 0
    acknowledged = True
    if native:
        try:
            if not same_event(path, original):
                continue
            ack = json.loads(response)
            acknowledged = (isinstance(key, str) and bool(key) and isinstance(ack, dict)
                            and ack.get('ok') is True and ack.get('eventKey') == key
                            and ack.get('runtimeTarget') == 'native'
                            and type(ack.get('durableEventAckProtocol')) is int
                            and ack['durableEventAckProtocol'] == 1)
        except (OSError, ValueError, TypeError):
            acknowledged = False
    if result.returncode == 0 and 200 <= status < 300 and acknowledged:
        os.unlink(path)
    elif result.returncode == 0 and status in (400, 405, 410, 413, 415, 422):
        quarantine_event(path, 'HTTP ' + str(status))
PY
}
