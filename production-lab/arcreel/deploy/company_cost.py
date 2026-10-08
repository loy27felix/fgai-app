"""Use the company's rate snapshot; never fall back to a different vendor."""
import json
import urllib.request

def install(base, capability):
    from lib.billing.cost_calculator import CostCalculator

    def calculate(self, provider, params, *, estimate_only=False, **kwargs):
        mode = params.call_type
        options = {'size': params.size or params.aspect_ratio or '16:9', 'quality': params.quality or '', 'vquality': params.resolution or '720p', 'videoSeconds': params.duration_seconds or 5, 'count': str(params.n), 'videoGenerateAudio': 'true' if params.generate_audio else 'false'}
        payload = {'model': params.model, 'estimate': estimate_only, 'options': options, 'inputs': {}}
        if not estimate_only:
            from company_request import fg_task
            payload['taskId'] = fg_task.get()
            usage = {'input_tokens': params.input_tokens, 'output_tokens': params.output_tokens if mode == 'text' else params.usage_tokens}
            image_usage = {'input_tokens_details': {'text_tokens': params.text_input_tokens, 'image_tokens': params.image_input_tokens}, 'output_tokens_details': {'text_tokens': params.text_output_tokens, 'image_tokens': params.image_output_tokens}}
            payload['call'] = {'status': 'succeeded', 'usage_available': True, 'input_tokens': usage['input_tokens'], 'output_tokens': usage['output_tokens'], 'media_count': params.n, 'request_body': json.dumps({'size': params.size, 'quality': params.quality, 'resolution': params.resolution, 'content': []}), 'response_body': json.dumps({'usage': image_usage})}
        request = urllib.request.Request(base+'/cost', data=json.dumps(payload).encode(), headers={'Authorization': 'Bearer '+capability, 'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=15) as response:
            result = json.load(response)
        amount = result.get('estimatedCny')
        if amount is None:
            raise ValueError('该参数的费用尚不能准确估算；请在 FG 人民币费用页查看费率和实际账单。')
        return float(amount), 'CNY'

    CostCalculator.calculate_cost = calculate
