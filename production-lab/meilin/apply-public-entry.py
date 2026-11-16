"""Hot-load the sixth-module namespace without rebuilding the five-module app."""
import datetime
import fcntl
import hashlib
import json
import os
import pathlib
import subprocess
import sys

DOCKER = '/usr/local/bin/docker'
STAGE = pathlib.Path(__file__).resolve().parent
CONFIG = pathlib.Path('/Users/server/work/fgai-app/docker/nginx/default.conf')
NAS = pathlib.Path('/Volumes/FgStudio/media')
LOCK = pathlib.Path('/Users/server/work/fg-six-yingce/.maintenance.lock')
LIVE = '/etc/nginx/fg-studio-live.conf'


def run(*args, **kwargs):
    return subprocess.run([DOCKER, *args], check=True, capture_output=True, **kwargs).stdout


def app_state():
    info = json.loads(run('inspect', 'fgai-app-app-1'))[0]
    assert info['State']['Running']
    assert info['Image'] == 'sha256:27c10b7913c26864b813f85f362c612989fbc06184c7abcea7bcbc4a0a2c26cc'
    return info['Image'], info['State']['StartedAt']


def write_host(data):
    assert CONFIG.resolve() == CONFIG
    with CONFIG.open('wb') as output:
        output.write(data)
        output.flush()
        os.fsync(output.fileno())


fragment = pathlib.Path(sys.argv[1]).resolve()
assert STAGE.resolve() in fragment.parents
assert (NAS / '.fg-studio-nas-ready').read_text().strip() == 'fg-studio-media:v1'
with LOCK.open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    before = app_state()
    assert run('inspect', 'fg-six-yingce-gateway-1', '--format', '{{.State.Health.Status}}').strip() == b'healthy'
    original = CONFIG.read_bytes()
    live_before = run('exec', 'fgai-app-nginx-1', 'cat', LIVE)
    root = run('exec', 'fgai-app-nginx-1', 'cat', '/etc/nginx/nginx.conf')
    include = b'include /etc/nginx/fg-studio-live.conf;'
    assert root.count(include) == 1
    begin, end = '    # BEGIN FG SIX YINGCE ENTRY\n', '    # END FG SIX YINGCE ENTRY\n'
    text = original.decode('utf-8')
    assert text.count(begin) == text.count(end) == 1
    start = text.index(begin)
    stop = text.index(end, start) + len(end)
    candidate = (text[:start] + begin + fragment.read_text().replace('\r\n', '\n') + end + text[stop:]).encode()
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup = NAS / 'yingce' / 'backups' / ('public-entry-' + stamp)
    backup.mkdir(mode=0o700)
    for name, data in [('nginx-host.conf', original), ('nginx-live.conf', live_before)]:
        target = backup / name
        target.write_bytes(data)
        target.chmod(0o600)
    temporary = '/tmp/fg-public-entry-' + stamp + '.conf'
    temporary_root = '/tmp/fg-public-root-' + stamp + '.conf'
    run('exec', '-i', 'fgai-app-nginx-1', 'tee', temporary, input=candidate)
    run('exec', '-i', 'fgai-app-nginx-1', 'tee', temporary_root, input=root.replace(include, ('include '+temporary+';').encode()))
    run('exec', 'fgai-app-nginx-1', 'nginx', '-t', '-c', temporary_root)
    try:
        write_host(candidate)
        run('exec', '-i', 'fgai-app-nginx-1', 'tee', LIVE, input=candidate)
        observed = run('exec', 'fgai-app-nginx-1', 'sha256sum', LIVE).split()[0].decode()
        assert observed == hashlib.sha256(candidate).hexdigest()
        run('exec', 'fgai-app-nginx-1', 'nginx', '-t')
        run('exec', 'fgai-app-nginx-1', 'nginx', '-s', 'reload')
        assert app_state() == before
    except Exception:
        write_host(original)
        run('exec', '-i', 'fgai-app-nginx-1', 'tee', LIVE, input=live_before)
        run('exec', 'fgai-app-nginx-1', 'nginx', '-t')
        run('exec', 'fgai-app-nginx-1', 'nginx', '-s', 'reload')
        raise
    print(json.dumps({'entryReloaded': True, 'originalAppUnchanged': True, 'backup': str(backup)}))
