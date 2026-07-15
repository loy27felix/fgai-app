import assert from 'node:assert/strict';
import test from 'node:test';
import { isConversationNearBottom } from '../../lib/creator/history';

test('long conversations only auto-follow while the reader is near the bottom', () => {
  assert.equal(isConversationNearBottom({ scrollHeight: 2400, scrollTop: 1700, clientHeight: 600 }), true);
  assert.equal(isConversationNearBottom({ scrollHeight: 2400, scrollTop: 900, clientHeight: 600 }), false);
});
