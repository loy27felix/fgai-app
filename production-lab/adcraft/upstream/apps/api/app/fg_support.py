"""共享 FG API 的只读排查证据；Read-only API evidence, not Web or Pi Agent."""
from __future__ import annotations

import asyncio
from contextlib import closing
from datetime import datetime, timedelta, timezone
import hmac
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import re
import sqlite3
import time

from starlette.requests import Request
from starlette.responses import JSONResponse

UUID = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}")
IDENTIFIER = re.compile(r"[A-Za-z0-9_.:-]{1,120}")
BUILD_LABEL = re.compile(r"[A-Za-z0-9_.:@-]{1,160}")
BUILD_COMMIT = re.compile(r"[0-9a-fA-F]{7,40}")
HTTP_METHODS = {'GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'CONNECT', 'TRACE'}
MAX_LOG_BYTES = 8 * 1024 * 1024
READ_LOG_BYTES = 2 * 1024 * 1024
READ_LOG_LINES = 5000
logger = logging.getLogger(__name__)
FILTERS = ('taskId', 'requestId', 'traceId', 'projectId')


class UnsupportedQuery(ValueError):
    pass


def iso(value: str) -> str:
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('Timezone required')
    return parsed.astimezone(timezone.utc).isoformat(timespec='microseconds').replace('+00:00', 'Z')


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='microseconds').replace('+00:00', 'Z')


def load_build() -> dict:
    build = dict(commit='unknown', version='unknown', buildTime='unknown',
                 environment='unknown', dirty=None)
    try:
        data = json.loads(Path(os.getenv('ADCRAFT_API_BUILD_FILE',
                                        '/app/adcraft-api-build.json')).read_text())
        if BUILD_COMMIT.fullmatch(data.get('commit', '')):
            build['commit'] = data['commit']
        for key in ('version', 'environment'):
            if isinstance(data.get(key), str) and BUILD_LABEL.fullmatch(data[key]):
                build[key] = data[key]
        if data.get('buildTime') and data['buildTime'] != 'unknown':
            build['buildTime'] = iso(data['buildTime'])
        if type(data.get('dirty')) is bool:
            build['dirty'] = data['dirty']
    except (OSError, ValueError, TypeError, AttributeError):
        pass
    return build


# Fixed metadata projection; payloads, prompts, names and provider errors are never read.
# 固定元数据投影；不读取正文、提示词、名称或供应商错误正文。
PROJECTIONS = (
    ('projects', 'project', 'p.project_id', 'p.project_id', None, None, None,
     'projects p'),
    ('agent_runs', 'agent_run', 'p.run_id', 'w.project_id', 'p.run_id',
     'p.request_id', 'p.safe_error_code',
     'agent_runs p LEFT JOIN agent_canvas_workflows w ON w.workflow_id=p.workflow_id'),
    ('agent_canvas_chat_turns', 'chat_turn', 'p.turn_id', 'w.project_id', 'p.turn_id',
     None, 'p.error_code',
     'agent_canvas_chat_turns p JOIN agent_canvas_workflows w ON w.workflow_id=p.workflow_id'),
    ('agent_canvas_provider_tasks', 'provider_task', 'p.task_id', 'w.project_id',
     'p.task_id', None, None,
     'agent_canvas_provider_tasks p JOIN agent_canvas_workflows w ON w.workflow_id=p.workflow_id'),
    ('agent_canvas_skill_runs', 'skill_run', 'p.skill_run_id', 'w.project_id',
     'p.skill_run_id', None, None,
     'agent_canvas_skill_runs p JOIN agent_canvas_workflows w ON w.workflow_id=p.workflow_id'),
)


def workspace_file(workspace: str, name: str) -> Path:
    if not UUID.fullmatch(workspace):
        raise ValueError('Invalid workspace')
    root = Path(os.getenv('FG_ADCRAFT_SQLITE_ROOT', '/database')).resolve()
    target = root / workspace / name
    if target.resolve() != target:
        raise ValueError('Unsafe workspace path')
    return target


def authorized(request: Request) -> bool:
    token = os.getenv('SUPPORT_BOT_NATIVE_READ_TOKEN', '')
    values = request.headers.getlist('authorization')
    return (len(token) >= 32 and len(values) == 1
            and hmac.compare_digest(values[0].encode(), ('Bearer ' + token).encode()))


def trusted_workspaces(request: Request, actor: str) -> list[str]:
    secret = os.getenv('FG_ADCRAFT_SECRET', '')
    for header in ('x-fg-internal', 'x-fg-support-actor', 'x-fg-support-workspaces'):
        if len(request.headers.getlist(header)) != 1:
            raise PermissionError('Trusted gateway scope required')
    if not secret or not hmac.compare_digest(
            request.headers['x-fg-internal'].encode(), secret.encode()):
        raise PermissionError('Trusted gateway scope required')
    if request.headers['x-fg-support-actor'] != actor:
        raise PermissionError('Actor scope mismatch')
    raw = request.headers['x-fg-support-workspaces']
    if len(raw) > 5000:
        raise PermissionError('Invalid trusted workspace scope')
    try:
        workspaces = json.loads(raw)
    except ValueError as error:
        raise PermissionError('Invalid trusted workspace scope') from error
    if (not isinstance(workspaces, list) or len(workspaces) > 100
            or any(not isinstance(w, str) or not UUID.fullmatch(w) for w in workspaces)):
        raise PermissionError('Invalid trusted workspace scope')
    if not workspaces:
        raise PermissionError('No authorized workspace')
    return sorted(set(workspaces))


def query(request: Request) -> dict:
    allowed = {'actorId', 'start', 'end', 'projectId', 'taskId', 'requestId', 'traceId', 'limit'}
    params = request.query_params
    if set(params) - allowed:
        raise UnsupportedQuery('Unsupported query parameter')
    if any(len(params.getlist(k)) != 1 for k in params):
        raise ValueError('Duplicate query parameter')
    result = {key: params[key] for key in params}
    if not IDENTIFIER.fullmatch(result.get('actorId', '')):
        raise ValueError('actorId required')
    for key in ('projectId', 'taskId', 'requestId', 'traceId'):
        if key in result and not IDENTIFIER.fullmatch(result[key]):
            raise ValueError('Invalid identifier')
    end = datetime.fromisoformat(iso(result.get('end', now())).replace('Z', '+00:00'))
    start = datetime.fromisoformat(iso(result.get('start', (end - timedelta(hours=24)).isoformat()))
                                   .replace('Z', '+00:00'))
    if start > end or end - start > timedelta(days=7):
        raise ValueError('Time window must be between zero and seven days')
    result.update(start=iso(start.isoformat()), end=iso(end.isoformat()))
    limit = result.get('limit', '50')
    if not re.fullmatch(r'[0-9]{1,3}', limit) or not 1 <= int(limit) <= 100:
        raise ValueError('limit must be 1..100')
    result['limit'] = int(limit)
    return result


def read_records(workspace: str, q: dict) -> tuple[list, dict]:
    path = workspace_file(workspace, 'v2/adcraft.sqlite3')
    coverage = {}
    records = []
    # mode=ro prevents file creation; query_only is defense in depth.
    # mode=ro 禁止创建数据库，query_only 进一步禁止写入。
    with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=1)) as db:
        db.execute('PRAGMA query_only=ON')
        deadline = time.monotonic() + 2
        db.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
        db.row_factory = sqlite3.Row
        for table, kind, identity, project, task, request, error, source in PROJECTIONS:
            expressions = [identity, 'p.status', 'p.created_at', 'p.updated_at', project,
                           task or 'NULL', request or 'NULL', error or 'NULL']
            conditions = ['(julianday(p.created_at) BETWEEN julianday(?) AND julianday(?) '
                          'OR julianday(p.updated_at) BETWEEN julianday(?) AND julianday(?))']
            args = [q['start'], q['end'], q['start'], q['end']]
            if q.get('traceId') or (q.get('taskId') and not task) or (q.get('requestId') and not request):
                conditions.append('0')
            for key, column in (('projectId', project), ('taskId', task), ('requestId', request)):
                if key in q and column:
                    conditions.append(column + '=?')
                    args.append(q[key])
            sql = ('SELECT ' + ','.join(expressions) + ' FROM ' + source + ' WHERE '
                   + ' AND '.join(conditions) + ' ORDER BY julianday(p.updated_at) DESC, '
                   + identity + ' LIMIT ?')
            try:
                rows = db.execute(sql, [*args, q['limit'] + 1]).fetchall()
                for row in rows:
                    record = dict(id=row[0], kind=kind, status=row[1],
                                  createdAt=iso(row[2]), updatedAt=iso(row[3]))
                    for key, value in zip(('projectId', 'taskId', 'requestId', 'errorCode'), row[4:]):
                        if value and IDENTIFIER.fullmatch(value):
                            record[key] = value
                    records.append(record)
                coverage[table] = True
            except (sqlite3.Error, ValueError, TypeError):
                coverage[table] = False
    return records, coverage


LOG_FIELDS = {'event', 'timestamp', 'service', 'actor_id', 'request_id', 'http_status',
              'route', 'method', 'project_id', 'task_id', 'trace_id', 'build_commit',
              'build_environment', 'build_dirty', 'duration_ms'}



def valid_log(item: dict) -> bool:
    if not isinstance(item, dict):
        return False
    if item.get('event') != 'support_http_request' or item.get('service') != 'adcraft':
        return False
    for key in ('actor_id', 'request_id', 'project_id', 'task_id', 'trace_id'):
        if key not in item and key not in ('actor_id', 'request_id'):
            continue
        if not isinstance(item.get(key), str) or not IDENTIFIER.fullmatch(item[key]):
            return False
    status, route = item.get('http_status'), item.get('route')
    if type(status) is not int or not 100 <= status <= 599:
        return False
    method = item.get('method')
    if not isinstance(method, str) or method not in HTTP_METHODS:
        return False
    if (not isinstance(route, str) or not route.startswith('/')
            or any(c in route for c in '?#') or any(c.isspace() or ord(c) < 32 or ord(c) == 127 for c in route)):
        return False
    commit, environment = item.get('build_commit'), item.get('build_environment')
    if (not isinstance(commit, str) or not BUILD_COMMIT.fullmatch(commit)
            or type(item.get('build_dirty')) is not bool
            or not isinstance(environment, str) or not BUILD_LABEL.fullmatch(environment)
            or environment == 'unknown'):
        return False
    try:
        iso(item['timestamp'])
    except (KeyError, ValueError, TypeError, AttributeError, OverflowError):
        return False
    return True


def read_logs(workspace: str, q: dict, budget: dict) -> tuple[list, bool]:
    logs = []
    remaining = budget['bytes']
    lines = budget['lines']
    partial = False
    current = workspace_file(workspace, 'support-http.jsonl')
    if not current.is_file():
        raise OSError('Log unavailable')
    for suffix in ('', '.1', '.2'):
        path = workspace_file(workspace, 'support-http.jsonl' + suffix)
        if not path.exists():
            continue
        with path.open('rb') as file:
            size = file.seek(0, 2)
            if remaining <= 0 or lines <= 0:
                partial |= size > 0
                continue
            offset = max(0, size - remaining)
            file.seek(offset)
            if offset:
                remaining -= len(file.readline(remaining))
                partial = True
            content = file.read(remaining)
            remaining -= len(content)
        entries = content.splitlines()
        if len(entries) > lines:
            entries = entries[-lines:]
            partial = True
        lines -= len(entries)
        budget.update(bytes=remaining, lines=lines)
        for line in reversed(entries):
            item = json.loads(line)
            if not isinstance(item, dict):
                raise ValueError('Invalid support log')
            if item.get('event') != 'support_http_request' or item.get('actor_id') != q['actorId']:
                continue
            timestamp = iso(item['timestamp'])
            if not q['start'] <= timestamp <= q['end']:
                continue
            if not valid_log(item):
                raise ValueError('Invalid support log')
            fields = (('projectId', 'project_id'), ('taskId', 'task_id'),
                      ('requestId', 'request_id'), ('traceId', 'trace_id'))
            if any(item.get(field) != q[key] for key, field in fields if key in q):
                continue
            logs.append({key: value for key, value in item.items() if key in LOG_FIELDS})
    budget.update(bytes=remaining, lines=lines)
    return logs, partial


class EvidenceFileHandler(RotatingFileHandler):
    def handleError(self, record):
        # Surface disk errors to coverage instead of silently losing audit events.
        # 将磁盘错误反馈给 coverage，不能静默丢失审计事件。
        raise OSError('Support log write failed')


class SupportEvidence:
    def __init__(self):
        self.build = load_build()
        self.log_failures = set()
        self.log_handlers = {}

    async def handle(self, scope, receive, send):
        request = Request(scope)
        if not authorized(request):
            response = JSONResponse({'detail': 'Support access denied', 'errorCode': 'support_access_denied'}, status_code=401)
        elif request.method != 'GET':
            response = JSONResponse({'detail': 'Read-only endpoint', 'errorCode': 'support_read_only'}, status_code=405)
        elif request.url.path == '/internal/support/version':
            response = JSONResponse({'service': 'adcraft', 'build': self.build, 'component': 'api'})
        else:
            try:
                q = query(request)
                workspaces = trusted_workspaces(request, q['actorId'])
                result = await asyncio.to_thread(self.evidence, workspaces, q)
                response = JSONResponse(result)
            except PermissionError as error:
                response = JSONResponse({'detail': str(error), 'errorCode': 'support_scope_denied'}, status_code=403)
            except UnsupportedQuery:
                response = JSONResponse({'detail': 'Unsupported evidence query', 'errorCode': 'support_unsupported_filter'}, status_code=400)
            except (ValueError, OverflowError):
                response = JSONResponse({'detail': 'Invalid evidence query', 'errorCode': 'support_invalid_query'}, status_code=422)
        response.headers['Cache-Control'] = 'no-store'
        await response(scope, receive, send)

    def evidence(self, workspaces: list[str], q: dict) -> dict:
        records, logs, sources = [], [], []
        operations_ok = logs_ok = True
        truncated = False
        log_budget = {'bytes': READ_LOG_BYTES, 'lines': READ_LOG_LINES}
        for workspace in workspaces:
            try:
                found, tables = read_records(workspace, q)
                records.extend(found)
                available = all(tables.values())
                sources.append({'tables': tables, 'available': available})
                operations_ok &= available
            except (OSError, ValueError, sqlite3.Error):
                operations_ok = False
                sources.append({'available': False, 'reason': 'database_unreadable'})
            try:
                found, partial = read_logs(workspace, q, log_budget)
                logs.extend(found)
                truncated |= partial
                logs_ok &= workspace not in self.log_failures
                logs_ok &= not workspace_file(workspace, 'support-http.failed').exists()
            except (OSError, ValueError, KeyError, TypeError, AttributeError):
                logs_ok = False
        records.sort(key=lambda item: (item['updatedAt'], item['id']), reverse=True)
        logs.sort(key=lambda item: item['timestamp'], reverse=True)
        truncated |= len(records) > q['limit'] or len(logs) > q['limit']
        coverage = {
            'operations': {'available': operations_ok, 'sources': sources,
                           'scope': 'authorized_workspaces_not_record_creator',
                           'traceId': 'not_persisted',
                           'requestId': 'agent_runs_only'},
            'inboundHttp': {'available': logs_ok, 'retention': 'persistent per workspace, 8 MiB x 3 segments; read at most 2 MiB / 5000 lines per query; since instrumentation'},
            'components': {'api': self.build, 'web': {'available': False, 'reason': 'separate_image'},
                           'agent': {'available': False, 'reason': 'separate_runtime'}},
        }
        if not operations_ok:
            coverage['operations']['reason'] = 'database_or_projection_unreadable'
        if not logs_ok:
            coverage['inboundHttp']['reason'] = 'log_missing_unreadable_invalid_or_write_failed'
        return dict(service='adcraft', build=self.build,
                    scope={k: q[k] for k in ('actorId', 'start', 'end', *FILTERS) if k in q},
                    records=records[:q['limit']], logs=logs[:q['limit']], coverage=coverage,
                    truncated=truncated, incomplete=not (operations_ok and logs_ok))

    def log_request(self, workspace: str, context: dict, scope: dict,
                    status: int, started: float):
        if scope['path'].startswith('/internal/support/') or re.search(r'/(?:health|version)(?:/|$)', scope['path']):
            return
        actor = context.get('actor', '')
        headers = dict(scope['headers'])
        request_id = context.get('request_id')
        event = dict(event='support_http_request', timestamp=now(), service='adcraft',
                     actor_id=actor, request_id=request_id, http_status=status,
                     method=scope.get('method'), route=None,
                     build_commit=self.build['commit'], build_environment=self.build['environment'],
                     build_dirty=self.build['dirty'], duration_ms=round((time.monotonic()-started)*1000))
        route = scope.get('route')
        if route is not None:
            event['route'] = route.path
        for prefix, key in (('projects', 'project_id'), ('tasks', 'task_id')):
            match = re.search('/' + prefix + r'/([^/]+)(?:/|$)', scope['path'])
            if match and IDENTIFIER.fullmatch(match[1]):
                event[key] = match[1]
        trace_id = headers.get(b'x-trace-id', b'').decode('ascii', errors='replace')
        if IDENTIFIER.fullmatch(trace_id):
            event['trace_id'] = trace_id
        try:
            if not valid_log(event):
                raise ValueError('Invalid support log')
            path = workspace_file(workspace, 'support-http.jsonl')
            path.parent.mkdir(parents=True, exist_ok=True)
            handler = self.log_handlers.get(workspace)
            if handler is None:
                for suffix in ('', '.1', '.2'):
                    workspace_file(workspace, 'support-http.jsonl' + suffix)
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o600)
                os.close(fd)
                handler = EvidenceFileHandler(path, maxBytes=MAX_LOG_BYTES, backupCount=2,
                                              encoding='utf-8')
                handler.setFormatter(logging.Formatter('%(message)s'))
                self.log_handlers[workspace] = handler
            record = logging.LogRecord('adcraft.support', logging.INFO, '', 0,
                                       json.dumps(event, separators=(',', ':')), (), None)
            handler.handle(record)
        except (OSError, ValueError):
            self.log_failures.add(workspace)
            try:
                workspace_file(workspace, 'support-http.failed').touch(mode=0o600)
            except (OSError, ValueError):
                pass
            logger.error('support_http_log_invalid_or_write_failed')
