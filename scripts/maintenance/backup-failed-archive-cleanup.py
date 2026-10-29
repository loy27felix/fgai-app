#!/usr/bin/env python3
"""Plan cleanup of failed host disaster archives; never delete successful backups."""
import argparse
import ast
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re

FAILED_ARCHIVE_GUARD = '''            # A failed streaming tar is not a recovery point. Keep its failure
            # manifest, but discard only the archive created for this attempt.
            if item["kind"] == "state" and target.suffix == ".tar":
                if target.is_symlink() or target.parent != directory:
                    raise RuntimeError("unsafe failed archive path")
                target.unlink(missing_ok=True)
'''


def checked_root(root):
    if not root.is_absolute() or any(p.is_symlink() for p in (root, *root.parents)) or root.resolve() != root:
        raise RuntimeError("Unsafe backup root")
    return root


def install_failure_guard(root):
    """Update the next invocation; do not stop or reload any supervisor."""
    target = checked_root(root) / "tools/disaster-backup.py"
    if target.is_symlink():
        raise RuntimeError("Symlink tool refused")
    source = target.read_text()
    if FAILED_ARCHIVE_GUARD in source:
        return False
    anchor = '        except RuntimeError as error:\n            result["error"] = str(error)\n        result["completedAt"] = now()'
    if source.count(anchor) != 1:
        raise RuntimeError("Backup implementation changed; review required")
    updated = source.replace(anchor, anchor.replace('        result["completedAt"]', FAILED_ARCHIVE_GUARD + '        result["completedAt"]'))
    ast.parse(updated)
    temporary = target.with_name(".disaster-backup.py.failed-archive-fix")
    with temporary.open("x") as stream:
        os.chmod(temporary, 0o700)
        stream.write(updated)
    temporary.replace(target)
    return True


def plan(root, now):
    root = checked_root(root)
    groups = {}
    for directory in root.iterdir():
        if directory.is_symlink() or not directory.is_dir() or not re.fullmatch(r"\d{8}T\d{6}-[0-9a-f]{8}", directory.name):
            continue
        manifest = directory / "manifest.json"
        if manifest.is_symlink() or not manifest.is_file():
            continue
        record = json.loads(manifest.read_text())
        if record.get("producer") != "fg-disaster-backup-v1" or record.get("complete") or not record.get("completedAt"):
            continue
        at = dt.datetime.fromisoformat(record["completedAt"])
        for item in record.get("results", []):
            if item.get("kind") != "state" or item.get("success") or item.get("file"):
                continue
            key = hashlib.sha256(json.dumps({k: item[k] for k in ("kind", "container", "database")}, sort_keys=True).encode()).hexdigest()
            target = directory / (key + ".tar")
            if target.is_symlink() or not target.is_file():
                continue
            stat = target.stat()
            if stat.st_nlink != 1 or stat.st_uid != os.getuid():
                continue
            groups.setdefault(key, []).append((at, target, stat, manifest))
    result = []
    for rows in groups.values():
        rows.sort(reverse=True)
        result.extend(row for row in rows[1:] if (now - row[0]).total_seconds() > 3600)
    return result


def apply_plan(root, rows):
    root = checked_root(root)
    with (root / ".lock-sqlite").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for _, target, prior, manifest in rows:
            current = target.lstat()
            record = json.loads(manifest.read_text())
            if target.is_symlink() or target.resolve().parent.parent != root:
                raise RuntimeError("Archive path changed")
            if (current.st_ino, current.st_size, current.st_mtime_ns) != (prior.st_ino, prior.st_size, prior.st_mtime_ns):
                raise RuntimeError("Archive changed after planning")
            if record.get("producer") != "fg-disaster-backup-v1" or record.get("complete") or not record.get("completedAt"):
                raise RuntimeError("Package status changed")
            target.unlink()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True, help="Existing host disaster backup root")
    parser.add_argument("--install-failure-guard", action="store_true")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.install_failure_guard:
        print(json.dumps({"failureGuardInstalled": install_failure_guard(args.root)}))
    rows = plan(args.root / "sqlite", dt.datetime.now(dt.timezone.utc))
    print(json.dumps({"failedArchives": len(rows), "bytes": sum(row[2].st_blocks * 512 for row in rows), "successfulBackupsTouched": 0, "applied": args.apply}))
    if args.apply:
        apply_plan(args.root / "sqlite", rows)
