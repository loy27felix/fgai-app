"""Native, allowlisted support evidence; 原生只读排查，不读取内容或凭据。"""

import asyncio
import hmac
import json
import logging
import os
import re
import sqlite3
import stat
from contextlib import closing
from datetime import UTC, datetime, timedelta
from logging.handlers import RotatingFileHandler
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.engine import make_url

SUPPORT_PATHS = frozenset({"/internal/support/evidence", "/internal/support/version"})
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}\Z")
STATUSES = frozenset(
    {
        "queued",
        "pending",
        "running",
        "completed",
        "failed",
        "cancelled",
        "idle",
        "interrupted",
        "error",
        "stopped",
        "paused",
        "active",
    }
)
MAX_WINDOW = timedelta(days=7)
MAX_PROJECT_SCAN = 1000


class SupportReadError(Exception):
    def __init__(self, status_code, error_code):
        self.status_code = status_code
        self.error_code = error_code
        super().__init__(error_code)


def timestamp(value):
    if not isinstance(value, str) or len(value) > 40:
        raise ValueError("invalid timestamp")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timezone required")
    return parsed.astimezone(UTC)


def identifier(value):
    return value if isinstance(value, str) and IDENTIFIER.fullmatch(value) else None


def build_info():
    try:
        manifest = json.loads(
            Path("/app/arcreel-build.json").read_text(encoding="utf-8")
        )
        if not isinstance(manifest, dict):
            manifest = {}
    except (OSError, ValueError):
        manifest = {}
    values = {
        key: os.environ.get(env, manifest.get(key, "unknown"))
        for key, env in {
            "commit": "ARCREEL_BUILD_COMMIT",
            "version": "ARCREEL_BUILD_VERSION",
            "buildTime": "ARCREEL_BUILD_TIME",
            "environment": "ARCREEL_BUILD_ENVIRONMENT",
            "dirty": "ARCREEL_BUILD_DIRTY",
        }.items()
    }
    values["commit"] = (
        values["commit"]
        if re.fullmatch(r"[0-9a-fA-F]{7,64}", str(values["commit"]))
        else "unknown"
    )
    for key in ("version", "environment"):
        values[key] = identifier(values[key]) or "unknown"
    try:
        values["buildTime"] = timestamp(values["buildTime"]).isoformat()
    except (ValueError, TypeError, OverflowError):
        values["buildTime"] = "unknown"
    values["dirty"] = {"true": True, "false": False}.get(
        str(values["dirty"]).lower(), "unknown"
    )
    return values


def read_records(database, projects_dir, start, end, filters, limit):
    records, sources = [], {}
    truncated = False
    try:
        url = make_url(database)
        if (
            url.get_backend_name() != "sqlite"
            or not url.database
            or url.database == ":memory:"
        ):
            raise ValueError("persistent SQLite required")
        uri = Path(url.database).resolve().as_uri() + "?mode=ro"
        with closing(sqlite3.connect(uri, uri=True, timeout=2)) as db:
            db.execute("PRAGMA query_only=ON")
            # Bound scan work as well as output. / 同时限制查询工作量和返回数量。
            db.set_progress_handler(lambda: 1, 1_000_000)
            for table, id_column, created, updated, kind in (
                ("tasks", "task_id", "queued_at", "updated_at", "task"),
                ("agent_sessions", "id", "created_at", "updated_at", "agent_run"),
            ):
                if filters.get("taskId") and kind != "task":
                    continue
                where = [
                    f"julianday({updated}) >= julianday(?)",
                    f"julianday({updated}) <= julianday(?)",
                ]
                params = [start.isoformat(), end.isoformat()]
                for field, column in (
                    ("projectId", "project_name"),
                    ("taskId", "task_id"),
                ):
                    if filters.get(field):
                        where.append(f"{column} = ?")
                        params.append(filters[field])
                sql = (
                    f"SELECT {id_column}, status, {created}, {updated}, project_name FROM {table} "
                    f"WHERE {' AND '.join(where)} ORDER BY {updated} DESC, {id_column} LIMIT ?"
                )
                try:
                    rows = db.execute(sql, [*params, limit + 1]).fetchall()
                    sources[table] = "read_only_sqlite"
                except sqlite3.Error:
                    sources[table] = "unavailable"
                    continue
                truncated |= len(rows) > limit
                for rid, status, created_at, updated_at, project in rows:
                    if not identifier(rid) or not identifier(project):
                        sources[table] = "partial_invalid_identifiers"
                        continue
                    try:
                        created_at = timestamp(
                            created_at
                            if "+" in created_at or created_at.endswith("Z")
                            else created_at + "+00:00"
                        ).isoformat()
                        updated_at = timestamp(
                            updated_at
                            if "+" in updated_at or updated_at.endswith("Z")
                            else updated_at + "+00:00"
                        ).isoformat()
                    except (ValueError, TypeError, AttributeError, OverflowError):
                        sources[table] = "partial_invalid_timestamps"
                        continue
                    record = {
                        "id": rid,
                        "kind": kind,
                        "status": status if status in STATUSES else "unknown",
                        "createdAt": created_at,
                        "updatedAt": updated_at,
                        "projectId": project,
                    }
                    if kind == "task":
                        record["taskId"] = rid
                    records.append(record)
    except (sqlite3.Error, ValueError, OSError):
        sources["sqlite"] = "unavailable"

    if not filters.get("taskId"):
        sources["projects"] = "project_json_metadata"
        try:
            with os.scandir(projects_dir) as entries:
                for index, entry in enumerate(entries):
                    if index >= MAX_PROJECT_SCAN:
                        truncated = True
                        sources["projects"] = "scan_limit"
                        break
                    if not identifier(entry.name) or not entry.is_dir(
                        follow_symlinks=False
                    ):
                        continue
                    if filters.get("projectId") and entry.name != filters["projectId"]:
                        continue
                    path = Path(entry.path) / "project.json"
                    try:
                        if path.is_symlink() or path.stat().st_size > 2 * 1024 * 1024:
                            sources["projects"] = "partial_unreadable"
                            continue
                        metadata = json.loads(path.read_text(encoding="utf-8")).get(
                            "metadata", {}
                        )
                        created_at = timestamp(metadata.get("created_at"))
                        updated_at = timestamp(metadata.get("updated_at"))
                    except (
                        OSError,
                        ValueError,
                        AttributeError,
                        TypeError,
                        OverflowError,
                    ):
                        sources["projects"] = "partial_unreadable"
                        continue
                    if start <= updated_at <= end:
                        records.append(
                            {
                                "id": entry.name,
                                "kind": "project",
                                "status": "present",
                                "createdAt": created_at.isoformat(),
                                "updatedAt": updated_at.isoformat(),
                                "projectId": entry.name,
                            }
                        )
        except OSError:
            sources["projects"] = "unavailable"
    records.sort(key=lambda row: (row["updatedAt"], row["id"]), reverse=True)
    return records[:limit], sources, truncated or len(records) > limit


class SupportLogHandler(RotatingFileHandler):
    """Expose swallowed logging I/O errors. / 将 logging 内部吞掉的 I/O 错误显式暴露。"""

    write_ok = True

    def _open(self):
        fd = os.open(
            self.baseFilename,
            os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0),
            0o600,
        )
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                raise OSError("support log must be a regular file")
            os.fchmod(fd, 0o600)
            return os.fdopen(fd, self.mode, encoding=self.encoding, errors=self.errors)
        except BaseException:
            os.close(fd)
            raise

    def emit(self, record):
        super().emit(record)

    def handleError(self, record):
        self.write_ok = False


def read_http_logs(path, actor, start, end, filters, limit):
    rows = []
    available, truncated, earliest = True, False, None
    remaining, lines = 2 * 1024 * 1024, 5000
    keys = {
        "event",
        "timestamp",
        "service",
        "actor_id",
        "request_id",
        "http_status",
        "route",
        "method",
        "build_commit",
        "build_environment",
        "build_dirty",
        "auth",
        "entry_accepted",
    }
    optional = {"project_id", "task_id", "trace_id"}
    correlations = {
        "projectId": "project_id",
        "taskId": "task_id",
        "requestId": "request_id",
        "traceId": "trace_id",
    }
    for file in (path, path.with_name(path.name + ".1")):
        try:
            if file.is_symlink():
                raise OSError("symlink not allowed")
            fd = os.open(file, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
            with os.fdopen(fd, "rb") as stream:
                if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                    raise OSError("support log must be a regular file")
                data = stream.read(remaining + 1)
        except FileNotFoundError:
            if file == path:
                available = False
            continue
        except OSError:
            available = False
            continue
        if len(data) > remaining:
            truncated = True
            data = data[:remaining]
        remaining -= len(data)
        for raw in reversed(data.splitlines()):
            if lines <= 0:
                truncated = True
                break
            lines -= 1
            try:
                row = json.loads(raw)
                if not isinstance(row, dict) or not keys <= row.keys():
                    raise ValueError("missing provenance")
                if (
                    row["auth"] != "runtime_capability"
                    or row["entry_accepted"] is not True
                    or row["event"] != "support_http_request"
                    or row["service"] != "arcreel"
                    or row["actor_id"] != actor
                    or not identifier(row["request_id"])
                    or type(row["http_status"]) is not int
                    or not 100 <= row["http_status"] <= 599
                    or row["method"]
                    not in {
                        "GET",
                        "POST",
                        "PUT",
                        "PATCH",
                        "DELETE",
                        "HEAD",
                        "OPTIONS",
                        "OTHER",
                    }
                    or not isinstance(row["route"], str)
                    or not re.fullmatch(r"[A-Za-z0-9_{}:/.-]{1,256}", row["route"])
                    or not identifier(row["build_commit"])
                    or not identifier(row["build_environment"])
                    or not (
                        type(row["build_dirty"]) is bool
                        or row["build_dirty"] == "unknown"
                    )
                    or any(not identifier(row[key]) for key in optional & row.keys())
                ):
                    raise ValueError("invalid provenance")
                at = timestamp(row["timestamp"])
            except (ValueError, TypeError, OverflowError, UnicodeError):
                available = False
                continue
            earliest = at if earliest is None else min(earliest, at)
            if start <= at <= end and all(
                row.get(correlations[key]) == value for key, value in filters.items()
            ):
                rows.append({key: row[key] for key in keys | optional if key in row})
        if remaining <= 0 or lines <= 0:
            truncated = True
            break
    rows.sort(key=lambda row: row["timestamp"])
    history_gap = earliest is None or start < earliest
    return (
        rows[-limit:],
        available,
        truncated or len(rows) > limit,
        history_gap,
        earliest,
    )


def install(app: FastAPI):
    from lib.db import get_database_url
    from lib.infra.data_root_layout import DataRootLayout

    actor = os.environ.get("FG_ARC_ACTOR", "")
    token = os.environ.get("SUPPORT_BOT_NATIVE_READ_TOKEN", "")
    capability = os.environ.get("FG_ARC_CAPABILITY", "")
    build = build_info()
    database = get_database_url()
    projects_dir = DataRootLayout.current().projects_dir
    log_path = (
        Path(os.environ.get("ARCREEL_SUPPORT_LOG_DIR", "/state")) / "support-http.jsonl"
    )
    log_handler = None
    try:
        log_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        log_handler = SupportLogHandler(
            log_path, maxBytes=1024 * 1024, backupCount=1, encoding="utf-8"
        )
        log_handler.setFormatter(logging.Formatter("%(message)s"))
    except OSError:
        pass

    async def support_error(request: Request, error: SupportReadError):
        return JSONResponse(
            {"errorCode": error.error_code, "detail": error.error_code},
            status_code=error.status_code,
        )

    app.add_exception_handler(SupportReadError, support_error)

    def authorize(request: Request):
        if len(token) < 32 or not identifier(actor) or token == capability:
            raise SupportReadError(503, "support_read_not_configured")
        supplied = request.headers.get("authorization", "")
        if not hmac.compare_digest(supplied.encode(), ("Bearer " + token).encode()):
            raise SupportReadError(401, "support_read_unauthorized")

    router = APIRouter(
        prefix="/internal/support",
        dependencies=[Depends(authorize)],
        include_in_schema=False,
    )

    @router.get("/version")
    async def version():
        return {"service": "arcreel", "build": build, "actorId": actor}

    @router.get("/evidence")
    async def evidence(request: Request):
        query = request.query_params
        allowed = {
            "actorId",
            "start",
            "end",
            "taskId",
            "requestId",
            "projectId",
            "traceId",
            "limit",
        }
        if set(query) - allowed or any(len(query.getlist(key)) != 1 for key in query):
            raise SupportReadError(400, "invalid_support_query")
        if query.get("actorId") != actor:
            raise SupportReadError(403, "support_actor_mismatch")
        try:
            end = timestamp(query["end"]) if "end" in query else datetime.now(UTC)
            start = (
                timestamp(query["start"])
                if "start" in query
                else end - timedelta(hours=24)
            )
            limit = int(query.get("limit", "50"))
            if not 1 <= limit <= 100 or not start <= end or end - start > MAX_WINDOW:
                raise ValueError("unbounded query")
        except (ValueError, TypeError, OverflowError):
            raise SupportReadError(400, "invalid_support_window_or_limit") from None
        filters = {
            key: query[key]
            for key in ("taskId", "requestId", "projectId", "traceId")
            if key in query
        }
        if any(not identifier(value) for value in filters.values()):
            raise SupportReadError(400, "invalid_support_identifier")
        records_filter_unsupported = "requestId" in filters or "traceId" in filters
        if records_filter_unsupported:
            # Never broaden persisted records to satisfy a log-only filter. / 日志专用筛选不能放宽持久化记录范围。
            records, sources, truncated = (
                [],
                {
                    "sqlite": "not_queried_unsupported_correlation",
                    "projects": "not_queried_unsupported_correlation",
                },
                False,
            )
        else:
            records, sources, truncated = await asyncio.to_thread(
                read_records, database, projects_dir, start, end, filters, limit
            )
        (
            selected_logs,
            log_read_ok,
            log_truncated,
            log_gap,
            earliest,
        ) = await asyncio.to_thread(
            read_http_logs, log_path, actor, start, end, filters, limit
        )
        log_available = log_read_ok and log_handler is not None and log_handler.write_ok
        operations_available = bool(sources) and all(
            value in {"read_only_sqlite", "project_json_metadata"}
            for value in sources.values()
        )
        return {
            "service": "arcreel",
            "build": build,
            "incomplete": bool(
                not operations_available or not log_available or log_gap
            ),
            "scope": {
                "actorId": actor,
                "start": start.isoformat(),
                "end": end.isoformat(),
                **filters,
            },
            "records": records,
            "logs": selected_logs,
            "coverage": {
                "operations": {
                    "available": operations_available,
                    **(
                        {}
                        if operations_available
                        else {
                            "reason": "native_records_request_trace_filter_unsupported"
                            if records_filter_unsupported
                            else "native_source_unavailable_or_partial"
                        }
                    ),
                },
                "inboundHttp": {
                    "available": log_available,
                    "retention": "2_rotating_files_x_1MiB_read_max_2MiB_5000_lines",
                    **(
                        {"reason": "native_log_read_or_write_failed"}
                        if not log_available
                        else {"reason": "retained_history_gap"}
                        if log_gap
                        else {}
                    ),
                },
                "sources": sources,
                "recordTimeField": "updatedAt",
                "agentRuns": "agent_sessions_snapshot_not_per_turn_history",
                "recordCorrelation": {"requestId": False, "traceId": False},
                "logs": {
                    "source": "rotating_native_jsonl_and_stdout",
                    "earliestRetainedAt": earliest.isoformat() if earliest else None,
                    "restartHistoryAvailable": True,
                    "historyGap": log_gap,
                    "includesCurrentRequest": False,
                    "traceIdAvailable": True,
                },
                "errorCodeAvailable": False,
            },
            "truncated": bool(truncated or log_truncated),
        }

    # Reserve these exact paths before the SPA catch-all. / 精确端点须优先于 SPA fallback。
    existing = len(app.router.routes)
    app.include_router(router)
    app.router.routes[:] = app.router.routes[existing:] + app.router.routes[:existing]

    @app.middleware("http")
    async def support_http_log(request: Request, call_next):
        path = request.url.path
        if path.startswith(("/internal/support/", "/health/")) or path in {
            "/internal/support",
            "/health",
            "/version",
            "/api/version",
            "/api/v1/version",
        }:
            return await call_next(request)
        request_id = identifier(request.headers.get("x-request-id")) or str(uuid4())
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            if getattr(request.state, "fg_arcreel_admitted", False):
                request_id = (
                    identifier(request.headers.get("x-request-id")) or request_id
                )
            response.headers["X-Request-ID"] = request_id
            return response
        finally:
            # Only the admission middleware can establish business identity. / 仅入口认证成功后可归属业务日志。
            if getattr(request.state, "fg_arcreel_admitted", False):
                route = request.scope.get("route")
                row = {
                    "event": "support_http_request",
                    "auth": "runtime_capability",
                    "entry_accepted": True,
                    "timestamp": datetime.now(UTC).isoformat(),
                    "service": "arcreel",
                    "actor_id": actor if identifier(actor) else "unknown",
                    "request_id": request_id,
                    "method": request.method
                    if request.method
                    in {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}
                    else "OTHER",
                    "route": getattr(route, "path", None) or "unmatched",
                    "http_status": status,
                    "build_commit": build["commit"],
                    "build_environment": build["environment"],
                    "build_dirty": build["dirty"],
                }
                for param, key in (
                    ("name", "project_id"),
                    ("project_name", "project_id"),
                    ("task_id", "task_id"),
                ):
                    value = identifier(request.path_params.get(param))
                    if value:
                        row[key] = value
                trace_id = identifier(request.headers.get("x-trace-id"))
                if trace_id:
                    row["trace_id"] = trace_id
                message = json.dumps(row, separators=(",", ":"))
                if log_handler is not None:
                    log_handler.handle(
                        logging.LogRecord(
                            "arcreel.support", logging.INFO, "", 0, message, (), None
                        )
                    )
                # stdout carries only the same allowlist. / stdout 只输出同一安全字段集合。
                try:
                    print(message, flush=True)
                except OSError:
                    pass
