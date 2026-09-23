const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scriptMessages } = require('./.build/text-models.js');

test('script batch preserves the direction and previous episode while generating one selected episode', () => {
  const messages = scriptMessages({ brief: '方向：女孩找到钥匙后隐藏证据', previous: '第 1 集：信封被锁进柜子', episode: 2, count: 5, skillIds: [] });
  assert.match(messages[1].content, /找到钥匙后隐藏证据/);
  assert.match(messages[1].content, /信封被锁进柜子/);
  assert.match(messages[1].content, /只写第 2 集，全季 5 集/);
});

test('script batch rejects unsupported skills and invalid episode ranges', () => {
  const base = { brief: '测试方向至少十个字', previous: '', episode: 1, count: 2, skillIds: [] };
  assert.throws(() => scriptMessages({ ...base, skillIds: ['lark-im'] }), /格式无效/);
  assert.throws(() => scriptMessages({ ...base, episode: 3 }), /格式无效/);
});
