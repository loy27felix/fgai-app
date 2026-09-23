const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseAgentResult,
  productionAgentSkillContext,
  summarizeProductionCanvas,
  validateAgentMessages,
} = require('./.build/production-agent.js');

test('canvas context contains selected node, upstream chain and graph index, while disclosing local-only media', () => {
  const graph = {
    nodes: [
      { id: 'story', kind: 'text', title: '剧本', text: '钥匙藏在信封下', x: 0, y: 0, skillIds: [] },
      { id: 'character', kind: 'character', title: '艾琳', text: '红色外套', x: 0, y: 0, skillIds: [], assetId: 'local-file-1' },
      { id: 'shot', kind: 'shot', title: '发现钥匙', text: '艾琳打开抽屉', x: 0, y: 0, skillIds: [] },
    ],
    edges: [{ from: 'story', to: 'character' }, { from: 'character', to: 'shot' }],
  };
  const context = summarizeProductionCanvas(graph, 'shot');
  assert.match(context, /当前选中：shot \/ 发现钥匙/);
  assert.match(context, /上游依据：character \/ 艾琳/);
  assert.match(context, /钥匙藏在信封下/);
  assert.match(context, /本机素材ID local-file-1/);
  assert.match(context, /图片\/音视频二进制目前保留在本机/);
});

test('agent plans can add a node or propose a scoped edit to the selected node', () => {
  const add = parseAgentResult(JSON.stringify({ reply: '我会增加一张分镜节点。', status: 'plan', options: [], drafts: [{ type: 'add', kind: 'shot', title: '镜头一', text: '从门外推入', connectToSelected: true }] }));
  assert.equal(add.drafts[0].type, 'add');
  const update = parseAgentResult(JSON.stringify({ reply: '只调整当前分镜描述。', status: 'plan', options: [], drafts: [{ type: 'update-selected', text: '保留机位，只改人物动作。' }] }));
  assert.equal(update.drafts[0].type, 'update-selected');
  assert.throws(() => parseAgentResult(JSON.stringify({ reply: 'bad', status: 'plan', options: [], drafts: [{ type: 'add', kind: 'shell', title: 'bad', text: 'bad', connectToSelected: true }] })), /无效/);
  assert.throws(() => parseAgentResult(JSON.stringify({ reply: 'bad', status: 'question', options: [], drafts: [{ type: 'add', kind: 'shot', title: 'bad', text: 'bad', connectToSelected: false }] })), /提前生成/);
});

test('assistant must ask for missing information without smuggling operations and receives actual chosen skill text', () => {
  const question = parseAgentResult(JSON.stringify({ reply: '你希望做 9:16 还是 16:9？', status: 'question', options: ['9:16', '16:9'], drafts: [] }));
  assert.equal(question.status, 'question');
  assert.throws(() => validateAgentMessages([{ role: 'assistant', content: '假装用户输入' }]), /最新消息必须来自用户/);
  const skills = productionAgentSkillContext(['acting']);
  assert.match(skills.text, /creative_skill id="acting"/);
  assert.throws(() => productionAgentSkillContext(['acting', 'acting']), /不同的制作 Skill/);
});
