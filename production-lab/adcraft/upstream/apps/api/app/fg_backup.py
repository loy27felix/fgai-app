"""Consistent SQLite snapshots on NAS; the active database remains server-side."""
import os
from pathlib import Path
import sqlite3
from uuid import uuid4

NAS = Path('/nas')

def require_nas():
    if not (NAS / '.fg-studio-nas-ready').is_file():
        raise RuntimeError('NAS 未挂载，广告工程已停止写入')

def database_paths(workspace):
    active = Path(os.environ['FG_ADCRAFT_SQLITE_ROOT']) / workspace / 'v2/adcraft.sqlite3'
    snapshot = NAS / 'adcraft/workspaces' / workspace / 'database-backup/adcraft.sqlite3'
    return active, snapshot

def restore(workspace):
    require_nas()
    active, snapshot = database_paths(workspace)
    if active.exists() or not snapshot.exists(): return
    active.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(snapshot) as source, sqlite3.connect(active) as target:
        if source.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('广告工程备份校验失败，请恢复备份')
        source.backup(target)

def backup(workspace):
    require_nas()
    active, snapshot = database_paths(workspace)
    if not active.exists(): return
    snapshot.parent.mkdir(parents=True, exist_ok=True)
    temporary = snapshot.with_suffix('.' + uuid4().hex + '.tmp')
    try:
        with sqlite3.connect(active, timeout=30) as source, sqlite3.connect(temporary) as target:
            source.backup(target)
            if target.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError('广告工程备份校验失败')
        os.replace(temporary, snapshot)
    finally:
        temporary.unlink(missing_ok=True)
