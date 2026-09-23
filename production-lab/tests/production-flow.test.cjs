const { test } = require('node:test');
const assert = require('node:assert/strict');
const { splitScriptIntoShots, applyDraft } = require('./.build/canvas-draft.js');
const { buildProjectStartGraph, buildScriptStoryboardGraph } = require('./.build/production-flow.js');

const topic = { id: 23, title: '丈夫禁止进入的房间', original: '蓝胡子｜佩罗', plot: '原型线索', conflict: '每条新证据都使一条逃生路径失效。', tier: '优先', form: 'AI真人', style: '婚姻悬疑', markets: '北美', confidence: '开发假设', sourceName: '佩罗童话', sourceRights: '待清查', capturedAt: '2026-09-23T00:00:00Z' };
const project = { id: 'p1', title: topic.title, topicId: topic.id, topicSnapshot: topic, source: '推进台 #23', brief: topic.conflict, tier: 'A', market: '北美英语', style: 'AI真人 / 婚姻悬疑', team: '试制组', ownerId: 'u1', ownerName: '负责人', deadline: '', initialMinutes: 20, totalMinutes: 100, budgetCny: 0, stage: '剧本开发', direction: '妻子主动调查丈夫的禁室，逐步发现营救前妻的线索。', bible: '角色、场景、道具、规则和分集连续性。', ruleVersion: 'v1', deliveryUrl: '', createdAt: 'now', updatedAt: 'now' };

test('a selected topic persists into project context and each reviewable shot node', () => {
  const start = buildProjectStartGraph(project, undefined, 1);
  assert.equal(start.nodes[0].metadata.topicId, 23);
  assert.ok(start.nodes[0].text.includes('每条新证据'));
  assert.ok(start.edges.some(edge => edge.from === start.nodes[0].id && edge.to === start.nodes[1].id));
  const text = '第1场｜内景、庄园书房、夜\n镜头01｜特写｜缓慢推近\n画面：艾琳发现钥匙。\n声音：钟声。\n镜头02｜近景｜固定机位\n画面：丈夫看见她的手。\n对白：把钥匙放下。';
  const storyboard = buildScriptStoryboardGraph(start, { project, episode: 1, taskId: 't1', version: 1, title: 'EP01 / v1', script: text });
  assert.equal(storyboard.shotNodeIds.length, 2);
  const scriptNode = storyboard.graph.nodes.find(node => node.id === storyboard.scriptNodeId);
  assert.equal(scriptNode.metadata.role, 'script');
  assert.equal(scriptNode.metadata.topicId, 23);
  assert.equal(storyboard.graph.nodes.filter(node => node.metadata?.role === 'shot' && node.metadata.topicId === 23).length, 2);
  assert.ok(storyboard.graph.edges.some(edge => edge.from === storyboard.scriptNodeId && edge.to === storyboard.shotNodeIds[0]));
  assert.equal(applyDraft(storyboard.graph, []).nodes.length, 5);
});

test('unstructured scripts still become a small editable shot outline', () => {
  const shots = splitScriptIntoShots('艾琳推开书房的门，发现抽屉里藏着钥匙。\n\n丈夫听到声响走进房间，两人互相试探。');
  assert.equal(shots.length, 2);
  assert.ok(shots.every(shot => shot.text.length > 0));
});
