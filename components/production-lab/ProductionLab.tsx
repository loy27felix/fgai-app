"use client";

import React, { useEffect, useMemo, useState } from "react";
import zhCN from "antd/locale/zh_CN";
import { Alert, App, Button, Drawer, Form, Input, InputNumber, Modal, Pagination, Select, Space, Table, Tabs, Tag } from "antd";
import { ArrowLeft, ArrowUpRight, BookOpen, CheckCheck, ChevronRight, Clapperboard, Download, LayoutDashboard, Layers3, ListChecks, Plus, Search, Settings2 } from "lucide-react";
import { applyCommand, demoState, EMPTY_STATE, STAGES, type Actor, type Command, type LabState, type Project, type ScriptTask } from "../../lib/production-lab/domain";
import topicData from "../../lib/production-lab/topics.json";
import { teamSelectedTopics } from "../../lib/production-lab/selected-topics";
import s from "./ProductionLab.module.css";
import { PRODUCTION_LAB_DEMO_STATE_KEY } from "../../lib/production-lab/storage-keys";
import ProductionLabAdmin from "./ProductionLabAdmin";

type Topic = { id: number; title: string; original: string; plot: string; markets: string[] | string; tier: string; form?: string; style: string; confidence: string; blocked?: boolean; source_rights: string; conflict: string; source_name: string; selection_group?: string; selected_by?: string; selected_by_email?: string; selected_at?: string };
type OpsModel = { id: string; label: string; configured: boolean };
type OpsRun = { actor_id: string; request_id: string; model_id: string; project_id: string; task_id: string; episode: number; status: string; error?: string | null; result?: { usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number } } | null; created_at: string };
// Put the team's confirmed selections first so they are visible on the first page.
const topics = [...teamSelectedTopics as Topic[], ...topicData as unknown as Topic[]];
function topicSnapshot(topic: Topic) {
  return {
    id: topic.id, title: topic.title, original: topic.original, plot: topic.plot, conflict: topic.conflict,
    tier: topic.tier, form: topic.form || "", style: topic.style, markets: String(topic.markets),
    confidence: topic.confidence, sourceName: topic.source_name, sourceRights: topic.source_rights,
    capturedAt: new Date().toISOString(), selectionGroup: topic.selection_group,
    selectedBy: topic.selected_by, selectedByEmail: topic.selected_by_email, selectedAt: topic.selected_at,
  };
}
const demoActor: Actor = { id: "demo-user", name: "测试负责人", reviewer: true };
function download(name: string, content: string, mime = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function ProductionLab(props: { demo?: boolean; actor?: Actor; appearance?: "light" | "dark"; onBackToWorkspace?: () => void; onOpenWorkspace?: (projectId: string) => void }) {
  return <Desk {...props} />;
}
function Desk({ demo = false, actor = demoActor, appearance = "light", onBackToWorkspace, onOpenWorkspace }: { demo?: boolean; actor?: Actor; appearance?: "light" | "dark"; onBackToWorkspace?: () => void; onOpenWorkspace?: (projectId: string) => void }) {
  const { message, modal } = App.useApp();
  const [state, setState] = useState<LabState>(EMPTY_STATE);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState("projects");
  const [query, setQuery] = useState(""); const [topicPage, setTopicPage] = useState(1);
  const [projectId, setProjectId] = useState<string>();
  const [createOpen, setCreateOpen] = useState(false);
  const [task, setTask] = useState<ScriptTask>();
  const [script, setScript] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [opsModels, setOpsModels] = useState<OpsModel[]>([]);
  const [opsRuns, setOpsRuns] = useState<OpsRun[]>([]);
  const [opsLoading, setOpsLoading] = useState(false);
  const [opsError, setOpsError] = useState("");
  const [from, setFrom] = useState(1);
  const [count, setCount] = useState(3);
  const [createForm] = Form.useForm();
  const [directionForm] = Form.useForm();
  const project = state.projects.find(p => p.id === projectId);
  const projectTasks = state.tasks.filter(t => t.projectId === projectId);
  async function refresh() {
    try {
      const response = await fetch("/api/production-lab", { cache: "no-store" }); const body = await response.json();
      if (!response.ok) throw new Error(body.error); setState(body.state); setError(""); setReady(true);
    } catch (e) { setError(e instanceof Error ? e.message : "加载失败"); }
  }
  useEffect(() => {
    if (!demo) { void refresh(); return; }
    try { const saved = localStorage.getItem(PRODUCTION_LAB_DEMO_STATE_KEY); const parsed = saved ? JSON.parse(saved) : demoState(); if (!Array.isArray(parsed.projects) || !Array.isArray(parsed.tasks)) throw new Error(); if (!saved) localStorage.setItem(PRODUCTION_LAB_DEMO_STATE_KEY, JSON.stringify(parsed)); setState(parsed); setReady(true); }
    catch { setError("本机试用数据无法读取，请导出或清理对应浏览器存储后重新试用。"); }
  }, [demo]);
  useEffect(() => {
    if (view !== "ops") return;
    if (demo) { setOpsModels([]); setOpsRuns([]); setOpsError("示例模式不读取模型与服务器运行记录"); return; }
    let cancelled = false;
    setOpsLoading(true); setOpsError("");
    void Promise.all([
      fetch("/api/production-lab/models", { cache: "no-store" }).then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "模型目录读取失败"); return body; }),
      fetch("/api/production-lab/models?view=runs", { cache: "no-store" }).then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "运行记录读取失败"); return body; }),
    ]).then(([modelBody, runBody]) => {
      if (cancelled) return;
      setOpsModels(Array.isArray(modelBody.models) ? modelBody.models : []);
      setOpsRuns(Array.isArray(runBody.runs) ? runBody.runs : []);
    }).catch(error => { if (!cancelled) setOpsError(error instanceof Error ? error.message : "运行信息读取失败"); })
      .finally(() => { if (!cancelled) setOpsLoading(false); });
    return () => { cancelled = true; };
  }, [view, demo]);
  useEffect(() => { if (project) directionForm.setFieldsValue({ direction: project.direction, bible: project.bible }); }, [project?.id, project?.direction, project?.bible, directionForm]);
  async function send(command: Command) {
    if (!ready || busy) return false; setBusy(true);
    try {
      let next: LabState;
      if (demo) { next = applyCommand(state, command, actor); localStorage.setItem(PRODUCTION_LAB_DEMO_STATE_KEY, JSON.stringify(next)); }
      else { const response = await fetch("/api/production-lab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: state.revision, command }) }); const body = await response.json(); if (!response.ok) { if (response.status === 409) await refresh(); throw new Error(body.error); } next = body.state; }
      setState(next); message.success("已保存"); return true;
    } catch (e) { message.error(e instanceof Error ? e.message : "保存失败"); return false; }
    finally { setBusy(false); }
  }
  function openCreate(topic?: Topic) {
    const source = topic?.selection_group
      ? `${topic.selection_group}已选题 · ${topic.selected_by} <${topic.selected_by_email || "账号待核实"}> · ${topic.selected_at}；故事原型、市场与权利待补充`
      : topic ? `${topic.original}｜${topic.source_name || "推进台"} #${topic.id}；权利：${topic.source_rights || "待审核"}` : "原创提案";
    createForm.resetFields(); createForm.setFieldsValue({ topicId: topic?.id ?? null, title: topic?.title || "", source, brief: topic?.selection_group ? "团队已选题；故事梗概、改编来源与市场方向待补充。" : topic?.conflict || topic?.plot || "", tier: topic?.tier?.startsWith("★★★") ? "A" : "B", market: topic ? String(topic.markets) : "待确认", style: topic ? `${topic.form || "形式待确认"} / ${topic.style}` : "待确认", team: "试制一组", initialMinutes: 20, totalMinutes: 100, budgetCny: 0 }); setCreateOpen(true);
  }
  const filteredTopics = useMemo(() => topics.filter(t => `${t.title} ${t.original} ${t.conflict} ${t.markets} ${t.selection_group || ""} ${t.selected_by || ""} ${t.selected_by_email || ""}`.toLowerCase().includes(query.toLowerCase())), [query]);
  const pending = state.tasks.filter(t => t.status === "待审核").length;
  const nav = [{ key: "projects", label: "项目与进度", icon: LayoutDashboard }, { key: "topics", label: "选题提案", icon: BookOpen }, { key: "scripts", label: "批量剧本", icon: ListChecks }, { key: "ops", label: "用量与管理", icon: Settings2 }];
  const headings: Record<string, [string, string]> = { projects: ["让每一个故事，走向交付。", `团队已选 ${teamSelectedTopics.length} 条，分组与选择人已关联；从选题直接立项，制作全程归入同一项目。`], topics: ["好故事，先有明确的选择。", `团队已选 ${teamSelectedTopics.length} 条已置顶；下方继续浏览原有 100 条选题快照。`], scripts: ["把创意，变成可审核的剧本。", "从项目打开批量剧本；多模型逐集对照，确认版本会回到项目审核和画布。"], ops: ["看见进度，也看见投入。", "查看模型、技能包、剧本运行记录与计划预算。" ] };
  const projectColumns = [
    { title: "制作项目", dataIndex: "title", render: (_: unknown, p: Project) => <button className={s.projectLink} onClick={() => setProjectId(p.id)}><span>{p.title}</span><small>{p.topicId ? `选题 #${p.topicId} · ${p.topicSnapshot?.title || "已关联选题"} · ` : ""}{p.market} · {p.style}</small></button> },
    { title: "投入档位", dataIndex: "tier", render: (v: string) => <Tag className={s.tier}>{v}</Tag> },
    { title: "当前阶段", dataIndex: "stage", render: (v: string) => <span className={s.stage}><i />{v}</span> },
    { title: "负责人", dataIndex: "ownerName" },
    { title: "计划预算", dataIndex: "budgetCny", render: (v: number) => v ? `¥ ${v.toLocaleString()}` : "待设定" },
    { title: "", key: "open", render: (_: unknown, p: Project) => <Button type="text" aria-label={`打开${p.title}`} onClick={() => setProjectId(p.id)} icon={<ArrowUpRight size={16} />} /> }
  ];
  const teamTopicColumns = [
    { title: "团队已选选题", dataIndex: "title", render: (title: string, topic: Topic) => <div className={s.selectedTopicTitle}><strong>{title}</strong><small>#{topic.id} · 选题原型与制作方向待补充</small></div> },
    { title: "选择人 / 平台账号", dataIndex: "selected_by", render: (_: unknown, topic: Topic) => <div className={s.topicIdentity}><strong>{topic.selected_by}</strong><small>{topic.selected_by_email || "账号待绑定"}</small></div> },
    { title: "选择时间", dataIndex: "selected_at" },
    { title: "", key: "action", render: (_: unknown, topic: Topic) => { const linked = state.projects.find(p => p.topicId === topic.id); return <Button size="small" type={linked ? "default" : "primary"} onClick={() => linked ? setProjectId(linked.id) : openCreate(topic)}>{linked ? "打开项目" : "关联立项"}</Button>; } },
  ];
  const scriptColumns = [
    { title: "分集", dataIndex: "title" }, { title: "状态", dataIndex: "status", render: (v: string) => <Tag color={v === "已通过" ? "green" : v === "待审核" ? "gold" : "default"}>{v}</Tag> },
    { title: "版本", dataIndex: "version", render: (v: number) => `v${v}` },
    { title: "操作", key: "edit", render: (_: unknown, t: ScriptTask) => <Space><Button size="small" onClick={() => { setTask(t); setScript(t.content); setReviewNote(""); }}>查看 / 编辑</Button><Button size="small" type="text" onClick={() => download(`第${t.episode}集-编剧任务.md`, t.prompt)}>导出任务</Button></Space> }
  ];
  return <div className={`${s.root} ${appearance === "dark" ? s.dark : s.light}`}>
    <aside className={s.sidebar}><div className={s.brand}><span>FG</span><div>STUDIO<small>PRODUCTION LAB / 06</small></div></div><div className={s.workspace}><span className={s.workspaceIcon}><Clapperboard size={19} /></span><div>漫剧制作中心<small>独立试用空间</small></div></div><div className={s.navCaption}>工作空间</div><nav>{nav.map(n => <button key={n.key} className={view === n.key ? s.active : ""} onClick={() => { setView(n.key); setQuery(""); }}><n.icon size={18} />{n.label}{n.key === "scripts" && pending > 0 && <b>{pending}</b>}</button>)}</nav><div className={s.sidebarFoot}><span className={s.avatar}>FG</span><div>{actor.name}<small>{actor.reviewer ? "负责人 / 审核人" : "项目成员"}</small></div><span className={s.online} /></div></aside>
    <main className={s.main}><header className={s.topbar}><div>第六板块 <ChevronRight size={13} /> <strong>{nav.find(n => n.key === view)?.label}</strong></div><div className={s.topbarRight}><span className={s.pilot}><i />{demo ? "本机交互试用" : "内测白名单"}</span><Button type="primary" className={s.canvasReturn} icon={<ArrowLeft size={15} />} disabled={!onBackToWorkspace} onClick={onBackToWorkspace}>回到制作画布</Button></div></header>
      <div className={s.notice}>{demo ? "交互试用 · 含示例项目 · 数据仅保存在本浏览器 · 不调用模型、不产生费用" : "管理试用 · 使用独立数据库 · 自动剧本生成与成片尚未接入"}</div>
      <div className={s.content}><div className={s.heading}><div><div className={s.eyebrow}>FG PRODUCTION / {view.toUpperCase()}</div><h1>{headings[view][0]}</h1><p>{headings[view][1]}</p></div><Button type="primary" size="large" icon={<Plus size={17} />} disabled={!ready} onClick={() => openCreate()}>新建立项</Button></div>
        {error && <Alert type="error" showIcon message={error} action={!demo && <Button onClick={refresh}>重新加载</Button>} />}
        {view === "projects" && <><div className={s.metrics}>{[{ label: "进行中的项目", value: state.projects.filter(p => p.stage !== "已交付").length, hint: "按实际立项统计" }, { label: "等待剧本审核", value: pending, hint: "审核通过后进入制作" }, { label: "已规划分集", value: state.tasks.length, hint: "任务数 ≠ 已生成剧本" }, { label: "计划预算合计", value: `¥${state.projects.reduce((n, p) => n + p.budgetCny, 0).toLocaleString()}`, hint: "非实际费用" }].map(m => <div key={m.label}><small>{m.label}</small><strong>{m.value}</strong><span>{m.hint}</span></div>)}</div>
          <section className={`${s.panel} ${s.selectedTopicsPanel}`}><div className={s.sectionTitle}><h2>团队已选选题</h2><Tag color="blue">{teamSelectedTopics.length} 条</Tag><span>保留会议中的分组、选择人和时间</span><Button type="link" onClick={() => { setView("topics"); setQuery(""); }}>打开选题提案 <ArrowUpRight size={14} /></Button></div>{["小组1", "小组2"].map(group => { const rows = teamSelectedTopics.filter(topic => topic.selection_group === group) as Topic[]; return <div key={group} className={s.selectedTopicGroup}><div className={s.selectedTopicGroupTitle}><strong>{group}</strong><span>{rows.length} 条</span></div><Table rowKey="id" columns={teamTopicColumns} dataSource={rows} pagination={false} size="small" scroll={{ x: 660 }} /></div>})}</section>
          <section className={s.panel}><div className={s.sectionTitle}><h2>项目推进</h2><span>{state.projects.length} 个项目</span><Button type="text" icon={<Download size={14} />} onClick={() => download("制作台-数据快照.json", JSON.stringify(state, null, 2), "application/json")}>导出快照</Button></div><Table rowKey="id" columns={projectColumns} dataSource={state.projects} pagination={{ pageSize: 8 }} scroll={{ x: 850 }} locale={{ emptyText: "目前没有已立项项目；团队已选选题已在上方单独列出，可直接关联立项。" }} /></section>
          <div className={s.lowerGrid}><section className={s.panel}><div className={s.sectionTitle}><h2>下一步，先把故事说清楚</h2></div><div className={s.checklist}><div><span>01</span><div><strong>选题与立项</strong><small>来源、受众、核心冲突、档位与预算</small></div><CheckCheck size={19} /></div><div><span>02</span><div><strong>确认方向与故事圣经</strong><small>人物、世界规则、分集大纲、连续性约束</small></div><ChevronRight size={18} /></div><div><span>03</span><div><strong>批量剧本任务 → 人工审核</strong><small>先确认内容，再放行样片与后续制作</small></div><ChevronRight size={18} /></div></div></section><section className={`${s.panel} ${s.editorial}`}><div className={s.eyebrow}>STORY DEVELOPMENT</div><h2>100 个故事种子。<br />下一步是具体提案。</h2><p>把经典原型转化为明确的人物困境、目标市场与制作方案。</p><Button onClick={() => setView("topics")} icon={<ArrowUpRight size={16} />}>进入选题库</Button></section></div></>}
        {view === "topics" && <><div className={s.toolbar}><Input prefix={<Search size={16} />} placeholder="搜索故事、冲突、选择人、账号或小组" value={query} onChange={e => { setQuery(e.target.value); setTopicPage(1); }} allowClear /><span>{filteredTopics.length} 条选题（团队已选置顶）</span></div><div className={s.topicGrid}>{filteredTopics.slice((topicPage - 1) * 12, topicPage * 12).map(t => { const linkedProject = state.projects.find(p => p.topicId === t.id); return <article className={s.topicCard} key={t.id}><div className={s.topicTop}><span>#{String(t.id).padStart(3, "0")}{t.selection_group ? ` · ${t.selection_group}` : ""}</span><Tag color={linkedProject ? "green" : t.selection_group ? "blue" : undefined}>{linkedProject ? "已关联项目" : t.selection_group ? "团队已选" : t.confidence || "开发推断"}</Tag></div><h3>{t.title}</h3><small>{t.selection_group ? `${t.selected_by} · ${t.selected_by_email} · ${t.selected_at}` : t.original}</small><p>{t.selection_group ? "此条保留团队已选决定。故事原型、梗概、市场及权利信息仍需补充。" : t.conflict || t.plot}</p><div className={s.topicMeta}>{String(t.markets)}<br />来源权利：{t.source_rights || "待审核"}</div><Button block disabled={!!t.blocked || !ready} onClick={() => linkedProject ? setProjectId(linkedProject.id) : openCreate(t)}>{t.blocked ? "暂缓开发" : linkedProject ? "打开关联项目" : t.selection_group ? "关联到制作项目" : "以此建立提案"}<ArrowUpRight size={14} /></Button></article>; })}</div><div className={s.batchBar}><Pagination current={topicPage} pageSize={12} total={filteredTopics.length} onChange={setTopicPage} showSizeChanger={false} /></div><p className={s.muted}>团队选择记录保留原有分组、选择人账号和时间；选题原型、市场、改编依据与权利资料仍待补齐。原有 100 条选题快照继续保留。</p></>}
        {view === "scripts" && <section className={s.panel}><div className={s.sectionTitle}><h2>全部分集任务</h2><span>请从项目中批量规划</span></div><Table rowKey="id" columns={[{ title: "项目", render: (_: unknown, t: ScriptTask) => state.projects.find(p => p.id === t.projectId)?.title }, ...scriptColumns]} dataSource={state.tasks} scroll={{ x: 700 }} locale={{ emptyText: "打开制作项目，确认方向后规划分集任务" }} /></section>}
        {view === "ops" && <>
          <ProductionLabAdmin demo={demo} appearance={appearance} />
          <div className={s.opsGrid}>
            <section className={s.panel}><div className={s.sectionTitle}><h2>预算边界</h2></div><div className={s.opsBody}><strong>¥ {state.projects.reduce((n, p) => n + p.budgetCny, 0).toLocaleString()}</strong><p>立项计划预算合计</p><Alert message="计划预算与实际费用分开" description="费用统计已按 WeToken 对账、服务商回报和模型费率估算分栏；这里的金额只代表已立项预算。" type="info" /></div></section>
            <section className={s.panel}><div className={s.sectionTitle}><h2>档位与产能</h2></div><div className={s.opsBody}><p>S / A / B / C 表示投入档位；上线表现独立记录。</p><p>会议中的人周产能是试行目标，不能自动当成承诺。C 级单部时长、团队人数和统计口径仍需确认。</p><Tag>规则版本：会议试行稿</Tag></div></section>
          </div>
          <div className={s.opsGrid}>
            <section className={s.panel}><div className={s.sectionTitle}><h2>文本模型接入</h2><span>密钥只在服务端</span></div><div className={s.opsBody}>{opsModels.length ? opsModels.map(model => <p key={model.id}><Tag color="green">已配置</Tag><strong>{model.label}</strong><small> · {model.id}</small></p>) : <p>{demo ? "示例模式未读取" : "尚无可用的文本模型配置"}</p>}<small>{opsError || "模型列表只显示第六板块独立服务的配置，不代表可用额度或实际费用。"}</small></div></section>
            <section className={s.panel}><div className={s.sectionTitle}><h2>剧本生成记录</h2><span>{actor.reviewer ? "试用空间 · 最近 30 条" : "本账号 · 最近 30 条"}</span></div><Table loading={opsLoading} rowKey="request_id" dataSource={opsRuns} pagination={{ pageSize: 8 }} locale={{ emptyText: opsError || "尚无已登记的文本模型调用" }} columns={[{ title: "创建时间", dataIndex: "created_at", render: (v: string) => new Date(v).toLocaleString("zh-CN") }, { title: "项目 / 集", render: (_: unknown, row: OpsRun) => `${state.projects.find(p => p.id === row.project_id)?.title || row.project_id.slice(0, 8)} / EP${String(row.episode).padStart(2, "0")}` }, { title: "模型", dataIndex: "model_id", render: (v: string) => opsModels.find(model => model.id === v)?.label || v }, { title: "状态", dataIndex: "status", render: (v: string) => <Tag color={v === "succeeded" ? "green" : v === "running" ? "blue" : v === "unknown" ? "orange" : "red"}>{v === "succeeded" ? "成功" : v === "running" ? "运行中" : v === "unknown" ? "待核对" : "失败"}</Tag> }, { title: "Token", render: (_: unknown, row: OpsRun) => row.result?.usage?.total_tokens ?? "未返回" }, { title: "记录号", dataIndex: "request_id", render: (v: string) => v.slice(0, 8) }]} /></section>
          </div>
          <section className={s.panel}><div className={s.sectionTitle}><h2>操作记录</h2><span>记录实际发生的人工操作</span></div><Table rowKey="id" dataSource={state.events} columns={[{ title: "时间", dataIndex: "at", render: (v: string) => new Date(v).toLocaleString("zh-CN") }, { title: "操作人", dataIndex: "actor" }, { title: "事件", dataIndex: "action" }]} pagination={{ pageSize: 10 }} /></section>
        </>}
      </div><footer className={s.footer}>FG STUDIO · PRODUCTION LAB <span>独立研发 / v0 管理试用</span></footer></main>
    <Modal open={createOpen} title="新建立项 · 把方向变成制作任务" onCancel={() => setCreateOpen(false)} onOk={() => createForm.submit()} confirmLoading={busy} okText="建立草案" width={660}><Form form={createForm} layout="vertical" onFinish={async values => { const topic = topics.find(item => item.id === Number(values.topicId)); const projectDraft = { ...values, topicId: topic?.id ?? null, topicSnapshot: topic ? topicSnapshot(topic) : undefined }; if (await send({ type: "create", project: projectDraft })) setCreateOpen(false); }}><Form.Item name="topicId" hidden><InputNumber /></Form.Item><Form.Item name="title" label="项目名称" rules={[{ required: true, message: "请填写名称" }]}><Input maxLength={100} /></Form.Item><div className={s.formGrid}><Form.Item name="tier" label="投入档位"><Select options={["S", "A", "B", "C"].map(v => ({ value: v, label: `${v} 级` }))} /></Form.Item><Form.Item name="team" label="制作小组"><Input /></Form.Item><Form.Item name="market" label="市场 / 语言 / 渠道"><Input /></Form.Item><Form.Item name="style" label="视觉形式"><Input /></Form.Item><Form.Item name="initialMinutes" label="首批计划时长（分钟）"><InputNumber min={1} max={300} /></Form.Item><Form.Item name="totalMinutes" label="整体框架时长（分钟）"><InputNumber min={1} max={1000} /></Form.Item><Form.Item name="budgetCny" label="计划预算（人民币）"><InputNumber min={0} max={1000000} /></Form.Item><Form.Item name="deadline" label="目标日期"><Input type="date" /></Form.Item></div><Form.Item name="source" label="来源与权利备注"><Input /></Form.Item><Form.Item name="brief" label="核心冲突 / 为什么值得做"><Input.TextArea rows={3} /></Form.Item><p className={s.muted}>负责人为当前账号。档位、预算、产能都是制作计划，不代表市场表现。</p></Form></Modal>
    <Drawer open={!!project} width={860} onClose={() => setProjectId(undefined)} title={project ? `${project.title} / ${project.tier} 级` : "项目"}>{project && <><div className={s.projectDrawerActions}><span>项目阶段：{project.stage} · {projectTasks.length} 个分集</span><Button type="primary" icon={<ArrowUpRight size={14} />} onClick={() => { onOpenWorkspace?.(project.id); setProjectId(undefined); }}>进入项目画布</Button></div><div className={s.stageStrip}>{STAGES.map((stage, i) => <span key={stage} className={STAGES.indexOf(project.stage) === i ? s.currentStage : ""}>{i + 1}. {stage}</span>)}</div>{project.topicSnapshot && <Alert type="info" showIcon message={`关联选题 #${project.topicSnapshot.id} · ${project.topicSnapshot.title}`} description={`原型：${project.topicSnapshot.original}；核心冲突：${project.topicSnapshot.conflict}；形式：${project.topicSnapshot.form}；市场：${project.topicSnapshot.markets}；判断：${project.topicSnapshot.confidence}；权利：${project.topicSnapshot.sourceRights}${project.topicSnapshot.selectionGroup ? `；选择分组：${project.topicSnapshot.selectionGroup}；选择人：${project.topicSnapshot.selectedBy} <${project.topicSnapshot.selectedByEmail || "账号待绑定"}>；选择时间：${project.topicSnapshot.selectedAt}` : ""}`} />}<p className={s.muted}>{project.brief}</p><Tabs items={[{ key: "direction", label: "方向与故事圣经", children: <Form form={directionForm} layout="vertical" onFinish={v => send({ type: "update", projectId: project.id, changes: v })}><Alert type="info" message={projectTasks.length ? "已有分集任务：创作方向已锁定。如需大幅修改，请另立项目版本。" : "先选定方向，再规划批次；故事圣经请包含人物、世界规则、分集大纲及连续性约束。"} /><Form.Item name="direction" label="确认的创作方向" style={{ marginTop: 18 }}><Input.TextArea rows={4} disabled={!!projectTasks.length} /></Form.Item><Form.Item name="bible" label="故事圣经与分集大纲"><Input.TextArea rows={10} disabled={!!projectTasks.length} /></Form.Item><Button type="primary" htmlType="submit" loading={busy} disabled={!!projectTasks.length}>保存创作依据</Button></Form> }, { key: "scripts", label: `分集剧本 (${projectTasks.length})`, children: <><Alert type="info" showIcon message="批量规划会创建编写任务和提示词，不会自动生成剧本或调用模型。" /><div className={s.batchBar}><span>从第</span><InputNumber aria-label="起始集号" min={1} max={200} value={from} onChange={v => setFrom(v || 1)} /><span>集起，共</span><InputNumber aria-label="批次集数" min={1} max={20} value={count} onChange={v => setCount(v || 1)} /><span>集</span><Button type="primary" loading={busy} onClick={() => send({ type: "plan-scripts", projectId: project.id, from, count })}>规划剧本任务</Button></div><Table rowKey="id" columns={scriptColumns} dataSource={projectTasks} pagination={false} /></> }, { key: "review", label: "推进与交付", children: <><Alert type="warning" showIcon message="人工阶段确认" description="样片、批量制作和验收状态由审核人依据真实产物确认；本版不自动检查媒体质量。" /><div className={s.opsBody}><p>当前阶段：<strong>{project.stage}</strong></p><p>负责人：{project.ownerName} · 计划预算：¥{project.budgetCny.toLocaleString()}</p><p>交付链接：{project.deliveryUrl ? <a href={project.deliveryUrl} target="_blank" rel="noreferrer">查看交付包</a> : "尚未提交"}</p><Button type="primary" disabled={!actor.reviewer || project.stage === "已交付"} onClick={() => { let deliveryUrl = ""; modal.confirm({ title: `确认进入${STAGES[STAGES.indexOf(project.stage) + 1]}？`, content: <><p>请核实本阶段产物已完成。此操作写入审核记录。</p>{project.stage === "验收" && <Input placeholder="成片 / 交付包 HTTPS 链接" onChange={e => { deliveryUrl = e.target.value; }} />}</>, okText: "确认放行", cancelText: "取消", onOk: async () => { if (!await send({ type: "advance", projectId: project.id, deliveryUrl })) throw new Error("未能放行"); } }); }}>审核并进入下一阶段</Button></div></> }]} /></>}</Drawer>
    <Modal open={!!task} title={task ? `${task.title} · 剧本与审核` : "剧本"} width={820} footer={null} onCancel={() => setTask(undefined)}>{task && <><p className={s.muted}>人工录入。保存会提交新版本，已有审核结论不会沿用。</p><Input.TextArea rows={15} value={script} onChange={e => setScript(e.target.value)} placeholder="粘贴完整分集剧本，至少 30 字。" /><div className={s.batchBar}><Button type="primary" loading={busy} onClick={async () => { if (await send({ type: "save-script", taskId: task.id, content: script })) setTask(undefined); }}>保存并提交审核</Button><Button onClick={() => download(`第${task.episode}集-编剧任务.md`, task.prompt)}>导出编剧任务</Button></div>{state.tasks.find(t => t.id === task.id)?.status === "待审核" && actor.reviewer && <><Input.TextArea rows={2} value={reviewNote} onChange={e => setReviewNote(e.target.value)} placeholder="审核意见（退回时必填）" /><div className={s.batchBar}><Button disabled={script !== task.content} onClick={async () => { if (await send({ type: "review-script", taskId: task.id, approve: true, note: reviewNote })) setTask(undefined); }}>通过当前已保存版本</Button><Button danger disabled={script !== task.content} onClick={async () => { if (await send({ type: "review-script", taskId: task.id, approve: false, note: reviewNote })) setTask(undefined); }}>退回修改</Button></div></>}{task.note && <Alert message={`上次审核：${task.note}`} type="info" />}</>}</Modal>
  </div>;
}
