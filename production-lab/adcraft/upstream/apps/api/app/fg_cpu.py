"""Bound local exports separately from the cloud model queue."""
from pathlib import Path
from threading import BoundedSemaphore
import subprocess

_render_slots = BoundedSemaphore(2)
_run = subprocess.run

def limited_run(*args, **kwargs):
    command = args[0] if args else kwargs.get('args')
    if isinstance(command, (list, tuple)) and command and Path(str(command[0])).name == 'ffmpeg':
        with _render_slots: return _run(*args, **kwargs)
    return _run(*args, **kwargs)

def install():
    subprocess.run = limited_run
