"""Project FG's enabled catalog onto AdCraft's native adapter contracts."""
from copy import deepcopy
from dataclasses import replace


def manifests_for_fg(templates, models):
    by_capability = {m.capability: m for m in templates}
    result = []
    for row in models:
        capability = row['capability']
        # The shared company catalog also contains speech models. AdCraft's
        # native adapters cover text/image/video; speech uses FG's audio tools.
        # A newly enabled capability must not prevent existing projects opening.
        template = by_capability.get(capability)
        if template is None:
            continue
        metadata = deepcopy(template.capability_metadata)
        model_ref = 'volcengine_ark:' + row['id']
        profile = row['profile'][capability]
        refs = profile['references']
        metadata['capability_revision'] = 'fg-' + row['id'] + '-v2'
        metadata['accepted_input_types'] = ['text'] + [kind for kind in ('image', 'video', 'audio') if refs.get('max' + kind.title() + 's', 0)]
        metadata['reference_limits'] = {kind: refs.get('max' + kind.title() + 's', 0) for kind in ('image', 'video', 'audio')}
        metadata['max_references'] = sum(metadata['reference_limits'].values())
        if capability == 'text':
            metadata.update(supports_tool_calls=True, supports_streaming=False, supports_streamed_tool_calls=False, supports_reasoning_controls=False, reasoning_control='none', structured_transport='non_streaming_tool_call')
        else:
            adapter = metadata['adapter_profile']
            adapter['model_ref'] = model_ref
            adapter['capability_revision'] = metadata['capability_revision']
            adapter['reference_policy']['max_images'] = refs.get('maxImages', 0)
            for mode in adapter['reference_policy']['modes']:
                if mode['mode'] != 'text_only': mode['max_references'] = metadata['max_references']
            descriptors = []
            defaults = {}
            if capability == 'image':
                size = profile['size']
                descriptors.append(dict(name='size', value_type='enum', allowed_values=size['values'], default=size['default']))
                defaults['size'] = size['default']
                metadata['supported_aspect_ratios'] = list(dict.fromkeys(p['ratio'] for p in size.get('presets', []))) or (size['values'] if size['parameter'] == 'aspect_ratio' else ['1:1', '16:9', '9:16'])
                metadata['supported_sizes_by_aspect_ratio'] = {p['ratio']: p['size'] for p in reversed(size.get('presets', []))}
                descriptors.append(dict(name='aspect_ratio',value_type='enum',allowed_values=metadata['supported_aspect_ratios']))
                if profile['quality']['supported']:
                    quality = profile['quality']
                    descriptors.append(dict(name='quality', value_type='enum', allowed_values=quality['values'], default=quality['default']))
                    defaults['quality'] = quality['default']
            else:
                duration = profile['duration']
                resolution = next(value for value in profile['resolutions'] if value.lower() == profile['defaultResolution'].lower())
                descriptors.extend([
                    dict(name='duration_seconds', value_type='integer', minimum=min(duration['values']), maximum=max(duration['values']), default=duration['default']),
                    dict(name='resolution', value_type='enum', allowed_values=profile['resolutions'], default=resolution),
                    dict(name='aspect_ratio', value_type='enum', allowed_values=profile['ratios'], default=profile['defaultRatio']),
                ])
                defaults.update(duration_seconds=duration['default'], resolution=resolution, aspect_ratio=profile['defaultRatio'])
                metadata.update(supported_resolutions=profile['resolutions'], supported_aspect_ratios=profile['ratios'], duration_range_seconds=[min(duration['values']), max(duration['values'])], supports_native_audio=profile['generateAudio']['supported'])
                if profile['generateAudio']['supported']:
                    descriptors.append(dict(name='generate_audio', value_type='boolean', default=profile['generateAudio']['default']))
                    defaults['generate_audio'] = profile['generateAudio']['default']
            metadata['supported_parameters'] = [d['name'] for d in descriptors]
            metadata['default_parameters'] = defaults
            adapter['parameter_matrix'] = dict(schema_id=adapter['parameter_schema_id'], revision='fg-v2', descriptors=descriptors, legal_combinations=[])
        result.append(replace(template, provider_model_id=row['id'], display_name=row['name'], capability_metadata=metadata))
    return tuple(result)
