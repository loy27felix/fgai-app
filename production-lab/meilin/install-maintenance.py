#!/usr/bin/env python3
"""Install a missing maintenance job; never interrupt a loaded production job."""
import os
import pathlib
import plistlib
import re
import subprocess
import sys

LABEL = 'com.fgstudio.six.yingce'


def main():
    root = pathlib.Path(__file__).resolve().parent
    domain = 'gui/' + str(os.getuid())
    loaded = subprocess.run(['launchctl', 'print', domain + '/' + LABEL], capture_output=True, text=True)
    if loaded.returncode == 0:
        print(LABEL + ' is already loaded; leaving the job and plist unchanged')
        return
    if 'Could not find service' not in loaded.stderr:
        raise RuntimeError('Cannot determine maintenance job state; refusing installation')
    disabled = subprocess.run(['launchctl', 'print-disabled', domain], capture_output=True, text=True, check=True)
    if re.search(r'"' + re.escape(LABEL) + r'"\s*=>\s*(?:disabled|true)\b', disabled.stdout):
        raise RuntimeError('Maintenance job is explicitly disabled; refusing installation')
    if not (root / 'maintain-host.py').is_file():
        raise RuntimeError('Missing maintain-host.py; refusing installation')
    folder = pathlib.Path.home() / 'Library' / 'LaunchAgents'
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / (LABEL + '.plist')
    document = {
        'Label': LABEL,
        'ProgramArguments': [sys.executable, str(root / 'maintain-host.py')],
        'WorkingDirectory': str(root), 'RunAtLoad': True, 'StartInterval': 60,
        'StandardOutPath': str(root / 'maintenance.log'),
        'StandardErrorPath': str(root / 'maintenance-error.log'),
        'EnvironmentVariables': {'PATH': '/usr/local/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/bin:/bin:/usr/sbin:/sbin'},
    }
    temporary = target.with_suffix('.plist.new')
    temporary.write_bytes(plistlib.dumps(document))
    temporary.chmod(0o600)
    subprocess.run(['plutil', '-lint', str(temporary)], capture_output=True, check=True)
    temporary.replace(target)
    subprocess.run(['launchctl', 'bootstrap', domain, str(target)], check=True)
    print('Registered missing maintenance job; no loaded job was stopped')


if __name__ == '__main__':
    main()
