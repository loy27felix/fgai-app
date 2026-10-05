"""Company-managed ArcReel in an actor's isolated container, never the host."""
import asyncio
import json
import os
from pathlib import Path
import urllib.request

actor = os.environ['FG_ARC_ACTOR']
capability = os.environ['FG_ARC_CAPABILITY']
base = 'http://fg-gateway:3010/internal/arcreel/' + actor
from company_request import install as install_company_request
install_company_request(base, capability)

if os.getuid() == 0:
    raise RuntimeError('Director must run as the unprivileged FG user')
Path('/state/home').mkdir(exist_ok=True)

# FG owns admission and recovery. An uncertain paid response is never submitted
# again by a transport or decorator retry in the imported production tool.
import lib.infra.retry as retry_policy
_retry_async = retry_policy.retry_async
async def single_attempt(operation, **kwargs):
    kwargs['max_attempts'] = 1
    return await _retry_async(operation, **kwargs)
retry_policy.retry_async = single_attempt
import lib.backends.openai_shared as openai_factory
_openai_client = openai_factory.create_openai_client
def company_openai_client(**kwargs):
    kwargs['max_retries'] = 0
    return _openai_client(**kwargs)
openai_factory.create_openai_client = company_openai_client
import lib.backends.ark_shared as ark_factory
def company_ark_client(*, api_key=None, base_url=None):
    from volcenginesdkarkruntime import Ark
    return Ark(base_url=ark_factory.ark_base_url(base_url), api_key=ark_factory.resolve_ark_api_key(api_key), max_retries=0)
ark_factory.create_ark_client = company_ark_client

request = urllib.request.Request(base + '/models', headers={'Authorization': 'Bearer ' + capability})
with urllib.request.urlopen(request, timeout=30) as response:
    models = json.load(response)['models']

from lib.config.registry import ModelInfo, ProviderMeta, PROVIDER_REGISTRY
from server import app as native
from lib.db import async_session_factory, init_db
from lib.db.repositories.agent_credential_repo import AgentCredentialRepository
from lib.db.repositories.credential_repository import CredentialRepository
from lib.config.repository import ProviderConfigRepository, SystemSettingRepository

text = [m for m in models if m['capability'] == 'text']
images = [m for m in models if m['capability'] == 'image']
videos = [m for m in models if m['capability'] == 'video']
# Resolve the imported backend's admission gates from the same FG catalog.
from lib.backends.video_backends.ark import ArkVideoBackend
from arcreel_market_core.video_backend_contract import VideoCapabilities, ReferenceAudioMode, VideoAudioMode
_video_profiles = {m['billingId'].removesuffix('-filter-off').replace('seedance-2-0', 'seedance-2.0'): m['profile']['video'] for m in videos}
def company_video_capabilities(model):
    p = _video_profiles.get(model)
    if p is None: raise ValueError('Company video model is not enabled')
    r = p['references']; operations = p['operations']
    return VideoCapabilities(text_to_video='text_to_video' in operations, first_frame='image_to_video' in operations,
        last_frame='seedance' in model, max_reference_images=r['maxImages'] if 'reference_to_video' in operations else 0,
        reference_audio_mode=ReferenceAudioMode.DIRECT if r['maxAudios'] else ReferenceAudioMode.NONE,
        max_reference_audio_count=r['maxAudios'], max_reference_audio_total_seconds=r.get('maxTotalAudioDurationSeconds', r.get('maxAudioDurationSeconds')),
        first_frame_ratio_adaptive_only=p['ratios']==['adaptive'],
        audio_track=VideoAudioMode.CONTROLLABLE if p['generateAudio']['supported'] else VideoAudioMode.ALWAYS_OFF)
ArkVideoBackend.video_capabilities_for_model = staticmethod(company_video_capabilities)

if not text or not images or not videos:
    raise RuntimeError('Company director models are not configured')

openai_models = {m['billingId']: ModelInfo(display_name=m['name'], media_type='text', capabilities=['text_generation', 'structured_output', 'vision'], max_output_tokens=32768, default=m['billingId']=='claude-sonnet-5-5-t3a') for m in text}
openai_models.update({m['billingId']: ModelInfo(display_name=m['name'], media_type='image', capabilities=['text_to_image', 'image_to_image'], default=m['billingId']=='seedream-5-0-lite-260128') for m in images})
video_models = {}
for m in videos:
    key = m['billingId'].removesuffix('-filter-off').replace('seedance-2-0', 'seedance-2.0')
    profile = m['profile']['video']
    durations = profile['duration']
    options = durations['values']
    resolutions = profile.get('resolutions') or ['720P']
    video_models[key] = ModelInfo(display_name=m['name'], media_type='video', capabilities=[], supported_durations=[int(x) for x in options], resolutions=[str(x).lower() for x in resolutions], default='fast' in key)

def provider(name, entries):
    return ProviderMeta(display_name=name, description='FG 公司统一渠道；人民币实际账单和用户月额度在 FG 管理。', required_keys=['api_key'], secret_keys=['api_key'], optional_keys=['base_url'], models=entries, default_base_url=base+'/v1', default_concurrency={'image': 4, 'video': 4})

# Replace the contents of the existing registry, rather than add a competing
# source of model capabilities. ArcReel's native gates continue to apply.
PROVIDER_REGISTRY.clear()
PROVIDER_REGISTRY.update({'openai': provider('WeToken 文本与图片', openai_models), 'ark': provider('WeToken 视频', video_models)})
from company_cost import install as install_company_cost
install_company_cost(base, capability)

async def configure():
    await init_db()
    async with async_session_factory() as session:
        credentials = CredentialRepository(session)
        config = ProviderConfigRepository(session)
        settings = SystemSettingRepository(session)
        for name in ('openai', 'ark'):
            active = await credentials.get_active(name)
            if active is None:
                await credentials.create(name, 'FG 公司渠道', api_key=capability, base_url=base+'/v1')
            else:
                active.api_key = capability
                active.base_url = base+'/v1'
            await config.set(name, 'base_url', base+'/v1')
            if name == 'openai':
                await config.set(name, 'image_endpoint', 'both')
        agents = AgentCredentialRepository(session)
        existing = {c.model: c for c in await agents.list_for_user()}
        for model in text:
            if model['billingId'] not in existing:
                existing[model['billingId']] = await agents.create(preset_id='custom', display_name=model['name'], base_url=base, api_key=capability, model=model['billingId'], haiku_model=model['billingId'], sonnet_model=model['billingId'], opus_model=model['billingId'], subagent_model=model['billingId'])
            else:
                await agents.update(existing[model['billingId']].id, base_url=base, api_key=capability)
        if await settings.get('fg_sonnet_default_v1212') != 'true':
            default = existing.get('claude-sonnet-5-5-t3a') or next(iter(existing.values()))
            await agents.set_active(default.id)
            await settings.set('fg_sonnet_default_v1212', 'true')
            await settings.set('default_text_backend', 'openai/claude-sonnet-5-5-t3a')
        defaults = {'default_text_backend': 'openai/claude-sonnet-5-5-t3a', 'default_image_backend': 'openai/seedream-5-0-lite-260128', 'default_video_backend': 'ark/'+next(k for k in video_models if 'fast' in k)}
        for key, value in defaults.items():
            if not await settings.get(key):
                await settings.set(key, value)
        await settings.set('onboarding_seen', 'true')
        await session.commit()

asyncio.run(configure())

from fastapi import Request
from fastapi.responses import FileResponse, JSONResponse
from server.agent_runtime.agent_access_policy import AgentAccessPolicy
import hmac

# The per-actor container provides filesystem/process isolation. Keep the
# native file hooks and whitelist fallback, and reject arbitrary shell tools.
# No Docker socket, host home, other actor directory or provider key is mounted.
native.check_sandbox_available = lambda: False
AgentAccessPolicy.is_bash_command_whitelisted = classmethod(lambda cls, command: False)

@native.app.middleware('http')
async def company_access(request: Request, call_next):
    if request.url.path != '/health' and not hmac.compare_digest(request.headers.get('x-fg-runtime', ''), capability):
        return JSONResponse({'detail': 'FG workspace access required'}, status_code=403)
    return await call_next(request)

@native.app.get('/fg-source.tar.gz', include_in_schema=False)
async def corresponding_source():
    return FileResponse('/app/fg-source.tar.gz', filename='FG-ArcReel-source.tar.gz')

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(native.app, host='0.0.0.0', port=1241)
