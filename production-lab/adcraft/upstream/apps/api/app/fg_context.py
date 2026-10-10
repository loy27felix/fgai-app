"""Trusted FG request identity. Never use browser-supplied identity directly."""
from contextvars import ContextVar, copy_context
from concurrent.futures import ThreadPoolExecutor as BaseExecutor
from threading import Thread as BaseThread
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
from uuid import uuid4

def work_context(resource_id: str, context: dict) -> dict:
    """Persist accepted work attribution; recovery cannot charge another collaborator."""
    workspace = context.get('workspace')
    if not workspace: return context
    root = Path('/nas/adcraft/workspaces') / workspace / 'fg-context'
    root.mkdir(parents=True, exist_ok=True)
    path = root / (hashlib.sha256(resource_id.encode()).hexdigest() + '.json')
    if context.get('actor'):
        temporary = path.with_suffix('.' + uuid4().hex + '.tmp')
        temporary.write_text(json.dumps(context))
        os.replace(temporary, path)
        return context
    if path.is_file(): return json.loads(path.read_text())
    return context

fg_context: ContextVar[dict] = ContextVar('fg_context', default={})

def continuation_context(source_turn: str, next_turn: str, context: dict) -> dict:
    """Recover the accepted turn's actor, never a polling collaborator's actor."""
    accepted = work_context(source_turn, {'workspace': context.get('workspace')})
    if accepted.get('actor'):
        work_context(next_turn, accepted)
    return accepted

def bridge_token(context: dict) -> str:
    raw = base64.urlsafe_b64encode(json.dumps(context, separators=(',', ':')).encode()).decode().rstrip('=')
    signature = hmac.new(os.environ['FG_ADCRAFT_SECRET'].encode(), raw.encode(), hashlib.sha256).hexdigest()
    return raw + '.' + signature

def headers(settings) -> dict[str, str]:
    context = fg_context.get()
    if not context.get('actor'):
        raise RuntimeError('FG 操作身份缺失，请从广告项目重新提交；未发起模型请求')
    return {'Authorization': 'Bearer ' + bridge_token(context), 'Content-Type': 'application/json'}

class ThreadPoolExecutor(BaseExecutor):
    def submit(self, fn, /, *args, **kwargs):
        return super().submit(copy_context().run, fn, *args, **kwargs)

class Thread(BaseThread):
    def __init__(self, *args, **kwargs):
        target = kwargs.get('target')
        if target is not None:
            context = copy_context()
            kwargs['target'] = lambda *a, **k: context.run(target, *a, **k)
        super().__init__(*args, **kwargs)
