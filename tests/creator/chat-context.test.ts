import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCreatorContextMessages } from '../../lib/creator/chat';

test('selected Skill is applied as model system context', () => {
  const messages = buildCreatorContextMessages(
    [{ role: 'user', content: { text: '把这个故事拆成镜头' }, status: 'complete' }],
    {
      skill: {
        name: '分镜设计',
        content: '先锁定人物位置、朝向和镜头原点，再逐镜头拆解。',
      },
    },
  );

  assert.equal(messages[0]?.role, 'system');
  assert.match(messages[0]?.content || '', /分镜设计/);
  assert.match(messages[0]?.content || '', /锁定人物位置/);
  assert.deepEqual(messages[1], { role: 'user', content: '把这个故事拆成镜头' });
});
