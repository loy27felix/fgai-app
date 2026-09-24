const { test } = require('node:test');
const assert = require('node:assert/strict');
const { teamSelectedTopics } = require('./.build/selected-topics.js');

test('records the nine team-selected topics exactly as shown without inventing story or rights facts', () => {
  assert.deepEqual(teamSelectedTopics.map(topic => topic.title), [
    '春天临前不要爱上我', '我的影子取代了我', '醒来之前，我已经过完一生',
    '被夺走人生后，她再次归来', '他直到最后才认出我', '醒来后，我的王国被继承了',
    '失去声音以后，我要选择自己', '被女儿顶替的公主', '一只猫替我活了人生',
  ]);
  assert.deepEqual(teamSelectedTopics.map(topic => topic.selection_group), [
    '小组1', '小组1', '小组1', '小组1', '小组1', '小组1', '小组2', '小组2', '小组2',
  ]);
  assert.ok(teamSelectedTopics.every(topic => topic.original === '待补充；未从截图推断' && topic.source_rights === '待核验'));
  assert.deepEqual(teamSelectedTopics.slice(0, 6).map(topic => topic.selected_by), ['杨苏玉', '罗香雪', '罗香雪', '杨苏玉', '吴怡萍', '吴怡萍']);
  assert.deepEqual(teamSelectedTopics.slice(6).map(topic => topic.selected_at), ['9月22日 15:13', '9月22日 15:25', '9月22日 16:04']);
});
