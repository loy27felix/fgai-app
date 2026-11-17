#!/usr/bin/env python3
"""Only maintain the independent sixth-module backend and its backups."""
import datetime
import fcntl
import os
import pathlib
import subprocess
import json
import sys
import hashlib
import re
import secrets
from urllib.parse import urlsplit, unquote

RUNTIME_TARGET = os.environ.get('FG_RUNTIME_TARGET', 'platform')
if RUNTIME_TARGET not in ('platform', 'native'):
    raise SystemExit('Sixth maintenance: invalid FG_RUNTIME_TARGET')

os.umask(0o077)
ROOT = pathlib.Path(__file__).resolve().parent
NAS = pathlib.Path('/Volumes/FgStudio/media')
DOCKER = '/usr/local/bin/docker'
os.environ['PATH'] = '/usr/local/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/bin:/bin:/usr/sbin:/sbin'

# Text replay is a browser-managed archive, not a provider worker. Preserve
# recent streams, but an abandoned archive must not prevent NAS recovery forever.
# Unknown task states still block recovery. This query never changes task data.
ACTIVE_TASK_COUNT_SQL = """
SELECT count(*) FROM tasks AS t
WHERE t.status NOT IN ('succeeded','failed','cancelled')
AND (
    t.status <> 'text_replay'
    OR GREATEST(t.created_at, t.updated_at,
        (SELECT max(d.created_at) FROM task_text_delta AS d WHERE d.task_id = t.id))
        > now() - interval '15 minutes'
)
"""

def run(*args, **kwargs):
    return subprocess.run(args, check=True, timeout=45, **kwargs)

def storage(action, day='', content=None, *, native=None, scope=()):
    # Probe from the application's Docker NAS share. The macOS LaunchAgent
    # must not interpret its own host filesystem permission as a NAS outage.
    script = (ROOT / 'maintenance-storage.mjs').read_text(encoding='utf-8')
    image = native['image'] if native else json.loads(run(DOCKER, 'inspect', 'fg-six-yingce-gateway-1', capture_output=True, text=True).stdout)[0]['Config']['Image']
    name = 'fg-six-maintenance-storage-' + str(os.getpid())
    options = []
    nas = NAS
    if native:
        nas = native['nas']
        name = native['project'] + '-maintenance-storage-' + secrets.token_hex(8)
        options = ['--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
                   '--env', 'CANVAS_NAS_GUARD_DIR=/run/fg-nas',
                   '--mount', 'type=bind,source=' + str(native['guard']) + ',target=/run/fg-nas,readonly']
    try:
        return run(DOCKER, 'run', '--rm', '--name', name, '-i', '--pull=never', '--user=0:0',
            '--label', 'com.fgstudio.maintenance=storage',
            *options,
            '--mount', 'type=bind,source=' + str(nas) + ',target=/data',
            '--entrypoint', 'node', image,
            '--input-type=module', '-e', script, action, day, *scope,
            input=content, capture_output=True)
    finally:
        # A timed-out Docker CLI can leave its container running against stale
        # SMB. Remove only this operation's named temporary container.
        try:
            subprocess.run([DOCKER, 'rm', '-f', name], capture_output=True, timeout=8)
        except subprocess.TimeoutExpired:
            pass

def native_maintenance_context():
    # Bind verification selects the existing runtime, never a fallback Compose.
    # 挂载核验只选择既有原生运行实例，不通过回退 Compose 修复或重建。
    values = {}
    for line in (ROOT / '.env').read_text().splitlines():
        key, separator, value = line.partition('=')
        if separator and key in ('FG_NAS_STATE_DIR', 'NAS_MEDIA_PATH', 'NAS_STUDIO_ROOT'):
            values[key] = value.strip().strip('\"\'')
    def setting(key, default=''):
        return os.environ.get(key, values.get(key, default))
    guard = pathlib.Path(setting('FG_NAS_STATE_DIR'))
    nas = pathlib.Path(setting('NAS_MEDIA_PATH'))
    root = pathlib.Path(setting('NAS_STUDIO_ROOT', '/Volumes/FgStudio'))
    project = os.environ.get('COMPOSE_PROJECT_NAME', 'fg-six-yingce')
    if (not re.fullmatch(r'[a-z0-9][a-z0-9_-]*', project)
            or not all(p.is_absolute() for p in (guard, nas, root))
            or guard.resolve(strict=True) != guard or not guard.is_dir()):
        raise RuntimeError('Native maintenance configuration is invalid')
    try:
        (guard / 'disabled').lstat()
    except FileNotFoundError:
        pass
    else:
        raise RuntimeError('Native NAS guard is active; maintenance deferred')
    names = [project + '-' + service + '-1' for service in ('backend', 'gateway', 'postgres')]
    rows = json.loads(run(DOCKER, 'inspect', *names, capture_output=True, text=True).stdout)
    if len(rows) != 3:
        raise RuntimeError('Native maintenance runtime is ambiguous')
    backend_env = dict(value.split('=', 1) for value in rows[0]['Config']['Env'])
    postgres_env = dict(value.split('=', 1) for value in rows[2]['Config']['Env'])
    database = urlsplit(backend_env.get('DATABASE_URL', ''))
    if (backend_env.get('CANVAS_DATABASE_DRIVER') != 'postgres'
            or database.scheme not in ('postgres', 'postgresql') or database.hostname != 'postgres'
            or database.port not in (None, 5432)
            or unquote(database.username or '') != postgres_env.get('POSTGRES_USER')
            or unquote(database.path.removeprefix('/')) != postgres_env.get('POSTGRES_DB')):
        raise RuntimeError('Native backup database does not match backend database')
    for row, service in zip(rows, ('backend', 'gateway', 'postgres')):
        labels = row['Config']['Labels']
        if (not row['State']['Running'] or labels.get('com.docker.compose.project') != project
                or labels.get('com.docker.compose.service') != service):
            raise RuntimeError('Native maintenance runtime identity mismatch')
        if service == 'postgres':
            continue
        env = dict(value.split('=', 1) for value in row['Config']['Env'])
        if env.get('CANVAS_NAS_GUARD_DIR') != '/run/fg-nas':
            raise RuntimeError('Native maintenance runtime guard mismatch')
        required = [('/run/fg-nas', guard, False)]
        if service == 'backend':
            required += [('/data', nas, True), ('/fg-nas-root', root, True)]
            if env.get('CANVAS_FG_NAS_ROOT') != '/fg-nas-root':
                raise RuntimeError('Native maintenance NAS root mismatch')
        elif env.get('FG_AUTH_MODE') != 'native':
            raise RuntimeError('Native maintenance refuses a platform gateway')
        for target, source, writable in required:
            entries = [m for m in row['Mounts'] if m['Destination'] == target]
            if (len(entries) != 1 or entries[0]['Type'] != 'bind'
                    or entries[0]['Source'] != str(source) or entries[0]['RW'] != writable):
                raise RuntimeError('Native maintenance mount mismatch')
    return {'project': project, 'nas': nas, 'guard': guard, 'image': rows[1]['Image'],
            'postgres': names[2], 'gateway': names[1]}

def native_auxiliary_backups(native):
    selected = os.environ.get('FG_NATIVE_AUX_BACKUP_SERVICES', '')
    if not selected:
        return []
    services = selected.split(',')
    if len(services) != len(set(services)) or any(s not in ('support-web', 'observability') for s in services):
        raise RuntimeError('Native auxiliary backup services are invalid')
    postgres = json.loads(run(DOCKER, 'inspect', native['postgres'], capture_output=True, text=True).stdout)[0]
    postgres_env = dict(value.split('=', 1) for value in postgres['Config']['Env'])
    networks = {n['NetworkID'] for n in postgres['NetworkSettings']['Networks'].values()}
    backups = []
    for service in services:
        name = native['project'] + '-' + service + '-1'
        row = json.loads(run(DOCKER, 'inspect', name, capture_output=True, text=True).stdout)[0]
        labels = row['Config']['Labels']
        if (not row['State']['Running'] or labels.get('com.docker.compose.project') != native['project']
                or labels.get('com.docker.compose.service') != service):
            raise RuntimeError('Native auxiliary backup runtime identity mismatch')
        env = dict(value.split('=', 1) for value in row['Config']['Env'])
        if service == 'observability' and env.get('FG_RUNTIME_TARGET') != 'native':
            raise RuntimeError('Native auxiliary backup refuses a platform intake')
        database = urlsplit(env.get('DATABASE_URL', ''))
        dbname = unquote(database.path.removeprefix('/'))
        # Only the already verified project PostgreSQL is supported, never a guessed remote database.
        # 仅支持已核验项目的 PostgreSQL；远程库须另行验证其备份方案，不猜测或改写连接目标。
        shared_namespace = row['HostConfig']['NetworkMode'] == 'container:' + postgres['Id']
        common_network = bool(networks & {n['NetworkID'] for n in row['NetworkSettings']['Networks'].values()})
        local_host = ((database.hostname == 'postgres' and common_network)
                      or (database.hostname in ('127.0.0.1', 'localhost', '::1') and shared_namespace))
        if (database.scheme not in ('postgres', 'postgresql') or not local_host
                or database.port not in (None, 5432) or database.query not in ('', 'sslmode=disable')
                or database.fragment or unquote(database.username or '') != postgres_env.get('POSTGRES_USER')
                or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_-]{0,62}', dbname)
                or dbname == postgres_env.get('POSTGRES_DB') or any(dbname == b[1] for b in backups)):
            raise RuntimeError('Native auxiliary backup database is not a distinct verified local database')
        backups.append((service, dbname))
    return backups

def reject_native_legacy_maintenance():
    row = json.loads(run(DOCKER, 'inspect', 'fg-six-yingce-gateway-1', capture_output=True, text=True).stdout)[0]
    env = dict(value.split('=', 1) for value in row['Config']['Env'])
    if env.get('FG_AUTH_MODE') == 'native':
        raise RuntimeError('Native runtime requires explicit FG_RUNTIME_TARGET=native; legacy maintenance refused')

def maintain_native():
    native = native_maintenance_context()
    auxiliary = native_auxiliary_backups(native)
    ready_script = '''fetch('http://backend:8080/api/health/ready', {signal: AbortSignal.timeout(5000)})
      .then(async r => { if(r.status !== 200 || (await r.json()).data?.checks?.nas !== true) process.exit(1); })
      .catch(() => process.exit(1));'''
    run(DOCKER, 'exec', native['gateway'], 'node', '-e', ready_script, capture_output=True)
    storage('probe', native=native)
    day = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d')
    native_database_backup(native, day)
    for scope in auxiliary:
        native_database_backup(native, day, scope=scope)

def native_database_backup(native, day, *, scope=()):
    options = {'native': native}
    if scope:
        options['scope'] = scope
    exists = storage('exists', day, **options).stdout.strip()
    if exists not in (b'exists', b'missing'):
        raise RuntimeError('Native backup existence probe is invalid')
    if exists == b'exists':
        dump = storage('read', day, **options).stdout
    elif scope:
        dump = run(DOCKER, 'exec', native['postgres'], 'sh', '-c',
                   'exec pg_dump -U "$POSTGRES_USER" --dbname="$1" --format=custom',
                   'fg-auxiliary-backup', scope[1], capture_output=True).stdout
    else:
        dump = run(DOCKER, 'exec', native['postgres'], 'sh', '-c',
                   'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom',
                   capture_output=True).stdout
    if not dump.startswith(b'PGDMP'):
        raise RuntimeError('Native backup format validation failed')
    run(DOCKER, 'exec', '-i', native['postgres'], 'pg_restore', '--list', input=dump, capture_output=True)
    # A readable TOC alone does not detect a truncated or corrupt data stream.
    # 目录可读不能证明数据流完整；完整解码到空设备，不连接或修改任何数据库。
    run(DOCKER, 'exec', '-i', native['postgres'], 'pg_restore', '--file=/dev/null', input=dump, capture_output=True)
    if exists == b'missing':
        storage('backup', day, dump, **options)
        restored = storage('read', day, **options).stdout
        if hashlib.sha256(restored).digest() != hashlib.sha256(dump).digest():
            raise RuntimeError('Native published backup checksum mismatch')
        run(DOCKER, 'exec', '-i', native['postgres'], 'pg_restore', '--list', input=restored, capture_output=True)
    name = '/'.join((*scope, day + '.dump'))
    print('Sixth native database backup verified: ' + name, flush=True)

def container_ready(service, marker):
    # SMB can cache marker metadata even after a Docker bind becomes stale.
    # Use one stable file to verify reads and writes in the actual service bind.
    probe = str(pathlib.PurePosixPath(marker).parent / 'yingce/.fg-six-container-probe')
    return subprocess.run([DOCKER, 'exec', 'fg-six-yingce-' + service + '-1', 'sh', '-c',
        'grep -qx "fg-studio-media:v1" "$1" || exit 10; printf probe > "$2" || exit 11; grep -qx probe "$2" || exit 12',
        'fg-nas-probe', marker, probe], capture_output=True, timeout=10).returncode == 0

def recover_oom_backend(storage_ready):
    # An OOM-exited worker needs its original process back to finish queued jobs.
    # Never bypass the NAS probe or start a deliberately stopped service.
    if not storage_ready:
        return False
    state = json.loads(run(DOCKER, 'inspect', 'fg-six-yingce-backend-1',
                           capture_output=True, text=True).stdout)[0]['State']
    if state.get('Running') or not state.get('OOMKilled'):
        return False
    run(DOCKER, 'start', 'fg-six-yingce-backend-1', capture_output=True)
    print('Sixth backend recovered after OOM; NAS probe verified', flush=True)
    return True


def rebind_storage(services):
    # A recovered host SMB mount does not repair existing Docker bind mounts.
    # Recreate only sixth-module services, with no active provider or Agent work.
    count = run(DOCKER, 'exec', 'fg-six-yingce-postgres-1', 'psql', '-U', 'fg_yingce', '-d', 'fg_yingce', '-At', '-c', ACTIVE_TASK_COUNT_SQL, capture_output=True, text=True).stdout.strip()
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
        if RUNTIME_TARGET == 'native':
            # No stop/start/rebind/provision path is entered by native maintenance.
            # 原生维护不进入停止、启动、重挂或退役工作区准备分支。
            maintain_native()
            raise SystemExit(0)
        reject_native_legacy_maintenance()
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
            director_names = run(DOCKER, 'ps', '--filter', 'name=fg-arcreel-', '--format', '{{.Names}}', capture_output=True, text=True).stdout.split()
            if director_names:
                run(DOCKER, 'stop', '--timeout', '10', *director_names, capture_output=True)
            if running:
                run(DOCKER, 'stop', '--timeout', '30', 'fg-six-yingce-backend-1', capture_output=True)
                print('Sixth backend stopped: NAS read/write unavailable', flush=True)
            raise SystemExit(0)
        if recover_oom_backend(ready):
            running = True
        stale = []
        # Withdrawn advertising services are archived and must not be resurrected
        # by a NAS recovery pass. The shared backend remains protected as before.
        for service, marker in [('backend','/data/.fg-studio-nas-ready')]:
            try:
                if not container_ready(service, marker): stale.append(service)
            except subprocess.TimeoutExpired:
                stale.append(service)
        if stale and not rebind_storage(stale): raise SystemExit(0)
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
        # One workspace's bootstrap failure must not starve other workspaces or backups.
        # Reuse this LaunchAgent's Python rather than resolving a different interpreter.
        provision_status = {}
        for kind in ('creator', 'arcreel'):
            script = ROOT / ('provision-' + kind + '.py')
            if not script.is_file(): continue
            try:
                result = subprocess.run([sys.executable, str(script)], timeout=180, capture_output=True)
                provision_status[kind] = 'ready' if result.returncode == 0 else 'failed'
                if result.returncode:
                    # Report only a known exception class, never private arguments or stderr.
                    diagnostic = result.stderr.decode('utf-8', errors='replace')
                    provision_status[kind + 'Failure'] = next((name for name in ('PermissionError', 'FileNotFoundError', 'AssertionError', 'RuntimeError') if name in diagnostic), 'ProcessError')
            except subprocess.TimeoutExpired:
                provision_status[kind] = 'timeout'
            except OSError:
                provision_status[kind] = 'failed'
            if provision_status[kind] != 'ready':
                print('Sixth ' + kind + ' preparation deferred: ' + provision_status[kind], flush=True)
        provision_status['collectedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        snapshot = metrics / '.provision.new'
        snapshot.write_text(json.dumps(provision_status))
        snapshot.chmod(0o644)
        snapshot.replace(metrics / 'runtime-provision.json')
        day = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d')
        if storage('exists', day).stdout.strip() == b'missing':
            dump = run(DOCKER, 'exec', 'fg-six-yingce-postgres-1', 'pg_dump', '-U', 'fg_yingce', '-d', 'fg_yingce', '--format=custom', capture_output=True).stdout
            if not dump.startswith(b'PGDMP'):
                raise RuntimeError('Backup format validation failed')
            run(DOCKER, 'exec', '-i', 'fg-six-yingce-postgres-1', 'pg_restore', '--list', input=dump, capture_output=True)
            storage('backup', day, dump)
            print('Sixth database backup verified: ' + day + '.dump', flush=True)
    except subprocess.CalledProcessError as error:
        command = error.cmd
        operation = pathlib.Path(command[0]).name + ':' + (command[1] if len(command) > 1 and not command[1].startswith('/') else 'provision')
        print('Sixth maintenance deferred: dependency not ready (' + operation + ', exit=' + str(error.returncode) + ')', flush=True)
    except subprocess.TimeoutExpired as error:
        # Only the executable and operation are reported; never private argv.
        command = error.cmd if isinstance(error.cmd, list) else []
        operation = pathlib.Path(command[0]).name + ':' + (command[1] if len(command) > 1 else '') if command else 'dependency'
        print('Sixth maintenance deferred: dependency timeout (' + operation + ')', flush=True)
