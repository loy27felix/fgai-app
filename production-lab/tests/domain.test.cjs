const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyCommand, buildScriptPrompt, demoState, EMPTY_STATE } = require('./.build/domain.js');
const reviewer = { id: 'demo-user', name: '测试负责人', reviewer: true };
const member = { ...reviewer, reviewer: false };
function planned(count = 2) { const s = demoState(); return applyCommand(s, { type: 'plan-scripts', projectId: s.projects[0].id, from: 1, count }, reviewer); }
const script = '第一场：艾琳进入庄园书房，发现姐姐留下的钥匙。她决定先隐藏证据，再试探丈夫的反应。结尾：钥匙在门锁中变成红色。';
test('batch planning snapshots the brief without claiming generated output', () => { const s = planned(); assert.equal(s.tasks.length, 2); assert.equal(s.tasks[0].content, ''); assert.equal(s.tasks[0].status, '待编写'); assert.equal(s.tasks[0].bibleSnapshot, s.projects[0].bible); assert.throws(() => applyCommand(s, { type: 'plan-scripts', projectId: s.projects[0].id, from: 2, count: 3 }, reviewer), /已有任务/); assert.equal(s.tasks.length, 2); });
test('topic selection is saved as a structured snapshot and flows into batch writing instructions', () => {
  const topic = { id: 23, title: '丈夫禁止进入的房间', original: '蓝胡子｜佩罗', plot: '禁室谜题', conflict: '每条线索都使逃生路径失效', tier: '优先', form: 'AI真人', style: '婚姻悬疑', markets: '北美', confidence: '开发假设', sourceName: '佩罗', sourceRights: '待清查', capturedAt: '' };
  let state = applyCommand(EMPTY_STATE, { type: 'create', project: { title: topic.title, topicId: topic.id, topicSnapshot: topic } }, reviewer);
  const project = state.projects[0];
  assert.equal(project.topicId, 23);
  assert.equal(project.topicSnapshot.title, topic.title);
  assert.equal(project.topicSnapshot.capturedAt, project.createdAt);
  state = applyCommand(state, { type: 'update', projectId: project.id, changes: { direction: '妻子主动调查禁室和前妻秘密，逐步找到丈夫隐藏的证据。', bible: '人物：妻子与丈夫。规则：每个新证据都会缩小逃生范围；故事持续保持空间与线索连续。' } }, reviewer);
  state = applyCommand(state, { type: 'plan-scripts', projectId: project.id, from: 1, count: 1 }, reviewer);
  const prompt = buildScriptPrompt(state.projects[0], 1);
  assert.match(prompt, /关联选题.*#23/);
  assert.match(prompt, /权利状态：待清查/);
  assert.match(prompt, /镜头N/);
  assert.equal(state.tasks[0].status, '待编写');
});
test('topic id cannot accidentally attach a mismatched snapshot', () => {
  const state = applyCommand(EMPTY_STATE, { type: 'create', project: { title: '原创项目', topicId: 23, topicSnapshot: { id: 24, title: '另一个选题' } } }, reviewer);
  assert.equal(state.projects[0].topicId, 23);
  assert.equal(state.projects[0].topicSnapshot, undefined);
});
test('full local path connects a topic project to approved batch screenplay and sample-production gate', () => {
  let state = applyCommand(EMPTY_STATE, { type: 'create', project: { title: '禁室样片', topicId: 23, topicSnapshot: { id: 23, title: '丈夫禁止进入的房间', original: '佩罗', plot: script, conflict: script, sourceName: '佩罗童话', sourceRights: '待清查', form: 'AI真人', style: '悬疑', markets: '北美', confidence: '开发假设', tier: '优先' } } }, reviewer);
  const project = state.projects[0];
  state = applyCommand(state, { type: 'update', projectId: project.id, changes: { direction: '妻子主动调查禁室与丈夫秘密，拿到关键线索后面临逃生选择。', bible: '角色：妻子、丈夫。场景：庄园与禁室。规则：线索改变逃生条件。分集连续性以钥匙与书信为准。' } }, reviewer);
  state = applyCommand(state, { type: 'plan-scripts', projectId: project.id, from: 1, count: 1 }, reviewer);
  state = applyCommand(state, { type: 'save-script', taskId: state.tasks[0].id, content: script, source: '人工录入' }, member);
  state = applyCommand(state, { type: 'review-script', taskId: state.tasks[0].id, approve: true, note: '通过' }, reviewer);
  state = applyCommand(state, { type: 'advance', projectId: project.id }, reviewer);
  assert.equal(state.projects[0].topicId, 23);
  assert.equal(state.projects[0].stage, '样片制作');
  assert.equal(state.tasks[0].status, '已通过');
});
test('unauthorized member cannot edit another project or approve a script', () => { let s = planned(1); assert.throws(() => applyCommand(s, { type: 'save-script', taskId: s.tasks[0].id, content: script }, { id: 'other', name: 'other', reviewer: false }), /负责人/); s = applyCommand(s, { type: 'save-script', taskId: s.tasks[0].id, content: script }, member); assert.throws(() => applyCommand(s, { type: 'review-script', taskId: s.tasks[0].id, approve: true, note: '' }, member), /审核人/); });
test('gate prevents production with incomplete or rejected scripts', () => { let s = planned(1); const command = { type: 'advance', projectId: s.projects[0].id }; assert.throws(() => applyCommand(s, command, reviewer), /全部通过/); s = applyCommand(s, { type: 'save-script', taskId: s.tasks[0].id, content: script }, member); assert.throws(() => applyCommand(s, { type: 'review-script', taskId: s.tasks[0].id, approve: false, note: '' }, reviewer), /说明修改原因/); s = applyCommand(s, { type: 'review-script', taskId: s.tasks[0].id, approve: true, note: '通过' }, reviewer); s = applyCommand(s, command, reviewer); assert.equal(s.projects[0].stage, '样片制作'); assert.throws(() => applyCommand(s, { type: 'save-script', taskId: s.tasks[0].id, content: script }, member), /已进入制作/); });
test('upstream direction is locked after planning; edited scripts lose approval and retain history', () => { let s = planned(1); assert.throws(() => applyCommand(s, { type: 'update', projectId: s.projects[0].id, changes: { direction: '改成完全不同的冒险与爱情故事，人物全部替换。' } }, member), /已锁定/); s = applyCommand(s, { type: 'save-script', taskId: s.tasks[0].id, content: script }, member); s = applyCommand(s, { type: 'review-script', taskId: s.tasks[0].id, approve: true, note: '通过' }, reviewer); s = applyCommand(s, { type: 'save-script', taskId: s.tasks[0].id, content: script + '第二版结尾补充新的悬念。' }, member); assert.equal(s.tasks[0].status, '待审核'); assert.equal(s.tasks[0].history[0].content, script); assert.equal(s.tasks[0].history[0].status, '已通过'); assert.equal(s.tasks[0].version, 2); });
test('delivery requires a safe HTTP(S) link and completed preceding gates', () => { let s = planned(1); s = applyCommand(s, { type: 'save-script', taskId: s.tasks[0].id, content: script }, member); s = applyCommand(s, { type: 'review-script', taskId: s.tasks[0].id, approve: true, note: '' }, reviewer); const c = { type: 'advance', projectId: s.projects[0].id }; for (let i = 0; i < 3; i++) s = applyCommand(s, c, reviewer); assert.equal(s.projects[0].stage, '验收'); assert.throws(() => applyCommand(s, { ...c, deliveryUrl: 'javascript:alert(1)' }, reviewer), /交付/); s = applyCommand(s, { ...c, deliveryUrl: 'https://example.com/delivery' }, reviewer); assert.equal(s.projects[0].stage, '已交付'); });
