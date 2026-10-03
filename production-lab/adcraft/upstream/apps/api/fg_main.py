"""One native AdCraft application per authorised FG advertising workspace."""
import asyncio
from contextlib import AsyncExitStack
from dataclasses import fields, replace
import os
from pathlib import Path
import re
from uuid import uuid4
from starlette.responses import JSONResponse
from app.core.config import Settings
from app.fg_context import fg_context
from app.fg_backup import backup, restore, require_nas
from app.fg_cpu import install as install_render_limit
from app.main import create_app

ID = re.compile(r'^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
install_render_limit()

class FGApplication:
    def __init__(self):
        self.apps = {}
        self.lock = asyncio.Lock()
        self.stack = AsyncExitStack()
        self.backup_task = None

    async def snapshots(self):
        while True:
            await asyncio.sleep(60)
            for workspace in list(self.apps):
                try: await asyncio.to_thread(backup, workspace)
                except Exception as error: print('FG NAS backup failed:', type(error).__name__, flush=True)

    async def workspace(self, workspace):
        async with self.lock:
            if workspace not in self.apps:
                await asyncio.to_thread(restore, workspace)
                base = 'http://gateway:3010/internal/adcraft/' + workspace
                settings = Settings.from_env()
                overrides = {f.name: 'gpt-5.6-sol-t1a' for f in fields(settings) if f.name.startswith('llm_') and f.name.endswith('_model')}
                overrides.update(app_name='FG 广告工作台', app_version='1.2.3', media_data_dir=Path('/nas/adcraft/workspaces') / workspace,
                    media_mode='real', agent_runtime_mode='real', skip_audio_agents=True,
                    agent_runtime_internal_token=os.environ['FG_ADCRAFT_SECRET'], agent_runtime_base_url='http://adcraft-agent:8765/w/' + workspace,
                    llm_api_key='fg-internal-only', llm_base_url=base + '/v1',
                    image_generation_api_key='fg-internal-only', image_generation_endpoint=base + '/images/generations',
                    image_generation_model='doubao-seedream-5-0-lite-260128',
                    video_generation_api_key='fg-internal-only', video_generation_endpoint=base + '/contents/generations/tasks',
                    video_generation_model='doubao-seedance-2-0-fast-260128', video_generation_generate_audio=True,
                    provider_max_attempts_image=1, provider_max_attempts_video=1,
                    agent_runtime_read_timeout_seconds=1800, agent_runtime_run_timeout_seconds=1800)
                # Native credential broker uses the same internal bridge, never a WeToken key.
                for name in ('volcengine_ark_api_key',):
                    if name in {f.name for f in fields(settings)}: overrides[name] = 'fg-internal-only'
                for name in ('volcengine_ark_text_base_url', 'volcengine_ark_base_url'):
                    if name in {f.name for f in fields(settings)}: overrides[name] = base + '/v1'
                app = create_app(replace(settings, **overrides))
                empty = fg_context.set({'workspace': workspace})
                try:
                    await self.stack.enter_async_context(app.router.lifespan_context(app))
                finally:
                    fg_context.reset(empty)
                self.apps[workspace] = app
            return self.apps[workspace]

    async def __call__(self, scope, receive, send):
        if scope['type'] == 'lifespan':
            while True:
                message = await receive()
                if message['type'] == 'lifespan.startup':
                    require_nas()
                    self.backup_task = asyncio.create_task(self.snapshots())
                    await send({'type': 'lifespan.startup.complete'})
                elif message['type'] == 'lifespan.shutdown':
                    if self.backup_task: self.backup_task.cancel()
                    await self.stack.aclose()
                    for workspace in list(self.apps): await asyncio.to_thread(backup, workspace)
                    await send({'type': 'lifespan.shutdown.complete'})
                    return
        if scope['type'] != 'http': return
        if scope['path'] == '/health/live':
            try: require_nas()
            except RuntimeError: return await JSONResponse({'status': 'NAS unavailable'}, status_code=503)(scope, receive, send)
            return await JSONResponse({'status': 'ready', 'workspaces': len(self.apps)})(scope, receive, send)
        match = re.match(r'^/w/([^/]+)(/.*)$', scope['path'])
        headers = dict(scope['headers'])
        if not match or not ID.fullmatch(match[1]) or headers.get(b'x-fg-internal', b'').decode() != os.environ['FG_ADCRAFT_SECRET']:
            return await JSONResponse({'detail': 'FG access denied'}, status_code=403)(scope, receive, send)
        if match[2].startswith('/media/') and (any(part.startswith('.') or part in {'v2','fg-context','database-backup','backups','logs'} for part in match[2].split('/')[2:]) or '.sqlite' in match[2]):
            return await JSONResponse({'detail': 'Not a public media file'}, status_code=403)(scope, receive, send)
        context = {'workspace': match[1], 'actor': headers.get(b'x-fg-actor', b'').decode(), 'operation': headers.get(b'x-fg-operation', b'').decode() or str(uuid4())}
        token = fg_context.set(context)
        try:
            try: require_nas()
            except RuntimeError as error: return await JSONResponse({'detail': str(error)}, status_code=503)(scope, receive, send)
            app = await self.workspace(match[1])
            inner = dict(scope, path=match[2], raw_path=match[2].encode(), root_path='')
            await app(inner, receive, send)
            if scope['method'] not in ('GET','HEAD','OPTIONS'):
                await asyncio.to_thread(backup, match[1])
        finally:
            fg_context.reset(token)

app = FGApplication()
