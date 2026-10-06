"""The shared catalog can grow without breaking native advertising adapters."""
from dataclasses import dataclass, field
from app.fg_catalog import manifests_for_fg


@dataclass
class Manifest:
    capability: str
    provider_model_id: str = ''
    display_name: str = ''
    capability_metadata: dict = field(default_factory=dict)


def test_unhandled_company_capabilities_do_not_break_existing_models():
    templates = [Manifest('text')]
    text = dict(capability='text', id='sonnet', name='Sonnet',
                profile={'text': {'references': {'maxImages': 2}}})
    rows = [dict(capability='audio', id='seed-tts-2.0'), text,
            dict(capability='transcription', id='volc.seedasr.auc')]
    result = manifests_for_fg(templates, rows)
    assert len(result) == 1
    assert result[0].provider_model_id == 'sonnet'
    assert result[0].capability_metadata['reference_limits']['image'] == 2
    assert templates[0].capability_metadata == {}
