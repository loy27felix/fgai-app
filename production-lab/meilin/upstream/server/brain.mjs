// 美林 orchestration: drama → episodes stage machine, skill executors (mock / live), intent routing.
import { readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DIRECTIONS, STYLE_MUSIC } from './presets.mjs';
import { getModels, byId, defaultModel, defaultParams, fitDuration, planSeconds, segmentRange, maxRefs } from './models.mjs';
import {integrated,context} from './fg-context.mjs';
import * as SK from './skills.mjs';
import * as ST from './styles.mjs';
import { FILES_DIR } from './files.mjs';
import { canReallyGenerate } from './media.mjs';
import { chat, parseJson, parseDirectorTurn, liveText } from './llm.mjs';
import {VIDEO_PROMPT_CONTRACT,validateVideoPrompt} from './video-prompt-contract.mjs';
import {editBrief,editBible,planningInput} from './planning.mjs';
import { renderSegment, lockText, checkContinuity } from './fgformat.mjs';
import * as S from './mock-story.mjs';

const now = () => Date.now();
const iso = () => new Date().toISOString();
export const DRAMA_STAGES = ['brief', 'bible'];
export const EPISODE_STAGES = ['script', 'cast', 'segments', 'shoot', 'post'];

// ---------- creation ----------
export function createDrama(direction = 'overseas-drama') {
  const dir = DIRECTIONS.find((x) => x.id === direction && x.enabled) || DIRECTIONS[0];
  const imageModel = defaultModel('image');
  const videoModel = defaultModel('video');
  const d = {
    id: randomUUID(),
    direction: dir.id,
    mode: liveText ? 'live' : 'mock',
    createdAt: iso(),
    stage: 'brief',
    title: '',
    titleZh: '',
    settings: {
      textModel: defaultModel('text'),
      imageModel, imageParams: defaultParams(imageModel),
      videoModel, videoParams: defaultParams(videoModel, { aspect: dir.defaults.aspect }),
      segmentSeconds: dir.defaults.segmentSeconds, aspect: dir.defaults.aspect, fps: dir.defaults.fps,
      language: dir.defaults.language, episodeSeconds: dir.defaults.episodeSeconds,
      skills: SK.defaults(),
    },
    brief: null,
    bible: null,
    assets: { items: [], confirmed: false },
    episodes: [],
    uploads: [],
    messages: [],
    memory: [],
  };
  migrate(d);
  say(d, `我是美林。海外 AI 短剧已就位：${dir.defaults.aspect} 竖屏、英文台词、主脑 ${byId(d.settings.textModel).label}、出图 ${byId(imageModel).label}、出片 ${byId(videoModel).label}。说一句你想拍的故事，或者让我先给你几个北美正在爆的方向。`);
  return d;
}

function say(d, text) {
  if (text) d.messages.push({ id: randomUUID(), role: 'agent', text, at: iso() });
  return text;
}

// ---------- per-drama memory ----------
// Every drama is its own agent: decisions and things the member asked to remember persist for the whole production.
export function remember(d, text, kind = 'decision', source = 'auto') {
  d.memory ||= [];
  const t = String(text || '').trim();
  if (!t) return;
  const last = d.memory.at(-1);
  if (last && last.text === t) return;
  // a newer decision of the same topic replaces the older one (e.g. style switched twice)
  const topic = t.split('：')[0];
  if (kind === 'decision' && t.includes('：')) d.memory = d.memory.filter((m) => !(m.kind === 'decision' && m.text.split('：')[0] === topic));
  d.memory.push({ id: randomUUID().slice(0, 8), text: t.slice(0, 400), kind, source, at: iso() });
  if (d.memory.length > 200) d.memory = d.memory.slice(-200);
}
const memoryText = (d) => (d.memory || []).map((m) => `- ${m.kind === 'fact' ? '【成员要求】' : m.kind === 'rule' ? '【制片规则】' : ''}${m.text}`).join('\n');

// Production rules every drama carries from day one (editable, but never silently dropped).
export const AUDIO_RULE = '成片声音：视频只随片生成音效、对白和旁白，不带背景音乐、不带字幕；BGM 和字幕都在后期加';
export function migrate(d) {
  d.memory ||= [];
  if(!d.settings.scriptDefaultRevision){if(d.settings.skills.script==='fg-overseas-drama-script')d.settings.skills.script='short-drama-factory';d.settings.scriptDefaultRevision=1;}
  if(defaultModel('text')==='gpt-6.1-sol'&&(d.settings.textDefaultRevision||0)<2){d.settings.textModel='gpt-6.1-sol';d.settings.textDefaultRevision=2;}
  for(const a of d.assets?.items||[])a.id ||= randomUUID();
  if (!d.memory.some((m) => m.kind === 'rule' && m.ruleId === 'audio')) d.memory.unshift({ id: randomUUID().slice(0, 8), text: AUDIO_RULE, kind: 'rule', ruleId: 'audio', source: 'system', at: d.createdAt || iso() });
  const def = SK.defaults();
  for (const st of ['script', 'style', 'asset', 'render', 'segment', 'action']) if (!d.settings.skills[st] || !SK.validIn(st, d.settings.skills[st])) d.settings.skills[st] = def[st];
  d.settings.skills.boost = (d.settings.skills.boost || []).filter((id) => SK.validIn('boost', id));
  for (const e of d.episodes || []) {e.id ||= randomUUID();for (const sg of e.segments || []) {sg.id ||= randomUUID();if (!sg.refs) sg.refs = autoRefs(d, sg);}}
  return d;
}

// ---------- segment reference images ----------
// Which asset images a segment's video request uploads (and the prompt @-mentions): cast + scene + props by default,
// reviewed and edited by the member; capped by the video model's reference limit.
export function autoRefs(d, seg) {
  const byKey = Object.fromEntries((d.bible?.cast || []).map((c) => [c.key, c.code]));
  const codes = [...(seg.cast || []).map((k) => byKey[k]), seg.scene, ...(seg.props || [])].filter(Boolean);
  return [...new Set(codes)].filter((c) => d.assets.items.some((a) => a.code === c));
}
function refsOf(d, seg) {
  if(integrated&&(seg.refs||autoRefs(d,seg)).length>maxRefs(d.settings.videoModel))throw Error('参考素材超过当前模型上限，请人工核对，不会静默丢弃');
  return (seg.refs || autoRefs(d, seg)).filter((c) => d.assets.items.some((a) => a.code === c)).slice(0, Math.max(0, maxRefs(d.settings.videoModel)));
}
// Mock segments are authored against 15 s; stretch their beat and dialogue timings to the planned length.
function retime(full, sec) {
  const k = sec / full.seconds;
  const sc = (str) => String(str).replace(/\d+(?:\.\d+)?/g, (x) => String(Math.round(Number(x) * k)));
  return { ...full, seconds: sec, beats: full.beats.map((b) => ({ ...b, t: sc(b.t) })), dialogue: full.dialogue.map((x) => ({ ...x, at: sc(x.at) })) };
}

const started = (e) => Boolean(e.chosen || e.segments.length || e.done || Object.values(e.scripts).some(Boolean));
function planned(d) {
  return Math.max(Number(d.brief?.episodes) || 0, ...d.episodes.map((e) => e.n), 1);
}
function setPlanned(d, eps) {
  const sec = d.brief.episodeSeconds;
  d.brief.episodes = eps;
  d.episodes = d.episodes.filter((e) => e.n <= eps || started(e));
  const q = d.brief.questions?.find((x) => x.id === 'length');
  if (q) { const t = `${eps} 集 × ${sec} 秒`; if (!q.options.includes(t)) q.options.push(t); q.pick = q.options.indexOf(t); }
  remember(d, `体量：${eps} 集，每集约 ${sec} 秒`);
}
// Renumber episodes from `from` onward by `delta`, together with everything that points at an episode number.
function shiftEpisodes(d, from, delta) {
  for (const e of d.episodes) if (e.n >= from) e.n += delta;
  d.episodes.sort((a, b) => a.n - b.n);
  for (const a of d.assets.items) if (a.episode >= from) a.episode += delta;
  for (const m of d.memory || []) {
    if (m.kind !== 'decision') continue;
    m.text = m.text.replace(/第(\s*)(\d+)(\s*)集/g, (all, a, k, b) => (Number(k) >= from ? `第${a}${Number(k) + delta}${b}集` : all));
  }
}

export function ep(d, n, create = true) {
  n = Number(n);
  let e = d.episodes.find((x) => x.n === n);
  if (!e && create) {
    e = { id:randomUUID(), n, title: '', stage: 'script', scripts: { aistudio: '', sonnet: '', upload: '' }, uploadName: '', chosen: null, castCodes: [], newCodes: [], castConfirmed: false, outline: null, segments: [], actionCards: {}, jobs: [], done: false };
    d.episodes.push(e);
    d.episodes.sort((a, b) => a.n - b.n);
  }
  if(integrated&&e)context().episodeId=e.id;
  return e;
}

const styleOf = (d) => d.bible?.style || ST.styleFromPreset(ST.OVERSEAS[0]);
const asset = (d, code) => d.assets.items.find((a) => a.code === code);
const modelLabel = (id) => byId(id)?.label || id;

// ---------- simulated jobs ----------
export function refreshJobs(d) {
  if(integrated)return;
  const t = now();
  for (const e of d.episodes) {
    for (const j of e.jobs) {
      if (j.status === 'done') continue;
      if (t >= j.startAt + j.dur) {
        j.status = 'done';
        const seg = e.segments.find((s) => s.n === j.seg);
        if (seg) seg.takes = [...(seg.takes || []), { id: j.id, res: j.res, model: j.model, at: new Date(j.startAt + j.dur).toISOString(), simulated: true }];
      } else j.status = t >= j.startAt ? 'running' : 'queued';
    }
  }
  for (const a of d.assets.items) if (a.status === 'rendering' && a.readyAt && t >= a.readyAt && !a.realPending) a.status = 'ready';
}
export function progressOf(job) {
  if(integrated)return job.status==='done'?1:0;
  if (job.status === 'done') return 1;
  const t = now();
  return t < job.startAt ? 0 : Math.min(0.99, (t - job.startAt) / job.dur);
}

// ---------- live helpers ----------
const ctxJSON = (d) => JSON.stringify({ brief: d.brief, bible: d.bible && { ...d.bible, style: { title: styleOf(d).title, prompt: styleOf(d).prompt } }, settings: { ...d.settings, skills: undefined }, memory: (d.memory || []).map((m) => m.text) }, null, 1);

async function liveJSON(d, system, user, extra = {}) {
  const out = await chat({ model: d.settings.textModel, system: `${system}\n只输出 JSON，不要解释。`, messages: [{ role: 'user', content: user }], temperature: 0.6, ...extra });
  return parseJson(out);
}
function boostText(d) {
  return (d.settings.skills.boost || []).map((id) => SK.loadSkill('boost', id, 'boost')).filter(Boolean).join('\n\n');
}
async function fileDataUrl(url) {
  const name = basename(url);
  const buf = await readFile(join(FILES_DIR, name));
  const ext = name.split('.').pop().toLowerCase();
  const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }[ext] || 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function liveBrief(d, idea) {
  return liveJSON(d, '你是 FG 海外竖屏短剧立项编辑。把成员的一句话想法整理成立项卡。字段：premise(英文一句), premiseZh, genre, market, language, episodes(数字), episodeSeconds(数字), protagonist, questions(最多3个真正影响结构的问题，每个 {id,q,options:[3个],pick:0})。默认：北美、英文台词附中文、30 集、每集 90 秒。', `想法：${idea}`);
}
async function liveBible(d) {
  const ids = ST.OVERSEAS.map((s) => `${s.id}=${s.title}`).join('，');
  return liveJSON(d, `你是海外短剧剧集圣经编辑。字段：title, titleZh, logline, loglineZh, styleId（从 ${ids} 选一个）, faces, performance, rules(4 条), cast（4–6 个主要角色 {code:"@角色N", key, name, zh, age, look, role}；key 依次 A B D E F G H，跳过 C，C 留给摄影机）。演员面孔按目标市场。除英文片名 title、英文梗概 logline、角色原名 name 和代号 key 外，所有管理说明必须用中文：尤其 faces、performance、rules、age、look、role。中文说明不能改变原定族裔、市场或英文对白要求。`, ctxJSON(d));
}
async function liveScript(d, n) {
  const id = d.settings.skills.script;
  const contract = SK.loadSkill('script', 'fg-overseas-drama-script');
  const method = id !== 'fg-overseas-drama-script' ? `\n\n使用以下编剧技能。按目标市场、用户指定语言和时长改编；管理说明用中文，原定英文对白保留并附中文。先在内部补足情绪契约、主动目标、对手赌注、回合表和连续性台账，不把内部立项问卷输出给用户。已有剧本不擅自改写。\n${SK.loadSkill('script', id, 'episode')}` : '';
  const prev = ep(d, n - 1, false);
  const prevText = prev ? prev.scripts[prev.chosen] || '' : '';
  return chat({ model: d.settings.textModel, streamPresentation:'script',system: `你是海外竖屏短剧编剧，严格遵守剧本合同（第 1 节），只输出剧本正文。\n\n${contract}${method}`,
    messages: [{ role: 'user', content: `剧集圣经与立项：\n${ctxJSON(d)}\n\n${prevText ? `第${n - 1}集已采用剧本：\n${prevText}\n\n` : ''}请写第${n}集，约 ${d.settings.episodeSeconds} 秒。` }] });
}
function assetSystem(d) {
  const im = byId(d.settings.imageModel);
  return `你是短剧资产提示词师。按以下技能写中文出图提示词，目标生图模型：${im.label}（${im.summary}）。面孔按圣经与目标市场；角色一段到底、全身、浅灰棚拍背景；场景空镜无人；道具单品 45 度悬浮。\n\n${SK.loadSkill('asset', d.settings.skills.asset, 'compile')}\n\n${boostText(d)}\n\n全剧画风规范：\n${styleOf(d).prompt}\n\n每项 {code:"@角色N"|"@场景N"|"@道具N", kind:"character"|"scene"|"prop", name, zh, palette:[4个十六进制颜色], prompt}。`;
}
async function liveDramaAssets(d) {
  return liveJSON(d, `${assetSystem(d)}\n返回数组。`, `为全剧的主要角色（与圣经 cast 的 code 一致）和 2–3 个核心场景写资产提示词。\n\n${ctxJSON(d)}`);
}
async function liveEpisodeAssets(d, n) {
  const e = ep(d, n);
  const known = d.assets.items.map((a) => `${a.code} ${a.name}`).join('\n');
  return liveJSON(d, `${assetSystem(d)}\n返回对象 {used:[本集用到的已有资产 code], new:[新资产数组]}，不要重复已有资产；新资产编号接着已有编号往后排。`,
    `已有资产：\n${known}\n\n第${n}集剧本：\n${e.scripts[e.chosen]}`);
}
async function liveOutline(d, n) {
  const e = ep(d, n);
  const vm = byId(d.settings.videoModel);
  const { min, max } = segmentRange(vm.id);
  return liveJSON(d, `你是 FG 文戏导演。把剧本按"关系状态发生一次可见变化"切成视频段。每段时长按剧情灵活决定，范围 ${min}–${max} 秒（视频模型 ${vm.label}：${vm.summary}）：信息密集、对峙或台词多的段落给长一些，单个动作或反应镜头给短一些，不要所有段落一样长；英文台词每秒约 2.5 词，超出就在转折处拆段。返回数组 {n, seconds, title, event, ending, cast:[人物代号], scene:"@场景N", props:["@道具N"], opening:"开场"|"直接承接"|"转场缓冲", action:true/false}。上一段双人或多人收尾时，下一段优先转场缓冲。`,
    `圣经：\n${ctxJSON(d)}\n\n资产：\n${d.assets.items.map((a) => `${a.code} ${a.name}`).join('\n')}\n\n第${n}集剧本：\n${e.scripts[e.chosen]}`);
}
function parseLock(text) {
  const m = text.match(/〔衔接锁[\s\S]*$/);
  const block = m ? m[0] : '';
  const f = (k) => (block.match(new RegExp(`${k}：(.*)`)) || [])[1] || '';
  return { prompt: m ? text.slice(0, m.index).trim() : text.trim(), lock: { present: f('在场'), gaze: f('视线'), props: f('道具'), env: f('环境'), mood: f('情绪落点'), lastShot: f('末镜类型') } };
}
async function liveSegment(d, n, seg, note) {
  const e = ep(d, n);
  const fg = SK.loadSkill('segment', 'fg-drama-video-prompt');
  const chosen = d.settings.skills.segment;
  const method = chosen !== 'fg-drama-video-prompt' ? `\n\n参考以下导演技能的方法，但输出格式与衔接锁严格按上面的 FG 文戏导演：\n${SK.loadSkill('segment', chosen)}` : '';
  const action = seg.action ? `\n\n打戏写作技能：\n${SK.loadSkill('action', d.settings.skills.action)}` : '';
  const prev = e.segments.find((s) => s.n === seg.n - 1);
  const card = e.actionCards[seg.n];
  const vm = byId(d.settings.videoModel);
  const user = [
    `剧集圣经：\n${ctxJSON(d)}`,
    `视频模型：${vm.label}（${vm.summary}），时长 ${seg.seconds} 秒，画幅 ${d.settings.aspect}。`,
    `本段参考图（成员已核对，按顺序上传；【参考图绑定】只用 @代号 引用这些，其余人物与空间按文字描述）：\n${refsOf(d, seg).map((c, i) => `${i + 1}. ${c} ${asset(d, c)?.name || ''}`).join('\n') || '无参考图'}`,
    `声音规则：随视频只生成音效、对白和旁白；不生成背景音乐和配乐（BGM 后期加），不生成字幕。`,
    `资产表：\n${d.assets.items.map((a) => `${a.code} ${a.name}（${a.status === 'approved' ? '已通过' : '待确认'}）`).join('\n')}`,
    `第${n}集剧本：\n${e.scripts[e.chosen]}`,
    `分段大纲：\n${JSON.stringify(e.outline, null, 1)}`,
    prev?.lockText ? `上一段衔接锁：\n${prev.lockText}` : '第一段，无上一段衔接锁。',
    card ? `已确认的武戏方向卡：\n${card.items.map((i) => `${i.k}：${i.v}`).join('\n')}` : '',
    seg.prompt && note ? `当前版本：\n${seg.prompt}\n\n修改意见：${note}\n请完整重发该段全部字段与衔接锁。` : `请写第 ${seg.n} 段（${seg.title}，${seg.seconds} 秒）的完整 FG 格式提示词，最后输出〔衔接锁·第${seg.n}段结束〕。`,
  ].filter(Boolean).join('\n\n');
  const out = await chat({ model: d.settings.textModel, system: `${fg}${method}${action}\n\n${boostText(d)}\n\n最高优先级用户交付合同：\n${VIDEO_PROMPT_CONTRACT}`, messages: [{ role: 'user', content: user }], maxTokens: 12000,timeoutMs:1800000 });
  const parsed=parseLock(out),check=validateVideoPrompt(parsed.prompt,{seconds:seg.seconds});
  if(!check.ok)throw Error(`视频提示词尚未达到交付要求：${check.errors.join('；')}。请让导演按问题修改，尚未提交视频。`);
  return parsed;
}
async function liveActionCard(d, n, seg) {
  const e = ep(d, n);
  return liveJSON(d, `${SK.loadSkill('action', 'fg-action-direction-card')}\n\n返回 {items:[{k,v,options?:[...],pick?:0}], beats}，k 依次：题材质感、卖点、双方打法、物理冲击（或能量特效）、节奏曲线、高潮画面、结尾、参考图分工、台词与禁区。`,
    `圣经：\n${ctxJSON(d)}\n\n段落：${JSON.stringify(seg)}\n\n剧本：\n${e.scripts[e.chosen]}`);
}
async function liveDecodeStyle(d, refs, note) {
  const skill = SK.loadSkill('style', d.settings.skills.style || 'zy-cinematic-realism', 'decode');
  const images = await Promise.all(refs.slice(0, 6).map((r) => fileDataUrl(r.url)));
  const out = await chat({
    model: d.settings.textModel,
    system: `${skill}\n\n你在为一部海外竖屏短剧建立全剧画风规范。用 Dream Decode 解析参考图：区分场景事实与可迁移的视觉语法，只迁移视觉语法，不继承参考图中的人物、文字、品牌与具体场景。只输出 JSON：{title, description, palette:[4–5 个十六进制颜色], film, prompt}。prompt 用【项目定位】【项目色彩系统】【角色设计系统】【服饰与材质】【空间世界观】【影像与光线】【全局禁用】【使用边界】八段中文写成，演员面孔按目标市场（默认欧美）。`,
    messages: [{ role: 'user', content: [{ type: 'text', text: `立项：${JSON.stringify(d.brief)}\n成员补充：${note || '无'}` }, ...images.map((u) => ({ type: 'image_url', image_url: { url: u } }))] }],
    maxTokens: 4000,
  });
  const j = parseJson(out);
  return { source: 'upload', id: `upload-${Date.now()}`, title: j.title || '我的参考图画风', description: j.description || '', image: refs[0].url, palette: j.palette || [], film: j.film || '', prompt: j.prompt, references: refs, tags: ['上传参考', 'Dream Decode'] };
}

// ---------- asset helpers ----------
function newAsset(a, scope, episode) {
  return { ...a,id:randomUUID(), status: 'draft', versions: [], current: null, model: null, scope, episode: episode || null };
}
function nextCode(d, kind) {
  const prefix = { character: '@角色', scene: '@场景', prop: '@道具' }[kind] || '@角色';
  const next = 1 + Math.max(0, ...d.assets.items.filter((x) => x.code.startsWith(prefix)).map((x) => Number(x.code.slice(prefix.length)) || 0));
  return `${prefix}${next}`;
}
function renderAsset(d, a, model, skill) {
  if(integrated&&a.realPending)throw Error(`${a.code} 已有待确认或进行中的任务，请先处理原任务`);
  const m = model || a.model || d.settings.imageModel;
  const sk = skill || a.renderSkill || d.settings.skills.render || 'plain';
  const params = m === d.settings.imageModel ? d.settings.imageParams : defaultParams(m);
  const v = { id: randomUUID().slice(0, 8), model: m, skill: sk, params, at: iso(), simulated: !canReallyGenerate(m), url: null, prompt: null };
  a.versions.push(v);
  a.current = v.id;
  a.status = 'rendering';
  a.readyAt = now() + 1600 + Math.random() * 1400;
  if (!v.simulated) { a.realPending = true; (d._pending ||= []).push({ type: 'image', code: a.code, assetId:a.id, version: v.id, model: m, params, prompt: `${a.prompt}\n\n${styleOf(d).prompt}` }); }
  return v;
}

// Live: compile the asset prompt through the chosen render skill into a prompt native to the image model.
async function liveCompileImagePrompt(d, a, v) {
  if (!v.skill || v.skill === 'plain') { v.prompt = a.prompt; return; }
  const m = byId(v.model);
  const sys = `${SK.loadSkill('render', v.skill, 'compile', v.model)}\n\n你在为海外短剧资产出图。保持资产身份、服装、道具与空间事实不变，只按技能提升画面语言，并编译成 ${m.label} 的原生提示词。只输出最终提示词正文。\n\n全剧画风规范：\n${styleOf(d).prompt}\n\n本剧记忆：\n${memoryText(d) || '无'}`;
  v.prompt = (await chat({ model: d.settings.textModel, system: sys, messages: [{ role: 'user', content: `${a.code} ${a.name}\n${a.prompt}` }], maxTokens: 2500, temperature: 0.5 })).trim();
}

// ---------- actions ----------
// ---------- thought trace, focus and next steps ----------
// Every action leaves an honest trace of what the agent actually used (memory, skills, models, rules),
// and the codes of the things it touched, so the interface can show the work happening.
const T = (k, t) => ({ k, t });
function snapshot(d) {
  const a = new Map(d.assets.items.map((x) => [x.code, `${x.status}|${x.versions.length}|${x.current}|${x.name}`]));
  const sg = new Map();
  for (const e of d.episodes) for (const x of e.segments) sg.set(`${e.n}:${x.n}`, `${x.status}|${(x.prompt || '').length}|${(x.refs || []).join(',')}|${x.seconds}`);
  return { a, sg };
}
function diffFocus(d, before) {
  const out = [];
  for (const x of d.assets.items) if (before.a.get(x.code) !== `${x.status}|${x.versions.length}|${x.current}|${x.name}`) out.push(x.code);
  for (const e of d.episodes) for (const x of e.segments) if (before.sg.get(`${e.n}:${x.n}`) !== `${x.status}|${(x.prompt || '').length}|${(x.refs || []).join(',')}|${x.seconds}`) out.push(`seg-${x.n}`);
  return out;
}
function traceFor(d, type, payload, ctx, focus) {
  const live = d.mode === 'live';
  const via = live ? modelLabel(d.settings.textModel) : '模拟模式 · 示例内容';
  const mem = (d.memory || []).length;
  const sk = d.settings.skills;
  const n = Number(payload.episode || ctx.episode || 1);
  const e = ep(d, n, false);
  const assetsN = focus.filter((x) => x.startsWith('@')).length;
  const segsN = focus.filter((x) => x.startsWith('seg-')).length;
  const vm = byId(d.settings.videoModel);
  const range = segmentRange(vm.id);
  switch (type) {
    case 'script.start': return [T('memory','已保存用户原稿，未调用模型')];
    case 'brief.submit': return [T('skill', '立项编辑'), T('model', via)];
    case 'brief.confirm': return [T('memory', '写入立项决定'), T('skill', '剧集圣经编辑'), T('model', via)];
    case 'style.decode': return [T('skill', SK.labelOf('style', sk.style)), T('model', via)];
    case 'style.preset': case 'style.inspiration': case 'style.note': return [T('memory', '画风写入记忆')];
    case 'bible.confirm': return [T('memory', '圣经锁定，全剧共享')];
    case 'script.sonnet': return [T('memory', `读取记忆 ${mem} 条`), T('skill', SK.labelOf('script', sk.script)), T('model', via)];
    case 'script.choose': return e ? [T('skill', SK.labelOf('asset', sk.asset)), T('library', `资产库比对：复用 ${e.castCodes.length - e.newCodes.length} 个，新增 ${e.newCodes.length} 个`), T('memory', '剧本决定写入记忆')] : [];
    case 'assets.render': {
      if (!assetsN) return [];
      const a = d.assets.items.find((x) => x.code === focus.find((f) => f.startsWith('@')));
      const v = a?.versions.at(-1);
      return [T('skill', `${SK.labelOf('asset', sk.asset)} → ${SK.labelOf('render', v?.skill || sk.render)}`), T('model', `${modelLabel(v?.model || d.settings.imageModel)}${v?.simulated ? ' · 模拟出图' : ''}`), T('act', `出图 ${assetsN} 张，16:9`)];
    }
    case 'assets.remove': return [T('library', '从全剧资产库移除，并从各集与分段参考里摘掉')];
    case 'segments.plan': return [T('skill', SK.labelOf('segment', sk.segment)), T('rule', `按剧情切段 ${range.min}–${range.max} 秒 · ${vm.label}`), T('ref', '按出场人物、场景、道具自动挂参考图')];
    case 'segments.write': case 'action.confirm': case 'segments.revise': case 'segments.refs':
      return [T('memory', `读取记忆 ${mem} 条`), T('skill', `${SK.labelOf('segment', sk.segment)} → FG 视频提示词格式`), T('ref', `参考图上限 ${maxRefs(vm.id)} 张 · @代号引用`), T('rule', '声音只含音效、对白、旁白；无 BGM、无字幕'), ...(segsN ? [T('act', `写好 ${segsN} 段`)] : [])];
    case 'shoot.submit': return [T('model', `${vm.label} · 模拟任务`), T('rule', '随片音频：音效、对白、旁白；BGM 与字幕后期加')];
    case 'memory.add': case 'memory.update': case 'memory.remove': return [T('memory', `记忆共 ${mem} 条`)];
    case 'settings.model': return byId(payload.model)?.capability === 'video' ? [T('memory', '设定写入记忆'), T('rule', `分段重新适配 ${range.min}–${range.max} 秒`), T('ref', `参考图上限 ${maxRefs(vm.id)} 张`)] : [T('memory', '设定写入记忆')];
    case 'settings.skill': case 'settings.params': case 'brief.spec': case 'episodes.add': case 'episodes.remove': return [T('memory', '设定写入记忆')];
    default: return [];
  }
}
export function nextSteps(d, ctx = {}) {
  const S2 = (label, say = label) => ({ label, say });
  if (!d.brief) return [S2('给我几个灵感'), S2('被抛弃的新娘反手收购了前夫的公司')];
  if (!d.brief.confirmed) return [S2('确认立项', '确认'), S2('改成 60 集，每集 90 秒')];
  if (!d.bible?.confirmed) return [S2('确认圣经', '确认'), S2('用我上传的图做画风')];
  const n = ctx.episode;
  if (!n) { const e = d.episodes.find((x) => !x.done); return [S2(`打开第 ${e?.n || 1} 集`)]; }
  const e = ep(d, n, false);
  if (!e) return [S2(`打开第 ${n} 集`)];
  switch (e.stage) {
    case 'script': return e.scripts.sonnet ? [S2('采用美林版', '确认'), S2('剧本用爆款短剧工厂重写', '剧本用爆款短剧工厂')] : [S2('你来写')];
    case 'cast': {
      const list = e.castCodes.map((c) => asset(d, c)).filter(Boolean);
      const drafts = list.filter((a) => a.status === 'draft').length;
      if (drafts) return [S2(`给 ${drafts} 个新资产出图`, '出图'), S2('出图用 ZY 电影感', '出图用 zy 电影感')];
      if (list.some((a) => a.status === 'rendering')) return [];
      return [S2('全部通过，开始分段', '确认')];
    }
    case 'segments':
      if (!e.outline) return [S2('按剧情切分段', '开始分段')];
      if (e.segments.some((x) => !x.prompt)) return [S2('写全部提示词', '写提示词')];
      return [S2('锁定提示词', '确认'), S2('改第 3 段，台词再狠一点')];
    case 'shoot': return [S2('全部出预览'), S2('进入后期', '确认')];
    default: return [S2('下一集')];
  }
}

export async function act(d, type, payload = {}, ctx = {}) {
  const before = snapshot(d);
  const res = await actCore(d, type, payload, ctx);
  const focus = diffFocus(d, before);
  (d._focus ||= []).push(...focus);
  (d._trace ||= []).push(...traceFor(d, type, payload, ctx, focus));
  return res;
}

async function actCore(d, type, payload = {}, ctx = {}) {
  const live = d.mode === 'live';
  const n = Number(payload.episode || ctx.episode || d.episodes.at(-1)?.n || 1);
  const r = (reply, nav) => ({ reply: say(d, reply), nav });
  switch (type) {
    case 'script.start': {
      const text=String(payload.text||'').trim();if(!text)throw Error('请粘贴或上传有正文的剧本');
      if(text.length>200000)throw Error('单次剧本最多20万字，请按集导入');
      if(d.episodes.some(started))throw Error('此剧已开始制作，请在对应剧集内导入，避免覆盖');
      const title=String(payload.title||payload.name||'导入剧本').trim().slice(0,120)||'导入剧本';
      const seconds=Number(payload.episodeSeconds||90);if(!Number.isFinite(seconds)||seconds<15||seconds>600)throw Error('单集时长须为15–600秒');
      const language=String(payload.language||'英文台词，中文制作说明');
      d.titleZh=title;d.title='';d.settings.episodeSeconds=seconds;d.settings.language=language;
      d.brief={idea:'使用用户原稿',premise:'',premiseZh:title,genre:'按原稿',market:'按原稿',language,episodes:1,episodeSeconds:seconds,protagonist:'按原稿',questions:[],confirmed:true,sample:false};
      d.bible={title:'',titleZh:title,logline:'',loglineZh:'按导入剧本制作，不擅自改变情节。',faces:'按原稿及用户参考图，不根据画风推断族裔。',performance:'按原稿人物与场景。',rules:['保留原稿情节、角色与对白语言。'],cast:[],style:ST.styleFromPreset(ST.OVERSEAS[0]),confirmed:true};
      const e=ep(d,1);e.scripts.upload=text;e.uploadName=payload.name||'粘贴剧本';d.stage='ready';
      remember(d,'剧本来源：用户原稿，已跳过 AI 立项；圣经与画风可随时编辑，尚未调用模型。');
      return r('原稿已保存，无需重新立项。请核对剧本，再选择“采用这一版”提取资产；提取时会调用文本模型。',{episode:1,stage:'script'});
    }
    // ----- settings -----
    case 'settings.model': {
      const m = byId(payload.model);
      if (!m) return r('没有这个模型。');
      remember(d, `${{ text: '主脑', image: '出图模型', video: '出片模型' }[m.capability]}：${m.label}`);
      if (m.capability === 'text') d.settings.textModel = m.id;
      if (m.capability === 'image') { d.settings.imageModel = m.id; d.settings.imageParams = defaultParams(m.id); }
      if (m.capability === 'video') {
        d.settings.videoModel = m.id;
        d.settings.videoParams = defaultParams(m.id, { aspect: d.settings.aspect });
        d.settings.segmentSeconds = planSeconds(m.id, d.settings.segmentSeconds);
        // re-fit every unshot segment to what the new model can generate, keeping the plot-driven length where possible
        const changed = [];
        for (const e of d.episodes.filter((x) => !x.done)) {
          for (const sg of e.segments) {
            if (sg.takes?.length) continue;
            const sec = planSeconds(m.id, sg.plotSeconds || sg.seconds);
            if (sec === sg.seconds) continue;
            sg.seconds = sec;
            changed.push(`第${e.n}集第${sg.n}段→${sec}秒`);
            if (sg.prompt) { if (live) sg.stale = true; else { const st = sg.status; await writeOne(d, e.n, sg); sg.status = st; } }
          }
        }
        const { min, max } = segmentRange(m.id);
        return r(`出片模型换成 ${m.label}：${m.summary}。分段按剧情在 ${min}–${max} 秒之间${changed.length ? `，已重新适配 ${changed.length} 段（${changed.slice(0, 4).join('、')}${changed.length > 4 ? '…' : ''}）${live ? '，提示词需要重写' : ''}` : ''}。参考图上限 ${maxRefs(m.id)} 张。`);
      }
      return r(`${{ text: '主脑', image: '出图模型' }[m.capability]}换成 ${m.label}${m.capability === 'image' ? `：${m.summary}` : ''}。`);
    }
    case 'settings.params': {
      if (payload.imageParams) Object.assign(d.settings.imageParams, payload.imageParams);
      if (payload.videoParams) Object.assign(d.settings.videoParams, payload.videoParams);
      if (payload.segmentSeconds) d.settings.segmentSeconds = fitDuration(d.settings.videoModel, Number(payload.segmentSeconds));
      return { reply: '' };
    }
    case 'settings.skill': {
      const { stage, id, on } = payload;
      if (stage === 'boost') {
        const set = new Set(d.settings.skills.boost || []);
        if (on === false) set.delete(id); else if (on === true) set.add(id); else if (set.has(id)) set.delete(id); else set.add(id);
        d.settings.skills.boost = [...set];
        const enabled = set.has(id);
        remember(d, `增强技能：${[...set].map((x) => SK.labelOf('boost', x)).join('、') || '无'}`);
        return r(`${enabled ? '已开启' : '已关闭'}「${SK.labelOf('boost', id)}」${enabled && !live ? '。模拟模式只记录选择，接入主模型后会装进资产与分段提示词的写作里' : ''}。`);
      }
      d.settings.skills[stage] = id;
      const stageName = { script: '剧本', style: '画风解析', asset: '资产提示词', render: '生图风格', segment: '分段导演', action: '打戏' }[stage];
      remember(d, `${stageName}技能：${SK.labelOf(stage, id)}`);
      return r(`${stageName}改用「${SK.labelOf(stage, id)}」。${stage === 'render' && !live && id !== 'plain' ? '模拟模式只记录选择；接入主模型后，出图前会按这个技能重写成所选模型的原生提示词。' : ''}`);
    }

    // ----- drama: brief -----
    case 'brief.update': case 'brief.import': {
      const next=editBrief(d,planningInput(payload));d.brief=next;d.settings.episodeSeconds=next.episodeSeconds;d.stage='brief';
      remember(d,`立项：${next.premiseZh}（${next.episodes}集×${next.episodeSeconds}秒，待重新确认）`);
      return r('立项草稿已保存。请核对后重新确认；已有剧本和资产保留，不自动重生成。',{stage:'brief'});
    }
    case 'bible.update': case 'bible.import': {
      if(!d.brief)throw Error('请先填写立项');
      d.bible=editBible(d,planningInput(payload));d.bible.style ||= ST.styleFromPreset(ST.OVERSEAS[0]);d.title=d.bible.title;d.titleZh=d.bible.titleZh;d.stage='bible';
      for(const e of d.episodes)for(const s of e.segments||[])s.stale=true;
      remember(d,`圣经：${d.titleZh}，已修改，待重新确认。已有产物保留。`);
      return r('圣经与画风草稿已保存，请重新确认。已有图片和视频保留，后续生成使用新设定。',{stage:'bible'});
    }
    case 'bible.translate': {
      if(!d.bible)throw Error('请先创建圣经');
      const translated=await liveJSON(d,'你是影视制片翻译。把 faces、performance、rules 和 cast 中的 age、look、role 翻译成准确中文。保留所有事实、族裔、年龄、姓名、片名、code、key和style，不增删人物。只返回输入对象的中文说明版 JSON。',JSON.stringify(d.bible));
      const original=d.bible,confirmed=original.confirmed;
      const translatedCast=original.cast.map(c=>{const v=translated.cast?.find(x=>x.code===c.code)||{};return {...c,look:v.look||c.look,role:v.role||c.role,age:typeof c.age==='number'?c.age:v.age||c.age};});
      d.bible={...editBible(d,{faces:translated.faces||original.faces,performance:translated.performance||original.performance,rules:translated.rules||original.rules,cast:translatedCast}),style:original.style,confirmed};
      return r('演员、表演与红线说明已翻译为中文；人物身份及成片语言未改变。',{stage:'bible'});
    }
    case 'brief.submit': {
      const idea = String(payload.idea || '').trim();
      d.brief = live ? { ...(await liveBrief(d, idea)), idea } : { ...structuredClone(S.SAMPLE_BRIEF), idea: idea || S.SAMPLE_BRIEF.premiseZh, sample: true };
      d.stage = 'brief';
      return r(live ? `立项卡好了。我只问 ${d.brief.questions?.length || 0} 个会改变结构的问题。` : '立项卡好了。模拟模式用示例剧《新娘买下了他》演示整条航线；三个问题选好就能锁定立项。', { stage: 'brief' });
    }
    case 'brief.answer': {
      const q = d.brief?.questions?.find((x) => x.id === payload.id);
      if (q && payload.text) {
        const t = String(payload.text).trim().slice(0, 120);
        if (t && !q.options.includes(t)) q.options.push(t);
        q.pick = q.options.indexOf(t);
        q.custom = true;
      } else if (q) q.pick = Number(payload.pick);
      const m = q?.options[q.pick]?.match(/(\d+)\s*集\s*×\s*(\d+)/);
      if (m) { d.brief.episodes = Number(m[1]); d.brief.episodeSeconds = Number(m[2]); d.settings.episodeSeconds = Number(m[2]); }
      return { reply: '' };
    }
    case 'brief.spec': {
      if (!d.brief) return r('先告诉我你想拍什么故事。');
      const eps = Math.round(Number(payload.episodes || d.brief.episodes));
      const sec = Math.round(Number(payload.episodeSeconds || d.brief.episodeSeconds));
      if (!(eps >= 1 && eps <= 300) || !(sec >= 15 && sec <= 600)) return r('集数填 1–300，单集时长填 15–600 秒。');
      const last = Math.max(0, ...d.episodes.filter(started).map((e) => e.n));
      if (eps < last) return r(`第 ${last} 集已经开始做了，全剧不能少于 ${last} 集。要减集，先在剧集页把不要的那几集删掉。`);
      const oldSec = d.brief.episodeSeconds, oldEps = planned(d);
      d.brief.episodeSeconds = sec; d.settings.episodeSeconds = sec;
      setPlanned(d, eps);
      if (payload.quiet) return { reply: '' };
      const parts = [eps !== oldEps ? `全剧改为 ${eps} 集` : '', sec !== oldSec ? `每集约 ${sec} 秒（之后写的剧本按这个时长，已写好的不动）` : ''].filter(Boolean);
      return r(parts.length ? `${parts.join('，')}。` : `还是 ${eps} 集，每集约 ${sec} 秒。`, d.brief.confirmed ? { view: 'episodes' } : {});
    }
    case 'brief.confirm': {
      if (!d.brief) return r('先告诉我你想拍什么故事。');
      d.brief.confirmed = true;
      remember(d, `立项：${d.brief.premiseZh}（${d.brief.genre}，${d.brief.market}，${d.brief.episodes} 集 × ${d.brief.episodeSeconds} 秒）`);
      for (const q of (d.brief.questions || []).filter((x) => x.id !== 'length')) remember(d, `${q.q.replace(/[？?]$/, '')}：${q.options[q.pick]}`);
      if(d.bible){d.bible.confirmed=false;d.stage='bible';return r('立项修改已确认，原圣经、画风及产物保留。请核对圣经后重新确认。',{stage:'bible'});}
      const b = payload.manual ? {title:d.title||'',titleZh:d.titleZh||'未命名剧集',loglineZh:d.brief.premiseZh,faces:'',performance:'',rules:[],cast:[]} : live ? await liveBible(d) : structuredClone(S.SAMPLE_BIBLE);
      const preset = ST.findPreset(b.styleId) || ST.OVERSEAS[0];
      d.bible = { ...b, style: ST.styleFromPreset(preset), confirmed: false };
      d.title = d.bible.title; d.titleZh = d.bible.titleZh;
      d.stage = 'bible';
      return r(`立项锁定。剧集圣经起草好了：《${d.bible.titleZh}》。我推荐「${preset.title}」画风；也可以从 FG 风格库、灵感库里挑，或者上传几张参考图让我解析。`, { stage: 'bible' });
    }

    // ----- drama: bible & style -----
    case 'style.preset': {
      const p = ST.findPreset(payload.id);
      if (!p || !d.bible) return r('没找到这个画风。');
      d.bible.style = ST.styleFromPreset(p);
      remember(d, `画风：${p.title}`);
      return r(`画风换成「${p.title}」。${p.source === 'fg-library' ? '这是 FG 画布风格库的国内向预设，面孔规则会按本剧方向覆盖。' : p.description}`);
    }
    case 'style.inspiration': {
      if (!d.bible) return r('还没有剧集圣经。');
      const it = payload.item;
      if (!it) return r('没找到这条灵感。');
      const refs = [{ url: it.image, name: it.title, inspiration: it.id }];
      d.bible.style = { ...ST.styleFromPaletteMock(refs, payload.palette || [], (it.prompt || '').slice(0, 300)), title: `灵感 · ${it.title}`, description: `来自 FG 灵感库（${it.source}）`, source: 'inspiration' };
      remember(d, `画风：灵感库「${it.title}」`);
      return r(`用灵感库「${it.title}」做画风参考。${live ? '' : '模拟模式只取色板和原提示词，接入主模型后会完整解析。'}`);
    }
    case 'style.decode': {
      if (!d.bible) return r('还没有剧集圣经。');
      if(!Array.isArray(payload.refs)||payload.refs.length>6)throw Error('画风参考图最多 6 张，请核对后重新提交');
      if(payload.refs.some(id=>!d.uploads.some(u=>u.id===id&&u.mime?.startsWith('image/'))))throw Error('请选择本剧已上传的画风参考图片');
      const refs = (payload.refs || []).map((id) => d.uploads.find((u) => u.id === id)).filter(Boolean).map((u) => ({ url: u.url, name: u.name, id: u.id }));
      if (!refs.length) return r('先上传一到六张参考图。');
      d.bible.style = live ? await liveDecodeStyle(d, refs, payload.note) : ST.styleFromPaletteMock(refs, payload.palette || [], payload.note);
      remember(d, `画风：${d.bible.style.title}（来自 ${refs.length} 张上传参考图${payload.note ? `；${payload.note}` : ''}）`);
      return r(live ? `解析完成：「${d.bible.style.title}」。参考图只提供画风，不继承里面的人物和场景。` : `已用 ${refs.length} 张参考图建立画风。模拟模式只提取了色板；接入主模型后由 ZY Dream Decode 解析光线、镜头和质感。`);
    }
    case 'style.note': {
      if (!d.bible?.style) return r('还没有画风。');
      d.bible.style.prompt += `\n【成员补充】${payload.note}`;
      remember(d, `画风补充：${payload.note}`, 'fact', 'user');
      return r(`已把“${payload.note}”写进画风规范。`);
    }
    case 'bible.confirm': {
      if (!d.bible) return r('还没有剧集圣经。');
      d.bible.confirmed = true;
      d.stage = 'ready';
      ep(d, 1);
      remember(d, `圣经锁定：《${d.bible.titleZh}》，画风「${styleOf(d).title}」`);
      return r('圣经锁定。先写第 1 集剧本；剧本定了，我再按剧本抽出这一集要用的角色、场景和道具去出图。出过的资产会进入全剧资产库，后面每一集直接复用。', { view: 'episodes' });
    }

    // ----- assets (drama + episode) -----
    case 'assets.render': {
      const targets = d.assets.items.filter((a) => (payload.code ? a.code === payload.code : payload.codes ? payload.codes.includes(a.code) : a.status === 'draft' && (!payload.scope || a.scope === payload.scope)));
      if (!targets.length) return r('没有需要出图的资产。');
      for (const a of targets) {
        if (payload.model) a.model = payload.model;
        if (payload.skill) a.renderSkill = payload.skill;
        const v = renderAsset(d, a, payload.model, payload.skill);
        if (live) await liveCompileImagePrompt(d, a, v);
        if(integrated){const pending=d._pending.find(x=>x.version===v.id);pending.prompt=`${v.prompt||a.prompt}\n\n全剧画风：${styleOf(d).prompt}\n\n目标市场与身份：${JSON.stringify(d.brief)}\n\n本剧记忆：${memoryText(d)}`;v.prompt=pending.prompt;pending.references=styleOf(d).references||[];}
      }
      const m = modelLabel(payload.model || targets[0].model || d.settings.imageModel);
      const sk = targets[0].versions.at(-1).skill;
      const sim = targets.some((a) => a.versions.at(-1).simulated);
      return r(`${targets.length === 1 ? targets[0].code : `${targets.length} 个资产`}用 ${m}${sk && sk !== 'plain' ? ` + ${SK.labelOf('render', sk)}` : ''}${integrated?' 已准备，请核对报价并确认提交':` 出图中${sim?'（模拟任务，不扣费）':''}`}。`);
    }
    case 'assets.model': {
      const a = asset(d, payload.code);
      if (a) a.model = payload.model || null;
      if (a && payload.skill !== undefined) a.renderSkill = payload.skill || null;
      return { reply: '' };
    }
    case 'assets.note': {
      const a = asset(d, payload.code);
      if (!a || !payload.note) return r('没找到这个资产。');
      a.prompt += `，${payload.note}`;
      a.status = 'draft';
      remember(d, `${a.code} ${a.name}：${payload.note}`, 'fact', 'user');
      return r(`已把“${payload.note}”写进 ${a.code} 的提示词，重新出图即可。`);
    }
    case 'assets.upload': {
      const u = d.uploads.find((x) => x.id === payload.upload);
      if (!u) return r('上传的文件找不到了。');
      let a = payload.code ? asset(d, payload.code) : null;
      if (!a) {
        const kind = payload.kind || 'character';
        const code = nextCode(d, kind);
        const raw = String(payload.name || u.name.replace(/\.[^.]+$/, '')).trim();
        // camera / chat exports come with hash-like names; give them a readable one the member can rename
        const hashy = !raw || /^\d{5,}/.test(raw) || /^[0-9a-f_-]{10,}$/i.test(raw) || (!/[\u4e00-\u9fff\s]/.test(raw) && raw.length >= 16 && /\d{4,}/.test(raw)) || /^(img|image|dsc|pxl|wechat|mmexport|screenshot)[\w-]*$/i.test(raw);
        const name = hashy ? `新${{ character: '角色', scene: '场景', prop: '道具' }[kind]} ${code.replace(/\D/g, '')}` : raw;
        a = newAsset({ code, kind, name, zh: '', palette: u.palette || [], prompt: '成员上传的定妆参考，直接作为参考图使用。' }, 'drama', payload.episode);
        d.assets.items.push(a);
        if (payload.episode) { const e = ep(d, payload.episode); e.newCodes.push(a.code); e.castCodes.push(a.code); }
      }
      const v = { id: randomUUID().slice(0, 8), model: 'upload', at: iso(), url: u.url, uploaded: true };
      a.versions.push(v);
      a.current = v.id;
      a.status = 'ready';
      return r(`${a.code}「${a.name}」用你上传的图，通过后即可在分段里引用。`);
    }
    case 'assets.remove': {
      const a = asset(d, payload.code);
      if (!a) return r('没找到这个资产。');
      d.assets.items = d.assets.items.filter((x) => x !== a);
      for (const e of d.episodes) {
        e.castCodes = e.castCodes.filter((c) => c !== a.code);
        e.newCodes = e.newCodes.filter((c) => c !== a.code);
        for (const sg of e.segments) if (sg.refs) sg.refs = sg.refs.filter((c) => c !== a.code);
      }
      return r(`已删除 ${a.code}「${a.name}」，各集资产和分段参考图里也一起摘掉了。`);
    }
    case 'assets.rename': {
      const a = asset(d, payload.code);
      const name = String(payload.name || '').trim().slice(0, 60);
      if (!a || !name) return r('名字不能为空。');
      a.name = name;
      if (payload.zh != null) a.zh = String(payload.zh).trim().slice(0, 30);
      return { reply: '' };
    }
    case 'assets.pick': {
      const a = asset(d, payload.code);
      if (a && a.versions.some((v) => v.id === payload.version)) { a.current = payload.version; if (a.status === 'approved') a.status = 'ready'; }
      return { reply: '' };
    }
    case 'assets.approve': {
      for (const a of d.assets.items) {
        if (payload.code ? a.code === payload.code : payload.codes ? payload.codes.includes(a.code) && a.status === 'ready' : a.status === 'ready' && (!payload.scope || a.scope === payload.scope)) a.status = 'approved';
      }
      return { reply: '' };
    }
    case 'assets.add': {
      const kind = payload.kind || 'character';
      const code = nextCode(d, kind);
      d.assets.items.push(newAsset({ code, kind, name: payload.name || '新资产', zh: '', palette: [], prompt: payload.prompt || '' }, payload.episode ? 'episode' : 'drama', payload.episode));
      if (payload.episode) { const e = ep(d, payload.episode); e.newCodes.push(code); e.castCodes.push(code); }
      return r(`加了 ${code}。写一句描述或上传图就能出图。`);
    }
    case 'assets.confirm': {
      const pending = d.assets.items.filter((a) => a.scope === 'drama' && a.status !== 'approved');
      if (pending.length) return r(`还有 ${pending.length} 个主资产没通过。全部通过后，每一集都能直接引用它们。`);
      d.assets.confirmed = true;
      d.stage = 'ready';
      ep(d, 1);
      return r('主资产锁定。剧集页就绪，点第 1 集开始写剧本；之后每一集都自动复用这些角色和场景。', { view: 'episodes' });
    }

    // ----- episodes -----
    case 'episode.open': {
      if (!d.bible?.confirmed) return r('先锁定剧集圣经，再开始写分集。');
      const e = ep(d, n);
      return r(`打开第 ${n} 集。${e.chosen ? '' : 'AI Studio 在同一个对话里发 Prompt ③ 就能续写；也可以让我直接写，或上传你们的剧本。'}`, { episode: n, stage: e.stage });
    }
    case 'script.sonnet': {
      const e = ep(d, n);
      e.scripts.sonnet = live ? await liveScript(d, n) : (n === 1 ? S.SCRIPT_SONNET_EP1 : n === 2 ? S.SCRIPT_SONNET_EP2 : '');
      if (!e.scripts.sonnet) return r('模拟模式只预置了前两集剧本；配置 WeToken 后每一集都会实时生成。', { episode: n, stage: 'script' });
      return r(`第 ${n} 集 ${modelLabel(d.settings.textModel)} 版写好了${d.settings.skills.script !== 'fg-overseas-drama-script' ? `（技能：${SK.labelOf('script', d.settings.skills.script)}）` : ''}。`, { episode: n, stage: 'script' });
    }
    case 'script.paste': {
      const e = ep(d, n);
      e.scripts.aistudio = String(payload.text || '').trim();
      return r(e.scripts.aistudio ? `收到 AI Studio 版第 ${n} 集，已放进对照。` : '');
    }
    case 'script.samplePaste': {
      ep(d, n).scripts.aistudio = n === 1 ? S.SCRIPT_AISTUDIO_EP1 : '';
      return r(n === 1 ? '已填入一段示例 AI Studio 输出。' : '示例只有第 1 集。');
    }
    case 'script.upload': {
      const e = ep(d, n);
      e.scripts.upload = String(payload.text || '').trim();
      e.uploadName = payload.text ? payload.name || '' : '';
      if (!payload.name) return { reply: '' };
      return r(e.scripts.upload ? `收到你上传的剧本「${e.uploadName}」，放进对照。` : '文件里没有读到文字。');
    }
    case 'script.choose': {
      const e = ep(d, n);
      if (!e.scripts[payload.channel]) return r('这一版还没有内容。');
      e.chosen = payload.channel;
      e.title = (e.scripts[payload.channel].match(/##\s*(?:第\s*\d+\s*集|Episode\s*\d+)\s*[《"“]([^》"”]+)[》"”]/) || [])[1] || e.title;
      let used = [], fresh = [];
      if (live) {
        const res = await liveEpisodeAssets(d, n);
        used = res.used || []; fresh = res.new || [];
      } else if (n === 1) {
        const all = structuredClone(S.SAMPLE_ASSETS);
        used = all.filter((a) => asset(d, a.code)).map((a) => a.code);
        fresh = all.filter((a) => !asset(d, a.code));
      } else if (n === 2) {
        used = ['@角色1', '@角色2', '@角色4', '@角色6'].filter((c) => asset(d, c));
        fresh = structuredClone(S.EP2_NEW_ASSETS).filter((a) => !asset(d, a.code));
      } else used = d.assets.items.filter((a) => a.kind === 'character').map((a) => a.code);
      // every asset lives in the drama library; `episode` records where it first appeared
      for (const a of fresh) if (!asset(d, a.code)) d.assets.items.push(newAsset(a, 'drama', n));
      remember(d, `第 ${n} 集剧本：采用${{ sonnet: '美林直写', aistudio: ' AI Studio ', upload: '上传' }[payload.channel]}版${e.title ? `《${e.title}》` : ''}`);
      e.castCodes = [...new Set([...used, ...fresh.map((a) => a.code)])];
      e.newCodes = fresh.map((a) => a.code);
      e.stage = 'cast';
      return r(`第 ${n} 集采用${{ sonnet: '美林直写', aistudio: ' AI Studio ', upload: '上传' }[payload.channel]}版。按剧本抽出 ${e.castCodes.length} 个资产：${e.castCodes.length - e.newCodes.length} 个从全剧资产库直接复用，${e.newCodes.length} 个是新的，需要出图确认。`, { episode: n, stage: 'cast' });
    }
    case 'cast.confirm': {
      const e = ep(d, n);
      const pending = e.castCodes.map((c) => asset(d, c)).filter((a) => a && a.status !== 'approved');
      if (pending.length) return r(`本集还有 ${pending.length} 个资产没通过：${pending.map((a) => a.code).join('、')}。`);
      e.castConfirmed = true;
      if (e.newCodes.length) remember(d, `第 ${n} 集新增资产已入库：${e.newCodes.join('、')}`);
      e.stage = 'segments';
      return r('本集资产就绪。接下来按剧情转折切成视频段，先给你看分段大纲。', { episode: n, stage: 'segments' });
    }
    case 'segments.plan': {
      const e = ep(d, n);
      const vm = d.settings.videoModel;
      if (live) e.outline = (await liveOutline(d, n)).map((o) => ({ ...o, plotSeconds: o.seconds, seconds: planSeconds(vm, o.seconds) }));
      else if (n === 1) e.outline = S.SEGMENTS_EP1.map(({ beats, perf, dialogue, lock, narrative, edit, ...o }) => ({ ...o, seconds: planSeconds(vm, o.plotSeconds || o.seconds) }));
      else return r('模拟模式只预置了第 1 集的分段；配置 WeToken 后每集都会实时切分。');
      e.segments = e.outline.map((o) => ({ ...o, refs: autoRefs(d, o), status: 'outline' }));
      const fights = e.outline.filter((o) => o.action).map((o) => o.n);
      const { min, max } = segmentRange(vm);
      const total = e.segments.reduce((t, x) => t + x.seconds, 0);
      return r(`第 ${n} 集按剧情切成 ${e.segments.length} 段，共 ${total} 秒：${e.segments.map((x) => `${x.seconds}`).join(' / ')} 秒（${modelLabel(vm)} 每段 ${min}–${max} 秒）。每段要挂的参考图我已按出场人物、场景、道具配好，写之前你可以先过一遍。${fights.length ? `第 ${fights.join('、')} 段有肢体冲突，写之前先给你一张武戏方向卡。` : ''}`, { episode: n, stage: 'segments' });
    }
    case 'segments.refs': {
      const e = ep(d, n);
      const sg = e.segments.find((x) => x.n === Number(payload.n));
      if (!sg) return r(`没有第 ${payload.n} 段。`);
      const cap = maxRefs(d.settings.videoModel);
      sg.refs = [...new Set((payload.refs || []).filter((c) => asset(d, c)))];
      const over = sg.refs.length > cap;
      if (sg.prompt) { if (live) sg.stale = true; else { const st = sg.status; await writeOne(d, n, sg); sg.status = st; } }
      return payload.quiet && !over ? { reply: '' } : r(`第 ${sg.n} 段参考图：${sg.refs.join('、') || '无'}。${over ? `${modelLabel(d.settings.videoModel)} 最多 ${cap} 张，只会上传前 ${cap} 张。` : ''}${sg.prompt && live ? '提示词需要按新参考图重写。' : ''}`);
    }
    case 'segments.write': {
      const e = ep(d, n);
      const list = e.segments.filter((s) => (payload.n ? s.n === Number(payload.n) : s.status === 'outline'));
      const blocked = [];
      for (const seg of list) {
        if (seg.action && !e.actionCards[seg.n]?.confirmed) {
          if (!e.actionCards[seg.n]) e.actionCards[seg.n] = live ? { ...(await liveActionCard(d, n, seg)), confirmed: false } : { ...structuredClone(S.ACTION_CARD_EP1_S5), confirmed: false };
          blocked.push(seg.n);
          continue;
        }
        await writeOne(d, n, seg);
      }
      if (blocked.length) return r(`其余段落已写好。第 ${blocked.join('、')} 段是打戏，先看武戏方向卡，确认后按「${SK.labelOf('action', d.settings.skills.action)}」写。`);
      return r('提示词写好了，每段都带衔接锁。点开任意一段看全文，或者直接说“第 3 段台词再狠一点”。');
    }
    case 'action.update': {
      const it = ep(d, n).actionCards[payload.n]?.items.find((x) => x.k === payload.k);
      if (it && payload.pick != null) it.pick = Number(payload.pick);
      if (it && payload.v != null) it.v = String(payload.v);
      return { reply: '' };
    }
    case 'action.confirm': {
      const e = ep(d, n);
      const card = e.actionCards[payload.n];
      if (!card) return r('没有这张方向卡。');
      card.confirmed = true;
      await writeOne(d, n, e.segments.find((s) => s.n === Number(payload.n)));
      return r(`方向卡确认，第 ${payload.n} 段写好了，物理冲击与衔接锁都已更新。`);
    }
    case 'segments.revise': {
      const e = ep(d, n);
      const seg = e.segments.find((s) => s.n === Number(payload.n));
      if (!seg) return r(`没有第 ${payload.n} 段。`);
      if (live) {
        const res = await liveSegment(d, n, seg, payload.note);
        Object.assign(seg, { prompt: res.prompt, lock: res.lock, lockText: lockText(seg.n, res.lock), status: 'written' });
        recheck(e);
        const next = e.segments.find((s) => s.n === seg.n + 1);
        return r(`第 ${seg.n} 段按“${payload.note}”完整重写。${next?.prompt ? `结束状态可能变了，第 ${next.n} 段建议重新生成。` : ''}`);
      }
      seg.notes = [...(seg.notes || []), payload.note];
      remember(d, `第 ${n} 集第 ${seg.n} 段：${payload.note}`, 'fact', 'user');
      return r(`记下了：第 ${seg.n} 段“${payload.note}”。模拟模式不改写正文；接入主模型后会完整重发这一段，并检查下一段要不要跟着改。`);
    }
    case 'segments.confirm': {
      const e = ep(d, n);
      if (e.segments.some((s) => !s.prompt)) return r('还有段落没写完。');
      e.segments.forEach((s) => (s.status = 'confirmed'));
      e.stage = 'shoot';
      const vp = d.settings.videoParams;
      return r(`第 ${n} 集 ${e.segments.length} 段锁定。建议先全部出 ${vp.preview} 看节奏，满意的再出 ${vp.final}。`, { episode: n, stage: 'shoot' });
    }
    case 'shoot.submit': {
      const e = ep(d, n);
      const vp = payload.model && payload.model !== d.settings.videoModel ? defaultParams(payload.model, { aspect: d.settings.aspect }) : d.settings.videoParams;
      const res = payload.res === 'final' ? vp.final : payload.res === 'preview' ? vp.preview : (payload.res || vp.preview);
      const model = payload.model || d.settings.videoModel;
      const ns = payload.ns?.length ? payload.ns.map(Number) : e.segments.map((s) => s.n);
      if(integrated){
        e.id ||= randomUUID();
        for(const sn of ns){const seg=e.segments.find(x=>x.n===sn);if(!seg?.prompt||seg.status!=='confirmed')throw Error('请先确认完整分段提示词');seg.id ||= randomUUID();
          const check=validateVideoPrompt(seg.prompt,{seconds:seg.seconds});if(!check.ok)throw Error(`第${sn}段提示词需要修改：${check.errors.join('；')}`);
          if(e.jobs.some(j=>j.segmentId===seg.id&&!['done','failed','cancelled'].includes(j.status)))throw Error('此段已有待确认或进行中的任务，请先处理原任务');
          const job={id:randomUUID(),seg:sn,segmentId:seg.id,episodeId:e.id,res,model,status:'awaiting_confirmation',simulated:false};e.jobs.push(job);
          (d._pending ||= []).push({type:'video',operationId:job.id,episodeId:e.id,segmentId:seg.id,model,params:{duration:seg.seconds,ratio:d.settings.aspect,resolution:res,generateAudio:vp.generateAudio,operation:vp.operation},prompt:seg.prompt+'\n\n不生成背景音乐，不生成字幕。',references:(seg.refs||autoRefs(d,seg)).map(code=>{const a=asset(d,code),v=a?.versions.find(v=>v.id===a.current);if(!v?.url)throw Error(`${code} 尚无可用参考图`);return {url:v.url,name:a.name,code};})});
        }
        return r(`${ns.length} 段已准备。请核对报价、参考素材和额度后确认；尚未提交付费视频任务。`);
      }
      const base = now();
      const busy = e.jobs.filter((j) => j.status !== 'done').length;
      const dur = /1080|2k|4k/i.test(res) ? 18000 : /720|768/i.test(res) ? 13000 : 8000;
      ns.forEach((sn, i) => e.jobs.push({ id: randomUUID().slice(0, 8), seg: sn, res, model, startAt: base + Math.floor((busy + i) / 2) * dur, dur, status: 'queued', simulated: true }));
      return r(`${ns.length} 段已提交 ${res}（${modelLabel(model)}，两路并行）。随片只生成音效、对白和旁白，不带 BGM 和字幕。原型里是模拟任务，不扣费；接入 FG 后走任务中心，按渠道报价显示人民币。`);
    }
    case 'shoot.pick': {
      const seg = ep(d, n).segments.find((s) => s.n === Number(payload.n));
      if (seg) seg.picked = payload.take;
      return { reply: '' };
    }
    case 'post.open': {
      ep(d, n).stage = 'post';
      return r('进入后期：音效、对白和旁白已随视频生成；BGM 按指引去 Suno 用公司 Gmail 生成后配上，字幕导出 SRT 后期加。', { episode: n, stage: 'post' });
    }
    case 'episode.done': {
      const e = ep(d, n);
      e.done = true;
      ep(d, n + 1);
      return r(`第 ${n} 集完成。第 ${n + 1} 集已经建好，随时可以开始。`, { view: 'episodes' });
    }
    case 'episodes.add': {
      if (!d.brief) return r('先告诉我你想拍什么故事。');
      const total = planned(d);
      const after = payload.after === undefined || payload.after === null || payload.after === '' ? total : Math.round(Number(payload.after));
      if (!(after >= 0 && after <= total)) return r(`没有第 ${after} 集，全剧现在是 ${total} 集。`);
      if (total >= 300) return r('全剧最多 300 集。');
      if (after < total) shiftEpisodes(d, after + 1, 1);
      setPlanned(d, total + 1);
      return r(after < total
        ? `在第 ${after} 集后面插入了一集新的第 ${after + 1} 集，原来的第 ${after + 1}–${total} 集顺延为第 ${after + 2}–${total + 1} 集，全剧现在 ${total + 1} 集。`
        : `加了第 ${total + 1} 集，全剧现在 ${total + 1} 集。`, { view: 'episodes' });
    }
    case 'episodes.remove': {
      const k = Math.round(Number(payload.episode));
      const total = planned(d);
      if (!(k >= 1 && k <= total)) return r(`没有第 ${k} 集，全剧现在是 ${total} 集。`);
      if (total <= 1) return r('全剧至少保留一集。');
      const gone = d.episodes.find((x) => x.n === k);
      const had = gone && (gone.chosen || gone.segments.length || Object.values(gone.scripts).some(Boolean));
      d.episodes = d.episodes.filter((x) => x.n !== k);
      for (const a of d.assets.items) if (a.episode === k) a.episode = null;
      d.memory = (d.memory || []).filter((m) => !(m.kind === 'decision' && new RegExp(`第\\s*${k}\\s*集`).test(m.text)));
      shiftEpisodes(d, k + 1, -1);
      setPlanned(d, total - 1);
      return r(`删掉了第 ${k} 集${had ? '（连同它的剧本、分段和成片记录）' : ''}，后面的集往前补位，全剧现在 ${total - 1} 集。这一集新建的资产还留在全剧资产库里，不需要可以在那里删。`, { view: 'episodes' });
    }
    case 'memory.add': {
      const t = String(payload.text || '').trim();
      if (!t) return r('要我记住什么？');
      remember(d, t, 'fact', 'user');
      return r(`记住了：${t}。之后这部剧的剧本、资产和分段都会按这条来。`);
    }
    case 'memory.update': {
      const m = (d.memory || []).find((x) => x.id === payload.id);
      const t = String(payload.text || '').trim().slice(0, 400);
      if (!m || !t) return r('没找到这条记忆。');
      m.text = t; m.edited = true; m.at = iso();
      if (m.kind === 'decision') m.kind = 'fact';
      return payload.quiet ? { reply: '' } : r(`改好了：${t}`);
    }
    case 'memory.remove': {
      const before = (d.memory || []).length;
      d.memory = (d.memory || []).filter((m) => (payload.id ? m.id !== payload.id : !m.text.includes(payload.text || '\u0000')));
      return before === d.memory.length ? r('没找到这条记忆。') : (payload.quiet ? { reply: '' } : r('这条记忆已删除。'));
    }
    case 'nav':
      return { reply: '', nav: payload };
    default:
      return r('这个操作我还不认识。');
  }
}

async function writeOne(d, n, seg) {
  const e = ep(d, n);
  if (d.mode === 'live') {
    const res = await liveSegment(d, n, seg);
    Object.assign(seg, { prompt: res.prompt, lock: res.lock, lockText: lockText(seg.n, res.lock), status: 'written', stale: false });
  } else {
    const full = S.SEGMENTS_EP1.find((s) => s.n === seg.n);
    if (!full) return;
    const style = styleOf(d);
    const timed = retime(full, seg.seconds);
    const refs = refsOf(d, seg).map((c) => { const a = asset(d, c); return { code: c, name: a.name, kind: a.kind }; });
    const prompt = renderSegment(timed, { bible: d.bible, style: { name: style.title, film: style.film || '按画风规范', palette: style.palette?.length ? style.palette : ['按画风规范'], mood: style.description }, title: d.bible.title, episode: n, defaults: d.settings, places: S.PLACES, refs });
    Object.assign(seg, { prompt, lock: full.lock, lockText: lockText(seg.n, full.lock), dialogue: timed.dialogue, beats: timed.beats.map((b) => ({ t: b.t, task: b.task })), status: 'written', stale: false });
  }
  recheck(e);
}

function recheck(e) {
  for (const seg of e.segments) {
    if (!seg.prompt) continue;
    const prev = e.segments.find((s) => s.n === seg.n - 1);
    if (seg.n === 1 || !prev) seg.continuity = { ok: true, notes: ['第一段：从剧本开场起幅'] };
    else if (!prev.lock) seg.continuity = { ok: false, notes: [`等第 ${prev.n} 段写完后核对衔接`] };
    else seg.continuity = checkContinuity(prev, seg);
  }
}

// ---------- free-text turn ----------
const CONFIRM = /^(好|好的|可以|行|确认|没问题|继续|下一步|就这样|ok|okay|yes|go)[!！。.\s]*$/i;
const CN = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const num = (s) => {
  if (/^\d+$/.test(s)) return Number(s);
  const m = String(s).match(/^([一二两三四五六七八九])?(十)?([一二三四五六七八九])?$/);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return m[2] ? (m[1] ? CN[m[1]] : 1) * 10 + (m[3] ? CN[m[3]] : 0) : CN[m[1] || m[3]];
};

export function matchModel(t, capability) {
  const norm = (s) => s.toLowerCase().replace(/[\s·._-]/g, '');
  const tt = norm(t);
  const cands = getModels().filter((m) => !capability || m.capability === capability)
    .flatMap((m) => [norm(m.label), norm(m.id)].map((k) => ({ m, k })))
    .filter(({ k }) => k && tt.includes(k))
    .sort((a, b) => b.k.length - a.k.length);
  if (cands[0]) return cands[0].m;
  const aliases = [
    ['nanobanana', 'gemini-3-pro-image-preview'], ['banana', 'gemini-3-pro-image-preview'], ['gemini', 'gemini-3-pro-image-preview'],
    ['seedance25', 'dreamina-seedance-2-5-filter-off'], ['seedance', 'dreamina-seedance-2-5-filter-off'], ['即梦', 'dola-seedream-5-0-pro-260628'], ['seedream', 'dola-seedream-5-0-pro-260628'],
    ['wan3', 'wan3.0-video'], ['万相', 'wan3.0-video'], ['wan', 'wan2.7-image-pro'], ['海螺', 'MiniMax-H3'], ['minimax', 'MiniMax-H3'], ['happyhorse', 'happyhorse-1.1-r2v'],
    ['gptimage', 'gpt-image-2'], ['sonnet', 'claude-sonnet-5-5-t3a'], ['opus', 'claude-opus-5-5-t3a'], ['deepseek', 'deepseek-v4-pro'], ['gpt6', 'gpt-6-astra'],
  ];
  for (const [k, id] of aliases) {
    const m = byId(id);
    if (tt.includes(k) && (!capability || m.capability === capability)) return m;
  }
  return null;
}

export async function turn(d, text, ctx = {}) {
  d.messages.push({ id: randomUUID(), role: 'user', text, at: iso() });
  const t = text.trim();
  (d._trace ||= []).push(T('memory', `读取本剧记忆 ${(d.memory || []).length} 条`), T('intent', d.mode === 'live' ? `${modelLabel(d.settings.textModel)} 理解意图` : '意图识别（模拟模式规则）'));
  if (d.mode === 'live') {
    try { return await liveTurn(d, t, ctx); } catch (err) { return { reply: say(d, `模型调用失败：${err.message}。可以稍后重试，或在设定里换主脑。`) }; }
  }
  return mockTurn(d, t, ctx);
}

async function mockTurn(d, t, ctx) {
  let m;
  const n = ctx.episode;
  // episodes: "第 3 集后面加一集" / "删掉第 5 集" / "全剧改成 60 集"
  if (!/^(?:请)?(?:帮我)?(?:记住|记一下|记下)/.test(t)) {
    if (d.brief && (m = t.match(/(?:删掉|删除|去掉|不要)\s*第\s*(\d+|[一二两三四五六七八九十]+)\s*集/))) return act(d, 'episodes.remove', { episode: num(m[1]) }, ctx);
    if (d.brief && (m = t.match(/第\s*(\d+|[一二两三四五六七八九十]+)\s*集\s*(?:后面|之后|后)\s*(?:加|插|插入|添)/))) return act(d, 'episodes.add', { after: num(m[1]) }, ctx);
    if (d.brief && /^(?:再)?(?:加|添|多加|新增|增加)(?:一|1)集/.test(t)) return act(d, 'episodes.add', {}, ctx);
    if (d.brief && !/秒/.test(t) && /(改|换|设|变|要|总共|一共|全剧)/.test(t) && (m = t.match(/^(?:全剧|总共|一共)?\s*(?:改成|改为|变成|设成|要)?\s*(\d+)\s*集[。.]?$/) || t.match(/(?:改成|改为|变成|设成|总共|一共)\s*(\d+)\s*集/))) return act(d, 'brief.spec', { episodes: m[1] }, ctx);
  }
  // memory: "记住 …" / "以后 …" / "忘掉 …"
  if ((m = t.match(/^(?:请)?(?:帮我)?(?:忘掉|忘记|不用记|删掉记忆)[：:，,\s]*(.+)$/))) return act(d, 'memory.remove', { text: m[1].replace(/[。.]$/, '') }, ctx);
  if ((m = t.match(/^(?:请)?(?:帮我)?(?:记住|记一下|记下)[：:，,\s]*(.+)$/)) || (m = t.match(/^((?:以后|今后|始终|一律|全剧|每一集).+)$/))) return act(d, 'memory.add', { text: m[1].replace(/[。.]$/, '') }, ctx);
  if ((m = t.match(/(?:删掉|删除|去掉)\s*(@?(?:角色|场景|道具)\s*\d+)/))) return act(d, 'assets.remove', { code: `@${m[1].replace(/[@\s]/g, '')}` }, ctx);
  if ((m = t.match(/(@?(?:角色|场景|道具)\s*\d+)\s*(?:改名|改名为|改名叫|名字改成|叫)[：:\s]*(.+)$/))) return act(d, 'assets.rename', { code: `@${m[1].replace(/[@\s]/g, '')}`, name: m[2].replace(/[。.]$/, '') }, ctx).then((x) => ({ ...x, reply: say(d, `${m[1]} 改名为「${m[2].replace(/[。.]$/, '')}」。`) }));
  if ((m = t.match(/(?:打开|进入|去|看看|开始|写)\s*第\s*(\d+|[一二两三四五六七八九十]+)\s*集/))) {
    const k = num(m[1]);
    if (/写/.test(t) && d.bible?.confirmed) { ep(d, k); return act(d, 'script.sonnet', { episode: k }, ctx); }
    return act(d, 'episode.open', { episode: k }, ctx);
  }
  if (/下一集/.test(t) && n) return act(d, 'episode.open', { episode: n + 1 }, ctx);
  if (/(剧集列表|所有集|集列表|回到剧集)/.test(t)) return act(d, 'nav', { view: 'episodes' });
  if (/(改|换|设|变|要)/.test(t) && (m = t.match(/(\d+)\s*集[^\d]{0,8}(\d+)\s*秒/)) && d.brief) return act(d, 'brief.spec', { episodes: m[1], episodeSeconds: m[2] }, ctx);
  const capHint = /(图片|生图|出图|资产图|定妆|image)/i.test(t) ? 'image' : /(视频|出片|拍摄|video)/i.test(t) ? 'video' : /(主脑|文本|大脑|text)/i.test(t) ? 'text' : null;
  if (/(换|用|改|切)/.test(t) && (m = matchModel(t, capHint))) {
    const target = t.match(/@?(角色|场景|道具)\s*(\d+)/);
    const named = d.assets.items.find((x) => (target && x.code === `@${target[1]}${target[2]}`) || t.toLowerCase().includes(x.name.split(' ')[0].toLowerCase()));
    if (named && m.capability === 'image' && /(重新|重出|生成|出)/.test(t)) return act(d, 'assets.render', { code: named.code, model: m.id }, ctx);
    return act(d, 'settings.model', { model: m.id }, ctx);
  }
  const sk = SK.matchSkill(t);
  if (sk && /(用|开|加|关|不要|换|启用|取消)/.test(t)) {
    const stages = SK.stagesOf(sk);
    if (/(出图|生图|资产|定妆)/.test(t) && stages.includes('render')) {
      const target = d.assets.items.find((x) => t.toLowerCase().includes(x.name.split(' ')[0].toLowerCase()) || t.includes(x.code));
      if (target && /(重新|重出|生成|出)/.test(t)) return act(d, 'assets.render', { code: target.code, skill: sk }, ctx);
      return act(d, 'settings.skill', { stage: 'render', id: /(关|不要|取消)/.test(t) ? 'plain' : sk }, ctx);
    }
    if (/电影感/.test(t) || (stages.includes('boost') && !/(分段|剧本|资产|画风|出图)/.test(t))) return act(d, 'settings.skill', { stage: 'boost', id: sk, on: !/(关|不要|取消)/.test(t) }, ctx);
    const stage = /剧本/.test(t) ? 'script' : /(分段|分镜|视频提示词)/.test(t) ? 'segment' : /(打戏|武戏)/.test(t) ? 'action' : /画风/.test(t) ? 'style' : stages[0];
    if (stages.includes(stage)) return act(d, 'settings.skill', { stage, id: sk }, ctx);
  }
  if (d.bible && /(画风|风格|色调)/.test(t)) {
    if (/(上传|参考图|我的图)/.test(t)) {
      const ups = d.uploads.filter((u) => u.purpose === 'style');
      return act(d, 'style.decode', { refs: ups.map((u) => u.id), palette: ups[0]?.palette || [] }, ctx);
    }
    const p = [...ST.allPresets()].sort((a, b) => b.title.length - a.title.length).find((s) => t.includes(s.title) || s.title.split(/[·\s/]+/).some((w) => w.length >= 2 && t.includes(w)));
    if (p) return act(d, 'style.preset', { id: p.id }, ctx);
  }
  if ((m = t.match(/(?:改|修改)第\s*(\d+)\s*段[，,:：\s]*(.+)/))) return act(d, 'segments.revise', { n: m[1], note: m[2] }, ctx);
  if ((m = t.match(/第\s*(\d+)\s*段.*(?:重写|再|改成|换成|更)/)) && !/(出|生成|拍)/.test(t)) return act(d, 'segments.revise', { n: m[1], note: t }, ctx);
  const e = n ? ep(d, n, false) : null;
  if (e?.segments?.length && /(生成|出|拍|提交)/.test(t) && /(480|720|1080|预览|正式|全部|批量|视频)/i.test(t)) {
    const res = /(720|正式|1080|2k)/i.test(t) ? 'final' : 'preview';
    const one = t.match(/第\s*(\d+)\s*段/);
    return act(d, 'shoot.submit', { res, ns: one ? [Number(one[1])] : undefined }, ctx);
  }
  if (d.assets.items.length) {
    const a = d.assets.items.find((x) => t.toLowerCase().includes(x.name.split(' ')[0].toLowerCase()) || (x.zh && t.includes(x.zh)) || t.includes(x.code));
    if (a && /(重新|重出|再出)/.test(t)) return act(d, 'assets.render', { code: a.code }, ctx);
    if (a && /(换成|改成|加上|要|变成)/.test(t)) return act(d, 'assets.note', { code: a.code, note: t.replace(/^.*?(换成|改成|加上|要|变成)/, '$1') }, ctx);
    if (/(出图|生成资产)/.test(t)) return act(d, 'assets.render', n ? { codes: ep(d, n).castCodes.filter((c) => asset(d, c)?.status === 'draft') } : {}, ctx);
  }
  if (/(灵感|点子|没想好|给我.*想法)/.test(t)) {
    return { reply: say(d, '三个北美正在爆的方向：① 婚礼当场被抛弃的新娘，亮出收购书；② 被赶出狼群的少女，原来是失踪的狼王继承人；③ 重生回到被背叛前一天的女律师。喜欢哪个直接说，或者说你自己的一句话。') };
  }
  if (CONFIRM.test(t)) return confirmStage(d, ctx);
  if (!d.brief) return act(d, 'brief.submit', { idea: t }, ctx);
  if (e && /(你来写|直接写|帮我写|写剧本)/.test(t)) return act(d, 'script.sonnet', { episode: n }, ctx);
  if (e?.stage === 'segments' && /(写|生成|开始|切)/.test(t)) return e.outline ? act(d, 'segments.write', {}, ctx) : act(d, 'segments.plan', {}, ctx);
  return { reply: say(d, hint(d, ctx)) };
}

function confirmStage(d, ctx) {
  const n = ctx.episode;
  if (n) {
    const e = ep(d, n);
    switch (e.stage) {
      case 'script': return e.scripts.sonnet ? act(d, 'script.choose', { channel: e.chosen || 'sonnet' }, ctx) : act(d, 'script.sonnet', {}, ctx);
      case 'cast': {
        const list = e.castCodes.map((c) => asset(d, c)).filter(Boolean);
        const drafts = list.filter((a) => a.status === 'draft');
        if (drafts.length) return act(d, 'assets.render', { codes: drafts.map((a) => a.code) }, ctx);
        for (const a of list) if (a.status === 'ready') a.status = 'approved';
        return act(d, 'cast.confirm', {}, ctx);
      }
      case 'segments': return !e.outline ? act(d, 'segments.plan', {}, ctx) : e.segments.some((s) => !s.prompt) ? act(d, 'segments.write', {}, ctx) : act(d, 'segments.confirm', {}, ctx);
      case 'shoot': return act(d, 'post.open', {}, ctx);
      default: return act(d, 'episode.done', {}, ctx);
    }
  }
  switch (d.stage) {
    case 'brief': return act(d, 'brief.confirm', {}, ctx);
    case 'bible': return act(d, 'bible.confirm', {}, ctx);
    default: return act(d, 'episode.open', { episode: d.episodes.find((x) => !x.done)?.n || 1 }, ctx);
  }
}

function hint(d, ctx) {
  if (ctx.episode) {
    return {
      script: '说“你来写”让我写这一集，或按指引去 AI Studio 写好粘贴回来，也可以上传你们自己的剧本。',
      cast: '说“出图”生成本集新资产；也可以说“出图用 ZY 电影感”“Ava 用 Seedream 重新生成”，或上传已有的定妆照。',
      segments: '可以说“改第 3 段，台词再狠一点”，我会完整重发那一段。',
      shoot: '说“全部出预览”或“第 2 段出正式版”；也可以说“视频换成 Wan 3”。',
      post: '下载 SRT，按指引去 Suno 生成音乐；说“下一集”继续。',
    }[ep(d, ctx.episode).stage];
  }
  return {
    brief: '说一句你想拍的故事就行，比如“被抛弃的新娘反手收购了前夫公司”。',
    bible: '挑一个画风，或者上传几张参考图说“用我的图做画风”。满意就说“确认”。',
    ready: '说“打开第 1 集”或“写第 2 集”。',
  }[d.stage] || '我在。';
}

function actionsDoc() {
  return `可用动作（payload 字段）：
settings.model{model} 模型 id：${getModels().map((m) => `${m.id}(${m.label},${m.capability})`).join('、')}
settings.skill{stage:"script"|"style"|"asset"|"render"|"segment"|"action"|"boost", id, on?}；可用技能：${SK.catalog().filter((s) => s.installed).map((s) => `${s.stage}:${s.id}`).join('、')}
settings.params{imageParams?,videoParams?,segmentSeconds?}
brief.submit{idea} brief.spec{episodes,episodeSeconds} brief.answer{id,pick?|text?} brief.confirm memory.add{text} memory.update{id,text} memory.remove{id?|text?} style.preset{id} style.decode{refs:[上传 id]} style.note{note} bible.confirm
assets.render{code?,codes?,model?,skill?（生图风格技能 render:*）} assets.note{code,note} assets.rename{code,name,zh?} assets.remove{code} assets.approve{code?} assets.confirm assets.add{kind,name,prompt,episode?}
episode.open{episode} script.sonnet{episode} script.choose{episode,channel:"sonnet"|"aistudio"|"upload"} cast.confirm{episode}
segments.plan{episode} segments.refs{episode,n,refs:[资产代号]} segments.write{episode,n?} segments.revise{episode,n,note} segments.confirm{episode} action.confirm{episode,n}
shoot.submit{episode,res:"preview"|"final",ns?,model?} post.open{episode} episode.done{episode} episodes.add{after?（在第几集后插入，省略=加在最后）} episodes.remove{episode} brief.spec 也用来改全剧集数 nav{view?:"episodes",episode?,stage?}
画风预设 id：${ST.allPresets().map((s) => `${s.id}(${s.title})`).join('、')}`;
}

async function liveTurn(d, t, ctx) {
  const where = ctx.episode ? `第 ${ctx.episode} 集 · ${ep(d, ctx.episode).stage}` : `剧集层 · ${d.stage}`;
  const out = await chat({
    streamPresentation:'reply',
    model: d.settings.textModel,
    system: `你是美林，FG 的海外 AI 短剧超级导演。你是这部剧专属的导演，从立项到最后一集都记得之前的决定。成员是审核员：你先给方案，他们确认或提一句修改。用中文简短回答（不超过 3 句）。成员说"记住/以后/每一集都…"时用 memory.add 记下。
本剧记忆：
${memoryText(d) || '（暂无）'}
当前位置：${where}。上传过的文件：${d.uploads.map((u) => `${u.id}(${u.purpose},${u.name})`).join('、') || '无'}。
${actionsDoc()}
只输出 JSON：{"reply":"给成员的话","actions":[{"type":"动作名","payload":{}}]}。成员意图明确才给 actions，可以连续多个（例如先换模型再出图）。`,
    messages: d.messages.slice(-30).map((m) => ({ role: m.role === 'agent' ? 'assistant' : 'user', content: m.text })),
    maxTokens: 8000,
    temperature: 0.3,
  });
  const j = parseDirectorTurn(out);
  let last = { reply: '' };
  for (const a of (j.actions || []).slice(0, 4)) last = await act(d, a.type, a.payload || {}, ctx);
  if (!last.reply && j.reply) say(d, j.reply);
  return { reply: last.reply || j.reply || hint(d, ctx), nav: last.nav };
}

// ---------- exports ----------
export function srt(d, n) {
  const e = ep(d, n);
  const fmt = (s) => {
    const ms = Math.round(s * 1000);
    const p = (x, l = 2) => String(x).padStart(l, '0');
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor((ms % 3600000) / 60000))}:${p(Math.floor((ms % 60000) / 1000))},${p(ms % 1000, 3)}`;
  };
  const rows = [];
  let i = 1, offset = 0;
  for (const seg of e.segments) {
    const lines = seg.dialogue || [...(seg.prompt || '').matchAll(/（(\d+)\s*[—-]\s*(\d+)\s*秒）[：:]\s*"(.+?)"（(.+?)）/g)].map((x) => ({ at: `${x[1]}—${x[2]}`, line: x[3], zh: x[4] }));
    for (const dl of lines) {
      const [a, b] = dl.at.split(/[—-]/).map(Number);
      rows.push(`${i++}\n${fmt(offset + a)} --> ${fmt(offset + b)}\n${dl.line}\n${dl.zh}\n`);
    }
    offset += Number(seg.seconds) || 15;
  }
  return rows.join('\n');
}
export function promptsText(d, n) {
  return ep(d, n).segments.map((s) => `${s.prompt || `（第${s.n}段尚未生成）`}\n\n${s.lockText || ''}`).join('\n\n==========\n\n');
}
export function musicCues(d) {
  const id = styleOf(d).id || '';
  const key = /noir|revenge|suspense|fantasy|dream/.test(id) ? 'gothic-blue' : /neon|mafia|cyber/.test(id) ? 'ny-neon' : /retro|real/.test(id) ? 'seoul-soft' : 'hollywood-gold';
  return STYLE_MUSIC[key];
}
