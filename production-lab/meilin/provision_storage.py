"""Prepare actor directories through Docker's verified NAS mount.

macOS background jobs may not have the interactive login's volume access.
No Docker socket or provider credentials enter the temporary storage worker.
"""
import json
import pathlib
import re
import subprocess

D = '/usr/local/bin/docker'
SCRIPT = r'''
const fs = require('node:fs');
const path = require('node:path');
const kind = process.argv[1], users = JSON.parse(process.argv[2]);
if (!['arcreel', 'opencreator'].includes(kind)) throw Error('Invalid storage kind');
if (fs.readFileSync('/nas/media/.fg-studio-nas-ready', 'utf8').trim() !== 'fg-studio-media:v1') throw Error('NAS unavailable');
const root = fs.realpathSync('/nas');
function directory(relative) {
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    try { fs.mkdirSync(current); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (fs.lstatSync(current).isSymbolicLink() || fs.realpathSync(current) !== current) throw Error('Unsafe workspace directory');
  }
  return current;
}
function marker(folder, name, value) {
  const target = path.join(folder, name);
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw Error('Unsafe workspace marker');
  fs.writeFileSync(target, value);
  if (fs.readFileSync(target, 'utf8') !== value) throw Error('Workspace storage verification failed');
}
for (const user of users) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(user)) throw Error('Invalid workspace actor');
  marker(directory('media/' + kind + '/users/' + user), kind === 'arcreel' ? '.fg-arcreel-ready' : '.fg-creator-ready', kind === 'opencreator' ? 'FG private creator workspace\n' : 'FG private workspace\n');
  marker(directory('recycle/' + kind + '/' + user), '.fg-recycle-ready', 'FG actor recycle v1\n');
}
console.log('ready');
'''


def prepare_runtime_storage(nas, kind, users):
    nas = pathlib.Path(nas)
    assert nas.name == 'media' and nas.parent == pathlib.Path('/Volumes/FgStudio')
    assert kind in ('arcreel', 'opencreator')
    assert all(re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', user) for user in users)
    result = subprocess.run([D, 'inspect', 'fg-six-yingce-gateway-1'], capture_output=True, text=True, timeout=20)
    if result.returncode:
        raise RuntimeError('Workspace storage worker image unavailable')
    image = json.loads(result.stdout)[0]['Config']['Image']
    result = subprocess.run([D, 'run', '--rm', '--pull=never', '--network=none', '--cpus=0.5', '--memory=128m', '--pids-limit=64', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--mount', 'type=bind,source=' + str(nas.parent) + ',target=/nas', '--entrypoint=node', image, '-e', SCRIPT, kind, json.dumps(users)], capture_output=True, text=True, timeout=45)
    if result.returncode or result.stdout.strip() != 'ready':
        raise RuntimeError('Workspace NAS preparation failed; private diagnostics omitted')
