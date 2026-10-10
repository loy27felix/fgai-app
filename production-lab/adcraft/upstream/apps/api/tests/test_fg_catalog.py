"""Free contract tests; no upstream model requests."""
import json
import os
from pathlib import Path
os.environ['FG_ADCRAFT_SECRET'] = 'test-only-secret'
from app.services.provider_model_catalog import install_fg_catalog, StaticProviderCatalogAdapter
from app.schemas.provider_models import ProviderAdapterProfileV1
import app.services.provider_model_catalog as catalog


def test_fg_catalog_uses_real_profiles():
    fixtures = json.loads((Path(__file__).parent / 'fixtures' / 'fg-catalog.json').read_text(encoding='utf-8'))
    install_fg_catalog(fixtures)
    models = catalog._TRUSTED_MANIFESTS
    assert len(models) == len(fixtures)
    assert len(StaticProviderCatalogAdapter('volcengine_ark').discover_model_ids()) == len(fixtures)
    for manifest, row in zip(models, fixtures):
        assert manifest.provider_model_id == row['id']
        assert manifest.display_name == row['name']
        if manifest.capability != 'text':
            profile = ProviderAdapterProfileV1.model_validate(manifest.capability_metadata['adapter_profile'])
            assert profile.model_ref == manifest.model_ref
            assert profile.reference_policy.max_images == row['profile'][manifest.capability]['references']['maxImages']
    sd25 = next(m for m in models if m.provider_model_id == 'dreamina-seedance-2-5-filter-off')
    assert sd25.capability_metadata['duration_range_seconds'] == [4, 30]
    assert sd25.capability_metadata['default_parameters']['generate_audio'] is True


def test_fg_model_preferences_keep_credential_protection():
    from fastapi import HTTPException
    from starlette.requests import Request
    from app.api.v1.endpoints.providers import _ensure_local_access
    from app.core.config import Settings
    from app.fg_context import fg_context
    settings = Settings.from_env()
    def request(path):
        return Request({'type':'http','method':'PATCH','path':path,'headers':[], 'client':('172.18.0.5',1234), 'server':('localhost',8000),'scheme':'http','query_string':b''})
    context = fg_context.set({'workspace':'test-workspace','actor':'test-user'})
    try:
        _ensure_local_access(request('/api/v1/model-defaults'), settings)
        try:
            _ensure_local_access(request('/api/v1/providers'), settings)
        except HTTPException as error:
            assert error.status_code == 403
        else:
            raise AssertionError('FG model preferences must not allow credential mutation')
    finally:
        fg_context.reset(context)
