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

def purge_trashed_project(workspace, project_id):
    """Remove a legacy orphan project and its FK-owned workflow records.

    The reusable asset catalog is independent of projects and remains protected.
    Its files are removed by library/workspace deletion, never by a workflow FK.
    """
    require_workspace(workspace)
    if not re.fullmatch(r'proj_[A-Za-z0-9_-]{1,100}', project_id):
        raise ValueError('Invalid project')
    active, _ = database_paths(workspace)
    with closing(sqlite3.connect(active, timeout=30)) as db:
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('BEGIN IMMEDIATE')
        db.execute('PRAGMA defer_foreign_keys=ON')
        project = db.execute('SELECT rowid,* FROM projects WHERE project_id=?', (project_id,)).fetchone()
        if not project or project['status'] != 'trashed':
            raise RuntimeError('Only trashed projects can be permanently removed')
        tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        tables = [t for t in tables if re.fullmatch(r'[A-Za-z0-9_]+', t)]
        for table in ('agent_runs','agent_canvas_chat_turns','agent_canvas_provider_tasks','agent_canvas_skill_runs'):
            if table not in tables: continue
            columns = {r[1] for r in db.execute('PRAGMA table_info("'+table+'")')}
            if 'status' in columns and db.execute('SELECT count(*) FROM "'+table+'" WHERE status IN (?,?,?,?,?,?)', ('queued','running','submitted','processing','pending','waiting')).fetchone()[0]:
                raise RuntimeError('Workspace has running tasks')
        owned = {'projects': {project['rowid']: project}}
        changed = True
        while changed:
            changed = False
            for table in tables:
                for fk in db.execute('PRAGMA foreign_key_list("'+table+'")').fetchall():
                    parent, child_column, parent_column = fk[2], fk[3], fk[4]
                    if parent not in owned or not parent_column: continue
                    values = list({r[parent_column] for r in owned[parent].values() if r[parent_column] is not None})
                    for offset in range(0,len(values),400):
                        batch = values[offset:offset+400]
                        for row in db.execute('SELECT rowid,* FROM "'+table+'" WHERE "'+child_column+'" IN ('+','.join('?' for _ in batch)+')', batch).fetchall():
                            selected = owned.setdefault(table,{})
                            if row['rowid'] not in selected: selected[row['rowid']] = row; changed = True
        for table, rows in reversed(list(owned.items())):
            for rowid in rows: db.execute('DELETE FROM "'+table+'" WHERE rowid=?', (rowid,))
        db.commit()
    backup(workspace)
    return {'purged': True, 'libraryFilesRetained': True}

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
