"""Consistent SQLite snapshots on NAS; the active database remains server-side."""
import os
from contextlib import closing
from pathlib import Path
import sqlite3
import re
import shutil
from uuid import uuid4

NAS = Path('/nas')

def require_nas():
    if not (NAS / '.fg-studio-nas-ready').is_file():
        raise RuntimeError('NAS 未挂载，广告工程已停止写入')

def database_paths(workspace):
    active = Path(os.environ['FG_ADCRAFT_SQLITE_ROOT']) / workspace / 'v2/adcraft.sqlite3'
    snapshot = NAS / 'adcraft/workspaces' / workspace / 'database-backup/adcraft.sqlite3'
    return active, snapshot

def purge_marker(workspace):
    active, _ = database_paths(workspace)
    return active.parent.parent / '.fg-purged'

def require_workspace(workspace):
    require_nas()
    if purge_marker(workspace).exists():
        raise RuntimeError('广告工程已到期清理，不能重新创建或恢复')

def purge_workspace(workspace):
    require_nas()
    if not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', workspace):
        raise ValueError('Invalid workspace')
    active, _ = database_paths(workspace)
    # Retain the small server-side database as an audit record; never retain its
    # media snapshot on NAS after the recoverable trash period.
    if active.exists():
        with closing(sqlite3.connect(active.as_uri() + '?mode=ro', uri=True)) as db:
            tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            for table in ('agent_runs', 'agent_canvas_chat_turns', 'agent_canvas_provider_tasks', 'agent_canvas_skill_runs'):
                if table not in tables: continue
                columns = {r[1] for r in db.execute('PRAGMA table_info("' + table + '")')}
                if 'status' in columns and db.execute('SELECT count(*) FROM "' + table + '" WHERE status IN (?,?,?,?,?,?)', ('queued','running','submitted','processing','pending','waiting')).fetchone()[0]:
                    raise RuntimeError('广告工程仍有任务，稍后重试清理')
    base = NAS / 'adcraft/workspaces'
    target = base / workspace
    if target.is_symlink() or NAS.resolve() not in base.resolve().parents or target.resolve().parent != base.resolve():
        raise RuntimeError('Unsafe workspace path')
    marker = purge_marker(workspace)
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text('Expired advertising trash; NAS media removed.\n')
    if target.exists(): shutil.rmtree(target)
    return {'purged': True}

def restore(workspace):
    require_workspace(workspace)
    active, snapshot = database_paths(workspace)
    if active.exists() or not snapshot.exists(): return
    active.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(snapshot)) as source, closing(sqlite3.connect(active)) as target:
        if source.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('广告工程备份校验失败，请恢复备份')
        source.backup(target)

def backup(workspace):
    require_nas()
    if purge_marker(workspace).exists(): return
    active, snapshot = database_paths(workspace)
    if not active.exists(): return
    snapshot.parent.mkdir(parents=True, exist_ok=True)
    temporary = snapshot.with_suffix('.' + uuid4().hex + '.tmp')
    try:
        with closing(sqlite3.connect(active, timeout=30)) as source, closing(sqlite3.connect(temporary)) as target:
            source.backup(target)
            if target.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError('广告工程备份校验失败')
        os.replace(temporary, snapshot)
    finally:
        temporary.unlink(missing_ok=True)
