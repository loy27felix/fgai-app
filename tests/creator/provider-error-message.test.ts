import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeProviderErrorMessage } from '../../lib/creator/provider-error-message';

test('maps output pixel validation separately from reference file size', () => {
  const message = normalizeProviderErrorMessage(
    "The parameter 'size' specified in the request is not valid: image size must be at least 3686400 pixels.",
    { status: 400, subject: 'image' },
  );
  assert.equal(message, '当前模型要求输出图片至少 3686400 像素，请在图片设置中调高清晰度或更换支持的输出尺寸后重试');
  assert.doesNotMatch(message, /parameter|specified|pixels/i);
});

test('maps provider policy and network diagnostics to actionable Chinese messages', () => {
  assert.match(
    normalizeProviderErrorMessage('Request blocked by content safety policy', { status: 400, subject: 'video' }),
    /版权或内容安全限制/,
  );
  assert.match(
    normalizeProviderErrorMessage(new Error('fetch failed: ECONNRESET'), { subject: 'video' }),
    /网络出现波动/,
  );
});

test('maps reference byte limits without confusing them with provider output size', () => {
  assert.match(
    normalizeProviderErrorMessage('reference file size must be between 300KB and 7MB', { status: 400, subject: 'reference' }),
    /参考图片大小需在 300KB–7MB 之间/,
  );
  assert.match(
    normalizeProviderErrorMessage('reference image width must be between 300px and 6000px', { status: 400, subject: 'reference' }),
    /宽和高均需在 300–6000px/,
  );
});

test('maps provider video ratio diagnostics to an actionable Chinese message', () => {
  const message = normalizeProviderErrorMessage('the ratio is not valid', { status: 400, subject: 'video' });
  assert.equal(message, '视频画幅比例不受支持，请选择模型支持的比例后重试');
  assert.doesNotMatch(message, /ratio|invalid/i);
});

test('never exposes an unmapped English provider paragraph to the canvas', () => {
  assert.equal(
    normalizeProviderErrorMessage('Internal upstream parameter exploded with opaque details', { status: 500, subject: 'image' }),
    '图片生成失败，模型服务暂时不可用，请稍后重试',
  );
});
