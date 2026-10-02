#!/usr/bin/env python3
"""Only maintain the independent sixth-module backend and its backups."""
import datetime
import fcntl
import os
import pathlib
import subprocess

os.umask(0o077)
ROOT = pathlib.Path(__file__).resolve().parent
NAS = pathlib.Path('/Volumes/FgStudio/media')
DOCKER = '/usr/local/bin/docker'
os.environ['PATH'] = '/usr/local/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/bin:/bin:/usr/sbin:/sbin'

def run(*args, **kwargs):
    return subprocess.run(args, check=True, timeout=45, **kwargs)

def storage(action, day='', content=None):
    # Probe from the application's Docker NAS share. The macOS LaunchAgent
    # must not interpret its own host filesystem permission as a NAS outage.
    script = (ROOT / 'maintenance-storage.mjs').read_text(encoding='utf-8')
    return run(DOCKER, 'run', '--rm', '-i', '--pull=never', '--user=0:0',
        '--mount', 'type=bind,source=' + str(NAS) + ',target=/data',
        '--entrypoint', 'node', 'fg-six-yingce-gateway',
        '--input-type=module', '-e', script, action, day,
        input=content, capture_output=True)

with (ROOT / '.maintenance.lock').open('a') as lock:
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit(0)
    try:
        running = run(DOCKER, 'inspect', 'fg-six-yingce-backend-1', '--format', '{{.State.Running}}', capture_output=True, text=True).stdout.strip() == 'true'
        try:
            storage('probe')
            ready = True
        except subprocess.CalledProcessError as error:
            if error.returncode != 2:
                raise
            ready = False
        if not ready:
            if running:
                run(DOCKER, 'stop', '--timeout', '30', 'fg-six-yingce-backend-1', capture_output=True)
                print('Sixth backend stopped: NAS read/write unavailable', flush=True)
            raise SystemExit(0)
        if not running:
            run(DOCKER, 'compose', '--env-file', str(ROOT / '.env'), '-f', str(ROOT / 'compose.yml'), 'start', 'backend', cwd=ROOT, capture_output=True)
            print('Sixth backend started after NAS read/write check', flush=True)
        # The host owns the SMB mount; Docker's virtual statfs may overflow.
        import json
        fields = run('/bin/df', '-k', str(NAS), capture_output=True, text=True).stdout.splitlines()[-1].split()
        total, used, free = (int(value) * 1024 for value in fields[1:4])
        if total <= 0 or not 0 <= used <= total or not 0 <= free <= total:
            raise RuntimeError('Invalid NAS capacity snapshot')
        metrics = ROOT / 'host-metrics'
        metrics.mkdir(exist_ok=True, mode=0o755)
        metrics.chmod(0o755)
        snapshot = metrics / '.nas.new'
        snapshot.write_text(json.dumps({'totalBytes': total, 'usedBytes': used, 'freeBytes': free, 'collectedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}))
        snapshot.chmod(0o644)
        snapshot.replace(metrics / 'nas.json')
        day = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d')
        if storage('exists', day).stdout.strip() == b'missing':
            dump = run(DOCKER, 'exec', 'fg-six-yingce-postgres-1', 'pg_dump', '-U', 'fg_yingce', '-d', 'fg_yingce', '--format=custom', capture_output=True).stdout
            if not dump.startswith(b'PGDMP'):
                raise RuntimeError('Backup format validation failed')
            run(DOCKER, 'exec', '-i', 'fg-six-yingce-postgres-1', 'pg_restore', '--list', input=dump, capture_output=True)
            storage('backup', day, dump)
            print('Sixth database backup verified: ' + day + '.dump', flush=True)
    except subprocess.CalledProcessError:
        print('Sixth maintenance deferred: Docker service not ready', flush=True)
    except subprocess.TimeoutExpired:
        print('Sixth maintenance deferred: dependency timeout', flush=True)
