export const RULE_VERSION = "meeting-20260918-draft-1";
export type Tier = "S" | "A" | "B" | "C";
export const STAGES = ["立项草案", "剧本开发", "样片制作", "批量制作", "验收", "已交付"] as const;
export type Stage = typeof STAGES[number];
export type TopicSnapshot = {
  id: number; title: string; original: string; plot: string; conflict: string;
  tier: string; form: string; style: string; markets: string;
  confidence: string; sourceName: string; sourceRights: string; capturedAt: string;
};
export type Project = {
  id: string; title: string; source: string; brief: string; tier: Tier; market: string;
  style: string; team: string; ownerId: string; ownerName: string; deadline: string;
  initialMinutes: number; totalMinutes: number; budgetCny: number; stage: Stage;
  direction: string; bible: string; ruleVersion: string; deliveryUrl: string;
  topicId: number | null; topicSnapshot?: TopicSnapshot;
  createdAt: string; updatedAt: string;
};
export type ScriptTask = {
  id: string; projectId: string; episode: number; title: string;
  status: "待编写" | "待审核" | "需修改" | "已通过";
  content: string; note: string; prompt: string; version: number;
  directionSnapshot: string; bibleSnapshot: string; ruleVersion: string;
  source: "人工录入" | "模型生成"; generationModel?: string; generationRequestId?: string;
  reviewedBy?: string; updatedAt: string;
  history?: { version: number; content: string; status: string; note: string; at: string; source?: string; generationModel?: string }[];
};
export type LabEvent = { id: string; projectId: string; actor: string; action: string; at: string };
export type LabState = { revision: number; projects: Project[]; tasks: ScriptTask[]; events: LabEvent[] };
export type Actor = { id: string; name: string; reviewer: boolean };
export type Command =
  | { type: "create"; project: Partial<Project> }
  | { type: "update"; projectId: string; changes: Partial<Project> }
  | { type: "plan-scripts"; projectId: string; from: number; count: number }
  | { type: "save-script"; taskId: string; content: string; source?: "人工录入" | "模型生成"; modelId?: string; requestId?: string }
  | { type: "review-script"; taskId: string; approve: boolean; note: string }
  | { type: "advance"; projectId: string; deliveryUrl?: string };

export const EMPTY_STATE: LabState = { revision: 0, projects: [], tasks: [], events: [] };
const text = (x: unknown, max = 1000) => typeof x === "string" ? x.trim().slice(0, max) : "";
const uuid = () => crypto.randomUUID();
const number = (x: unknown, fallback: number, max: number) => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= max ? x : fallback;
export function httpUrl(value: unknown) {
  const raw = text(value, 2000);
  try { const url = new URL(raw); return ["https:", "http:"].includes(url.protocol) ? raw : ""; } catch { return ""; }
}
function normalizeTopicSnapshot(value: unknown, topicId: number | null, now: string): TopicSnapshot | undefined {
  if (!value || typeof value !== "object" || !topicId) return undefined;
  const raw = value as Partial<TopicSnapshot>;
  if (raw.id !== topicId) return undefined;
  return {
    id: topicId, title: text(raw.title, 200), original: text(raw.original, 300),
    plot: text(raw.plot, 3000), conflict: text(raw.conflict, 3000), tier: text(raw.tier, 80),
    form: text(raw.form, 100), style: text(raw.style, 160), markets: text(raw.markets, 300),
    confidence: text(raw.confidence, 160), sourceName: text(raw.sourceName, 300),
    sourceRights: text(raw.sourceRights, 500), capturedAt: text(raw.capturedAt, 40) || now,
  };
}
export function buildScriptPrompt(project: Project, episode: number) {
  const topic = project.topicSnapshot;
  const topicBrief = topic
    ? `【关联选题】#${topic.id} ${topic.title}；原型：${topic.original}；原型来源：${topic.sourceName}\n核心冲突：${topic.conflict || topic.plot}\n建议形式：${topic.form}；风格：${topic.style}；目标市场：${topic.markets}\n选题等级：${topic.tier}；判断：${topic.confidence}；权利状态：${topic.sourceRights}\n这是立项时保存的选题快照；不得把推断写成已验证的市场事实。\n\n`
    : "【关联选题】本项目为原创提案，尚未绑定选题。\n\n";
  return `你是 FG Studio 漫剧编导。只编写第 ${episode} 集，按项目目标市场语言输出对白，制作说明用中文；目标语言未确认时先标注待确认。\n\n` +
    topicBrief +
    `【已确认方向】\n${project.direction}\n【故事圣经】\n${project.bible}\n` +
    `【项目】${project.title} / ${project.tier} 级 / ${project.market} / ${project.style}\n` +
    `【范围】首批 ${project.initialMinutes} 分钟，总体 ${project.totalMinutes} 分钟框架。单集长度由剧情决定，不把分钟数当集数。\n` +
    `【交付格式】集名、目标时长、开场钩子、分场行动与对白、冲突升级、结尾悬念、连续性记录、待确认问题。每场用“第N场｜内/外景、地点、时间”单独起行；每个镜头用“镜头N｜景别｜机位/运镜”起行，并包含画面动作、角色/道具引用、对白或声音、时长与视频提示词。每集拆成可独立审阅的镜头段落，禁止把整集压成一段。\n` +
    `【规则】10 秒内建立观看理由；钩子、冲突、悬念按情节安排。具体时间阈值是试行规则，不机械填充。保持人物身份、动机、空间和道具连续。不得虚构市场数据或宣称已通过审核。\n` +
    `【上下文补充】正式编写前提供已通过的上一集全文/摘要及已确认分集大纲；缺失时先列出待确认项，不自行编造前集。\n` +
    `【版本】${project.ruleVersion}；来源：${project.source || "用户原创提案"}。`;
}
export function applyCommand(current: LabState, command: Command, actor: Actor, now = new Date().toISOString()): LabState {
  const state = structuredClone(current);
  let project: Project | undefined;
  let action = "";
  const writable = (p: Project) => { if (p.ownerId !== actor.id && !actor.reviewer) throw new Error("仅项目负责人或审核人可修改此项目"); };
  if (command.type === "create") {
    const p = command.project;
    if (!text(p.title, 100)) throw new Error("请填写项目名称");
    const topicId = Number.isInteger(p.topicId) && Number(p.topicId) > 0 ? Number(p.topicId) : null;
    const snapshot = normalizeTopicSnapshot(p.topicSnapshot, topicId, now);
    project = { id: uuid(), title: text(p.title, 100), source: text(p.source), brief: text(p.brief, 6000),
      tier: ["S", "A", "B", "C"].includes(p.tier || "") ? p.tier! : "A", market: text(p.market, 120) || "待确认",
      style: text(p.style, 120) || "待确认", team: text(p.team, 80) || "待分组", ownerId: actor.id, ownerName: actor.name,
      deadline: /^\d{4}-\d{2}-\d{2}$/.test(p.deadline || "") ? p.deadline! : "", initialMinutes: number(p.initialMinutes, 20, 300),
      totalMinutes: number(p.totalMinutes, 100, 1000), budgetCny: number(p.budgetCny, 0, 1000000), stage: "立项草案",
      direction: "", bible: "", ruleVersion: RULE_VERSION, deliveryUrl: "", topicId, topicSnapshot: snapshot, createdAt: now, updatedAt: now };
    if (project.totalMinutes < project.initialMinutes) throw new Error("总体时长不能小于首批时长");
    state.projects.unshift(project); action = "建立立项草案";
  } else if (command.type === "save-script" || command.type === "review-script") {
    const task = state.tasks.find(t => t.id === command.taskId);
    if (!task) throw new Error("剧本任务不存在");
    project = state.projects.find(p => p.id === task.projectId);
    if (!project) throw new Error("项目不存在");
    if (command.type === "save-script") {
      writable(project);
      if (!["立项草案", "剧本开发"].includes(project.stage)) throw new Error("项目已进入制作，请先在新版本中修改剧本");
      if (task.directionSnapshot !== project.direction || task.bibleSnapshot !== project.bible) throw new Error("项目方向已变更，请重新规划这一集的任务");
      const content = text(command.content, 50000);
      if (content.length < 30) throw new Error("请录入完整剧本文本（至少 30 字）");
      if (task.version > 0) task.history = [...(task.history || []), { version: task.version, content: task.content, status: task.status, note: task.note, at: task.updatedAt, source: task.source, generationModel: task.generationModel }];
      task.content = content; task.status = "待审核"; task.note = ""; task.version += 1; task.source = command.source === "模型生成" ? "模型生成" : "人工录入";
      task.generationModel = task.source === "模型生成" ? text(command.modelId, 120) || undefined : undefined;
      task.generationRequestId = task.source === "模型生成" ? text(command.requestId, 80) || undefined : undefined;
      delete task.reviewedBy;
      action = `第 ${task.episode} 集提交剧本 v${task.version}`;
    } else {
      if (!actor.reviewer) throw new Error("只有审核人可审核剧本");
      if (task.status !== "待审核") throw new Error("只能审核待审核版本");
      if (task.directionSnapshot !== project.direction || task.bibleSnapshot !== project.bible) throw new Error("剧本依据已过期，请先重新规划");
      if (!command.approve && !text(command.note)) throw new Error("退回时请说明修改原因");
      task.status = command.approve ? "已通过" : "需修改";
      task.note = text(command.note, 2000); task.reviewedBy = actor.name;
      action = `第 ${task.episode} 集 v${task.version}${command.approve ? "审核通过" : "退回修改"}`;
    }
    task.updatedAt = now;
  } else {
    project = state.projects.find(p => p.id === command.projectId);
    if (!project) throw new Error("项目不存在");
    writable(project);
    if (command.type === "update") {
      if (!["立项草案", "剧本开发"].includes(project.stage)) throw new Error("项目已进入制作，本版暂不支持修改上游设定");
      const changes = command.changes;
      if (state.tasks.some(t => t.projectId === project!.id) && ((typeof changes.direction === "string" && text(changes.direction, 10000) !== project.direction) || (typeof changes.bible === "string" && text(changes.bible, 20000) !== project.bible))) throw new Error("项目已有分集任务，方向与故事圣经已锁定；变更请新建立项版本以保留审核依据");
      if (typeof changes.direction === "string") project.direction = text(changes.direction, 10000);
      if (typeof changes.bible === "string") project.bible = text(changes.bible, 20000);
      if (typeof changes.brief === "string") project.brief = text(changes.brief, 6000);
      action = "保存方向与故事圣经";
    } else if (command.type === "plan-scripts") {
      if (!["立项草案", "剧本开发"].includes(project.stage)) throw new Error("制作阶段不能增加当前剧本批次");
      if (project.direction.length < 15 || project.bible.length < 30) throw new Error("请先保存明确的创作方向（至少 15 字）与故事圣经（至少 30 字）");
      if (!Number.isInteger(command.count) || command.count < 1 || command.count > 20 || !Number.isInteger(command.from) || command.from < 1 || command.from + command.count > 201) throw new Error("每批 1–20 集，集号范围 1–200");
      for (let ep = command.from; ep < command.from + command.count; ep++) {
        const existing = state.tasks.find(t => t.projectId === project!.id && t.episode === ep);
        if (existing) throw new Error(`第 ${ep} 集已有任务。请编辑原任务；上游变更需另立版本，不能覆盖历史。`);
        state.tasks.push({ id: uuid(), projectId: project.id, episode: ep, title: `第 ${String(ep).padStart(2, "0")} 集`, status: "待编写", content: "", note: "", prompt: buildScriptPrompt(project, ep), version: 0, directionSnapshot: project.direction, bibleSnapshot: project.bible, ruleVersion: project.ruleVersion, source: "人工录入", updatedAt: now });
      }
      project.stage = "剧本开发"; action = `规划第 ${command.from}–${command.from + command.count - 1} 集；尚未调用模型`;
    } else if (command.type === "advance") {
      if (!actor.reviewer) throw new Error("阶段放行需要审核人确认");
      const index = STAGES.indexOf(project.stage);
      if (index === STAGES.length - 1) throw new Error("项目已交付");
      if (!project.direction || !project.bible) throw new Error("请先完成方向与故事圣经");
      if (project.stage === "剧本开发") {
        const tasks = state.tasks.filter(t => t.projectId === project!.id);
        if (!tasks.length || tasks.some(t => t.status !== "已通过" || t.directionSnapshot !== project!.direction || t.bibleSnapshot !== project!.bible)) throw new Error("本批剧本需全部通过审核，且与当前方向一致");
      }
      if (project.stage === "验收") {
        const url = httpUrl(command.deliveryUrl);
        if (!url) throw new Error("交付前需要可访问的 HTTP(S) 成片/交付包链接");
        project.deliveryUrl = url;
      }
      project.stage = STAGES[index + 1]; action = `人工确认进入${project.stage}`;
    } else throw new Error("不支持的操作");
  }
  if (state.projects.length > 500 || state.tasks.length > 5000) throw new Error("试用版容量已达上限，请导出后联系管理员");
  project.updatedAt = now;
  state.events.unshift({ id: uuid(), projectId: project.id, actor: actor.name, action, at: now });
  state.revision++; return state;
}

export function demoState(): LabState {
  const actor = { id: "demo-user", name: "测试负责人", reviewer: true };
  const topic: TopicSnapshot = { id: 23, title: "丈夫禁止进入的房间", original: "蓝胡子｜佩罗", plot: "保留禁室、前妻秘密与营救；每条新证据都使一条逃生路径失效。", conflict: "保留禁室、前妻秘密与营救；每条新证据都使一条逃生路径失效。", tier: "★★★ 本轮优先", form: "AI真人", style: "哥特恐怖／婚姻悬疑", markets: "北美、拉美、泰国", confidence: "邻近参照／开发推断", sourceName: "鹅妈妈故事等佩罗童话", sourceRights: "未完成商业使用清查", capturedAt: "2026-09-23T00:00:00.000Z" };
  let state = applyCommand(EMPTY_STATE, { type: "create", project: { title: "蓝胡子：禁室之后", topicId: topic.id, topicSnapshot: topic, source: "推进台 #23 · 蓝胡子｜佩罗", tier: "A", market: "北美 · 英语 · APP", style: "AI 真人 / 哥特婚姻悬疑", team: "试制一组", initialMinutes: 20, totalMinutes: 100, budgetCny: 2000, brief: topic.conflict } }, actor);
  state = applyCommand(state, { type: "update", projectId: state.projects[0].id, changes: { direction: "女主主动进入婚姻调查姐姐失踪案，禁室是证据库；每次调查都迫使她重新判断丈夫与盟友。", bible: "女主：艾琳，调查者，目标是找到姐姐；丈夫：庄园主人，隐瞒家族交易；核心道具：变色钥匙。常驻场景：门厅、书房、禁室。第一阶段围绕证据与逃生展开，不新增无关神话设定。" } }, actor);
  return { ...state, events: state.events.map(e => ({ ...e, action: `演示 · ${e.action}` })) };
}
