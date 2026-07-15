import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCreatorContextMessages } from '../../lib/creator/chat';

test('reasoning mode adds a provider-neutral system instruction', () => {
  const messages = buildCreatorContextMessages(
    [{ role: 'user', content: { text: '检查这个方案' }, status: 'complete' }],
    { reasoning: true },
  );

  assert.equal(messages[0]?.role, 'system');
  assert.match(messages[0]?.content || '', /reasoning mode/i);
  assert.match(messages[0]?.content || '', /verify/i);
  assert.deepEqual(messages[1], { role: 'user', content: '检查这个方案' });
});
