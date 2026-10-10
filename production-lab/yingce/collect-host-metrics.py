#!/usr/bin/env python3
"""Collect the Mac's FG NAS capacity without Docker or NAS file writes."""
import datetime
import fcntl
import json
import os
import pathlib
import subprocess
import sys
import time

NAS = '/Volumes/FgStudio/media'


def parse_capacity(output):
    fields = output.strip().splitlines()[-1].split()
    # An unmounted share resolves to the Mac's local disk. Never report that as NAS.
    if len(fields) < 6 or not fields[0].startswith('//') or fields[-1] != '/Volumes/FgStudio':
        raise ValueError('FG NAS is not mounted')
    total, used, free = (int(value) * 1024 for value in fields[1:4])
    if total <= 0 or not 0 <= used <= total or not 0 <= free <= total:
        raise ValueError('Invalid FG NAS capacity')
    return {'totalBytes': total, 'usedBytes': used, 'freeBytes': free}


def collect(root):
    root = root.resolve(strict=True)
    metrics = root / 'host-metrics'
    if metrics.is_symlink():
        raise ValueError('Host metrics must be a local FG directory')
    metrics.mkdir(exist_ok=True, mode=0o755)
    with (root / '.host-metrics.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        target = metrics / 'nas.json'
        if target.exists() and time.time() - target.stat().st_mtime < 60:
            return
        result = subprocess.run(['/bin/df', '-Pk', NAS], check=True,
                                capture_output=True, text=True, timeout=4)
        snapshot = {**parse_capacity(result.stdout),
                    'collectedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
        temporary = metrics / ('.nas-' + str(os.getpid()) + '.new')
        try:
            with temporary.open('x') as file:
                json.dump(snapshot, file)
            temporary.chmod(0o644)
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)


if __name__ == '__main__':
    try:
        # This deployed sibling directory already owns the read-only gateway mount.
        root = pathlib.Path(__file__).resolve().parents[2].parent / 'fg-six-yingce'
        if root.is_dir():
            collect(root)
    except (OSError, ValueError, subprocess.SubprocessError):
        # Keep the old timestamp; the gateway reports stale capacity as unavailable.
        print('FG NAS capacity collection deferred', file=sys.stderr)
