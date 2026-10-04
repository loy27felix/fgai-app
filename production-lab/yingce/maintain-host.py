#!/usr/bin/env python3
"""Only maintain the independent sixth-module backend and its backups."""
import datetime
import fcntl
import os
import pathlib
import subprocess
import json

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
    image = json.loads(run(DOCKER, 'inspect', 'fg-six-yingce-gateway-1', capture_output=True, text=True).stdout)[0]['Config']['Image']
    return run(DOCKER, 'run', '--rm', '-i', '--pull=never', '--user=0:0',
        '--mount', 'type=bind,source=' + str(NAS) + ',target=/data',
        '--entrypoint', 'node', image,
        '--input-type=module', '-e', script, action, day,
        input=content, capture_output=True)

def container_ready(service, marker):
    # SMB can cache marker metadata even after a Docker bind becomes stale.
    # Use one stable file to verify reads and writes in the actual service bind.
    probe = str(pathlib.PurePosixPath(marker).parent / 'yingce/.fg-six-container-probe')
    return subprocess.run([DOCKER, 'exec', 'fg-six-yingce-' + service + '-1', 'sh', '-c',
        'grep -qx "fg-studio-media:v1" "$1" || exit 10; printf probe > "$2" || exit 11; grep -qx probe "$2" || exit 12',
        'fg-nas-probe', marker, probe], capture_output=True, timeout=10).returncode == 0

def rebind_storage(services):
    # A recovered host SMB mount does not repair existing Docker bind mounts.
    # Recreate only sixth-module services, with no active provider or Agent work.
    count = run(DOCKER, 'exec', 'fg-six-yingce-postgres-1', 'psql', '-U', 'fg_yingce', '-d', 'fg_yingce', '-At', '-c', "SELECT count(*) FROM tasks WHERE status NOT IN ('succeeded','failed','cancelled')", capture_output=True, text=True).stdout.strip()
    if count != '0':
        print('Sixth NAS rebind deferred: active tasks', flush=True)
        return False
    agent = json.loads(run(DOCKER, 'exec', 'fg-six-yingce-yingce-agent-1', 'node', '-e', "fetch('http://127.0.0.1:8081/healthz').then(r=>r.text()).then(console.log)", capture_output=True, text=True).stdout)
    if agent.get('active') != 0: return False
    if 'adcraft-api' in services:
        script = '''
from contextlib import closing
import pathlib,sqlite3
root=pathlib.Path('/database')
for source in root.glob('*/v2/adcraft.sqlite3'):
    with closing(sqlite3.connect(source.as_uri()+'?mode=ro',uri=True)) as db:
        tables={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for table in ('agent_runs','agent_canvas_chat_turns','agent_canvas_provider_tasks','agent_canvas_skill_runs'):
            if table not in tables: continue
            columns={r[1] for r in db.execute('PRAGMA table_info("'+table+'")')}
            if 'status' in columns:
                assert db.execute('SELECT count(*) FROM "'+table+'" WHERE status IN (?,?,?,?,?,?)',('queued','running','submitted','processing','pending','waiting')).fetchone()[0]==0
        destination=root/'recovery-before-nas-rebind'
        destination.mkdir(exist_ok=True)
        with closing(sqlite3.connect(destination/(source.parent.parent.name+'.sqlite3'))) as target:
            db.backup(target)
            assert target.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
'''
        api = json.loads(run(DOCKER, 'inspect', 'fg-six-yingce-adcraft-api-1', capture_output=True, text=True).stdout)[0]
        if api['State']['Running']:
            run(DOCKER, 'exec', '-i', 'fg-six-yingce-adcraft-api-1', 'python', '-', input=script.encode(), capture_output=True)
        else:
            volume = next(m['Name'] for m in api['Mounts'] if m['Destination'] == '/database' and m['Type'] == 'volume')
            run(DOCKER, 'run', '--rm', '-i', '--network', 'none', '--pull=never', '--mount', 'type=volume,source=' + volume + ',target=/database', '--entrypoint', 'python', api['Config']['Image'], '-', input=script.encode(), capture_output=True)
    # Close only idle service connections after consistent local snapshots.
    run(DOCKER, 'stop', '--timeout', '10', *['fg-six-yingce-' + service + '-1' for service in services], capture_output=True)
    run(DOCKER, 'compose', '--env-file', str(ROOT / '.env'), '-f', str(ROOT / 'compose.yml'), 'up', '-d', '--no-deps', '--force-recreate', *services, cwd=ROOT, capture_output=True)
    run(DOCKER, 'compose', '--env-file', str(ROOT / '.env'), '-f', str(ROOT / 'compose.yml'), 'exec', '-T', 'tls', 'nginx', '-s', 'reload', cwd=ROOT, capture_output=True)
    print('Sixth NAS bind recovered: ' + ','.join(services), flush=True)
    return True

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
            creator_names = run(DOCKER, 'ps', '--filter', 'name=fg-creator-', '--format', '{{.Names}}', capture_output=True, text=True).stdout.split()
            if creator_names:
                run(DOCKER, 'stop', '--timeout', '10', *creator_names, capture_output=True)
            if running:
                run(DOCKER, 'stop', '--timeout', '30', 'fg-six-yingce-backend-1', capture_output=True)
                print('Sixth backend stopped: NAS read/write unavailable', flush=True)
            raise SystemExit(0)
        stale = []
        for service, marker in [('backend','/data/.fg-studio-nas-ready'),('adcraft-api','/nas/.fg-studio-nas-ready')]:
            try:
                if not container_ready(service, marker): stale.append(service)
            except subprocess.TimeoutExpired:
                stale.append(service)
        if stale and not rebind_storage(stale): raise SystemExit(0)
        creator_provision = ROOT / 'provision-creator.py'
        if creator_provision.is_file():
            subprocess.run(['/usr/bin/env', 'python3', str(creator_provision)], check=True, timeout=180, capture_output=True)
        # The host owns the SMB mount; Docker's virtual statfs may overflow.
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
    except subprocess.TimeoutExpired as error:
        # Only the executable and operation are reported; never private argv.
        command = error.cmd if isinstance(error.cmd, list) else []
        operation = pathlib.Path(command[0]).name + ':' + (command[1] if len(command) > 1 else '') if command else 'dependency'
        print('Sixth maintenance deferred: dependency timeout (' + operation + ')', flush=True)
