"use client";
import React, { useEffect, useRef, useState } from "react";
import { App, Button, Drawer, Empty, Input, InputNumber, Select, Tag } from "antd";
import type { Project, ScriptTask } from "../../lib/production-lab/domain";
import { scriptComparisonStorageKey } from "../../lib/production-lab/storage-keys";
import s from "./ProductionTools.module.css";

type Model = { id: string; label: string; configured: boolean };
type Run = {
  request_id: string; model_id: string; project_id?: string; task_id?: string;
  episode?: number; status: string; created_at: string; error?: string;
  result?: { text?: string; usage?: { total_tokens?: number } };
  skill_versions: { id: string; version: string }[];
};
type Version = { requestId: string; model: string; episode: number; taskId: string; text: string; status: "idle" | "running" | "done" | "error"; error?: string };
const emptyState = { brief: "", count: 3, selected: [] as string[], episode: 1, chosen: {} as Record<number, string>, versions: [] as Version[], batchSkills: [] as string[] };

export default function ScriptComparison({ demo, actorId, project, projectTasks, skillIds, onSkills, onPrepareBatch, onUse }: {
  demo?: boolean;
  actorId: string;
  project: Project;
  projectTasks: ScriptTask[];
  skillIds: string[];
  onSkills: () => void;
  onPrepareBatch: (projectId: string, from: number, count: number) => Promise<ScriptTask[]>;
  onUse: (title: string, text: string, episode: number, modelId: string, requestId: string, generated: boolean) => Promise<void>;
}) {
  const { message } = App.useApp();
  const storageKey = scriptComparisonStorageKey(actorId, project.id);
  const [models, setModels] = useState<Model[]>([]);
  const [brief, setBrief] = useState("");
  const [count, setCount] = useState(3);
  const [from, setFrom] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [episode, setEpisode] = useState(1);
  const [versions, setVersions] = useState<Version[]>([]);
  const [chosen, setChosen] = useState<Record<number, string>>({});
  const [batchSkills, setBatchSkills] = useState<string[]>([]);
  const [taskIds, setTaskIds] = useState<Record<number, string>>({});
  const [manualDrafts, setManualDrafts] = useState<Record<number, string>>({});
  const [restored, setRestored] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<Run[]>([]);
  const [historyError, setHistoryError] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    let active = true;
    setRestored(false);
    const nextEpisode = projectTasks.length ? Math.max(...projectTasks.map(task => task.episode)) + 1 : 1;
    setBrief(""); setCount(3); setFrom(nextEpisode); setSelected([]); setEpisode(nextEpisode); setVersions([]); setChosen({}); setBatchSkills([]); setTaskIds({}); setManualDrafts({});
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved?.projectId === project.id && Array.isArray(saved.versions)) {
          setBrief(typeof saved.brief === "string" ? saved.brief : "");
          setCount([1, 3, 5, 10].includes(saved.count) ? saved.count : 3);
          setFrom(Number.isInteger(saved.from) ? saved.from : nextEpisode);
          setSelected(Array.isArray(saved.selected) ? saved.selected.slice(0, 2) : []);
          setEpisode(Number.isInteger(saved.episode) ? saved.episode : 1);
          setChosen(saved.chosen && typeof saved.chosen === "object" ? saved.chosen : {});
          setTaskIds(saved.taskIds && typeof saved.taskIds === "object" ? saved.taskIds : {});
          setManualDrafts(saved.manualDrafts && typeof saved.manualDrafts === "object" ? saved.manualDrafts : {});
          setBatchSkills(Array.isArray(saved.batchSkills) ? saved.batchSkills : []);
          setVersions(saved.versions.map((v: Version) => v.status === "running" ? { ...v, status: "error", error: "页面已离开，任务状态未知，请核对服务商记录" } : v));
        }
      }
    } catch { message.error("剧本比较草稿读取失败"); }
    setRestored(true);
    if (!demo) {
      fetch("/api/production-lab/models")
        .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "模型目录读取失败"); return data; })
        .then(data => { if (active) setModels(Array.isArray(data.models) ? data.models : []); })
        .catch(error => { if (active) message.error((error as Error).message); });
    }
    return () => { active = false; };
  }, [storageKey, project.id, demo, message]);

  useEffect(() => {
    if (!restored) return;
    try { localStorage.setItem(storageKey, JSON.stringify({ projectId: project.id, brief, from, count, selected, episode, chosen, versions, batchSkills, taskIds, manualDrafts })); }
    catch { message.error("剧本比较草稿保存失败"); }
  }, [restored, storageKey, project.id, brief, from, count, selected, episode, chosen, versions, batchSkills, taskIds, manualDrafts, message]);

  async function loadHistory() {
    setHistoryOpen(true);
    if (demo) { setHistoryError("本机预览没有真实生成记录"); return; }
    try {
      const response = await fetch(`/api/production-lab/models?view=runs&projectId=${encodeURIComponent(project.id)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "生成记录读取失败");
      setHistory(Array.isArray(data.runs) ? data.runs : []); setHistoryError("");
    } catch (error) { setHistoryError((error as Error).message); }
  }

  async function plan() {
    if (!project.direction.trim() || !project.bible.trim()) { message.error("请先在项目推进中确认创作方向和故事圣经"); return; }
    if (!Number.isInteger(from) || from < 1 || from + count > 201) { message.error("集号范围为 1–200"); return; }
    if (skillIds.length > 2) { message.error("每批最多组合两个编导 Skill"); return; }
    setPreparing(true);
    try {
      const tasks = await onPrepareBatch(project.id, from, count);
      const nextTaskIds = Object.fromEntries(tasks.filter(task => task.episode >= from && task.episode < from + count).map(task => [task.episode, task.id]));
      if (Object.keys(nextTaskIds).length !== count) throw new Error("没有取得完整的分集任务，请刷新项目后重试");
      const nextVersions = selected.flatMap(model => Array.from({ length: count }, (_, i) => ({
        requestId: crypto.randomUUID(), model, episode: from + i, taskId: nextTaskIds[from + i], text: "", status: "idle" as const,
      })));
      setTaskIds(nextTaskIds); setBatchSkills([...skillIds]); setVersions(nextVersions); setChosen({}); setManualDrafts({}); setEpisode(from);
      message.success(`已关联 ${project.title} 的 ${count} 个分集任务`);
    } catch (error) { message.error(error instanceof Error ? error.message : "批次准备失败"); }
    finally { setPreparing(false); }
  }

  async function generate() {
    if (demo || running || !versions.length || versions.some(v => v.status !== "idle")) return;
    setRunning(true);
    try {
      await Promise.allSettled(selected.map(async model => {
        let previous = projectTasks.find(task => task.episode === from - 1 && task.status === "已通过")?.content || "";
        for (let ep = from; ep < from + count; ep++) {
          if (!mounted.current) break;
          const version = versions.find(v => v.model === model && v.episode === ep);
          if (!version?.requestId || !version.taskId) break;
          const update = (patch: Partial<Version>) => setVersions(all => all.map(item => item.model === model && item.episode === ep ? { ...item, ...patch } : item));
          update({ status: "running", error: undefined });
          try {
            const response = await fetch("/api/production-lab/models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
              model, projectId: project.id, taskId: version.taskId, brief, episode: ep, count, previous, skillIds: batchSkills, requestId: version.requestId,
            }) });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "生成失败");
            previous = (previous + `\n第${ep}集\n` + data.text).slice(-24000);
            update({ status: "done", text: data.text });
            if (data.persistenceWarning) message.warning(data.persistenceWarning);
          } catch (error) { update({ status: "error", error: (error as Error).message }); break; }
        }
      }));
    } finally { setRunning(false); }
  }

  async function useVersion(v: Version) {
    if (!v.text.trim() || running || saving === v.episode || chosen[v.episode] === v.model) return;
    setSaving(v.episode);
    try {
      const generated = v.status === "done";
      await onUse(`EP${String(v.episode).padStart(2, "0")} / ${models.find(m => m.id === v.model)?.label || v.model}`, v.text, v.episode, v.model, v.requestId, generated);
      setChosen(current => ({ ...current, [v.episode]: v.model }));
      message.success("已保存为项目剧本版本，并关联到对应分集画布");
    } catch (error) { message.error(error instanceof Error ? error.message : "保存剧本失败"); }
    finally { setSaving(null); }
  }

  async function saveManualDraft() {
    const text = manualDrafts[episode] || "";
    if (text.trim().length < 30) { message.error("请补充完整剧本（至少 30 字）"); return; }
    if (saving !== null || running) return;
    setSaving(episode);
    try {
      await onUse(`EP${String(episode).padStart(2, "0")} / 手工剧本`, text, episode, "manual", "", false);
      setChosen(current => ({ ...current, [episode]: "manual" }));
      message.success("手工剧本已进入项目审核，并生成可编辑的镜头草案");
    } catch (error) { message.error(error instanceof Error ? error.message : "保存手工剧本失败"); }
    finally { setSaving(null); }
  }

  const configuredSelected = selected.length > 0 && selected.every(id => models.find(model => model.id === id)?.configured);
  const hasBatch = Object.keys(taskIds).length > 0;
  const isLocked = preparing || running || saving !== null || hasBatch;
  return <section className={s.page}>
    <div className={s.workflowIntro}>
      <div className={s.workflowCopy}><span className={s.eyebrow}>批量剧本 / 当前项目</span><strong>把已立项故事，变成可比较、可审核的分集剧本。</strong><p>先建立分集任务，再让最多两个文本模型并行写同一批剧本；逐集选定版本后，会回到项目审核并生成可编辑的画布分镜。</p></div>
      <div className={s.workflowSteps}><div><b>01</b><span>选择模型与集数</span></div><i/><div><b>02</b><span>建立分集任务</span></div><i/><div><b>03</b><span>并行生成对照</span></div><i/><div><b>04</b><span>选稿并提交审核</span></div></div>
      <div className={s.workflowFoot}><strong>费用提示</strong><span>建立分集任务不会调用模型；点击“开始模型生成”后才会产生文本模型费用，也可以直接手工写剧本。</span></div>
    </div>
    <div className={s.versionHead}><span className={s.eyebrow}>WRITERS’ ROOM · {project.tier} TIER</span><Button onClick={loadHistory}>本项目生成记录</Button></div>
    <h1>同一个故事，多种写法。</h1>
    <p className={s.muted}>编剧与导演合为编导工作台。模型共享项目的已确认方向和故事圣经；每一集单独比较、审核和回写。</p>
    <div className={s.brief}>
      <div className={s.projectContext}><strong>{project.title}</strong><span>{project.stage} · {project.market} · {project.style}{project.topicId ? ` · 选题 #${project.topicId} ${project.topicSnapshot?.title || ""}` : " · 原创提案"}</span>{project.topicSnapshot && <p><b>选题约束</b>{project.topicSnapshot.conflict} · 权利：{project.topicSnapshot.sourceRights} · {project.topicSnapshot.confidence}</p>}<p><b>已确认方向</b>{project.direction}</p><p><b>故事圣经</b>{project.bible}</p></div>
      <label htmlFor="script-extra-brief">本批补充要求</label>
      <Input.TextArea id="script-extra-brief" rows={3} value={brief} disabled={isLocked} onChange={event => setBrief(event.target.value)} placeholder="只填写本批特殊要求，例如受众、语言、节奏或需要强化的情节；项目背景由系统自动绑定。" />
      <div className={s.controls}>
        <Select className={s.modelSelect} aria-label="参与对比的模型" mode="multiple" maxCount={2} value={selected} disabled={isLocked} onChange={setSelected} options={models.map(model => ({ value: model.id, label: model.label, disabled: !model.configured }))} placeholder={demo ? "本机演示不连接模型" : "选择已配置的文本模型"} />
        <span>从第</span><InputNumber aria-label="批次起始集号" min={1} max={200} value={from} disabled={isLocked} onChange={value => { const next = value || 1; setFrom(next); setEpisode(next); }} />
        <span>集起</span>
        <Select aria-label="批量剧本集数" value={count} disabled={isLocked} onChange={setCount} options={[1, 3, 5, 10].map(n => ({ value: n, label: `${n} 集` }))} />
        <Button onClick={onSkills} disabled={isLocked}>编导 Skill · {versions.length ? batchSkills.length : skillIds.length}</Button>
      </div>
      <div className={s.controls}>
        <Button type="primary" disabled={isLocked || !project.direction || !project.bible} loading={preparing} onClick={() => void plan()}>建立分集任务</Button>
        {hasBatch && <><Button disabled={running || saving !== null} onClick={() => { setVersions([]); setChosen({}); setTaskIds({}); setManualDrafts({}); }}>重新配置</Button>{versions.length > 0 && <Button type="primary" loading={running} disabled={demo || !configuredSelected || versions.some(version => version.status !== "idle" || !version.requestId)} onClick={() => void generate()}>开始模型生成</Button>}</>}
      </div>
      <p className={s.note}>{demo ? "可先建立空白批次并手工写作；本机演示不会调用模型或产生费用。" : "可只建立批次后手工写作，也可选文本模型对照。模型按模型并行、模型内逐集串行运行；生成会产生供应商费用。"}</p>
    </div>
    {hasBatch && <><div className={s.toolbar}><strong>逐集比较与编写</strong><Select aria-label="对比剧集" value={episode} onChange={setEpisode} options={Array.from({ length: count }, (_, i) => ({ value: from + i, label: `第 ${from + i} 集` }))} /><span className={s.muted}>已选用 {Object.keys(chosen).length} / {count} 集 · {taskIds[episode] ? "已关联项目任务" : "任务缺失"}</span></div>
      <div className={s.comparison}>
      <article className={`${s.version} ${chosen[episode] === "manual" ? s.selected : ""}`}>
        <div className={s.versionHead}><h3>手工剧本 / 工作室草稿</h3><Tag>{chosen[episode] === "manual" ? "已关联项目" : "人工编写"}</Tag></div>
        <Input.TextArea aria-label={`手工第${episode}集剧本`} rows={13} disabled={running || saving === episode} placeholder="可直接编写/粘贴本集剧本；建议使用“第N场”和“镜头N”标题，保存后会拆成可编辑的画布分镜。" value={manualDrafts[episode] || ""} onChange={event => setManualDrafts(all => ({ ...all, [episode]: event.target.value }))} />
        <p>{(manualDrafts[episode] || "").length} 字符 · 保存后等待项目审核</p>
        <Button block type={chosen[episode] === "manual" ? "primary" : "default"} loading={saving === episode && chosen[episode] !== "manual"} disabled={(manualDrafts[episode] || "").trim().length < 30 || running || saving !== null || chosen[episode] === "manual"} onClick={() => void saveManualDraft()}>保存手工稿并生成分镜草案</Button>
      </article>
      {versions.filter(v => v.episode === episode).map(v => <article key={v.model} className={`${s.version} ${chosen[episode] === v.model ? s.selected : ""}`}>
        <div className={s.versionHead}><h3>{models.find(model => model.id === v.model)?.label || v.model}</h3><Tag>{v.status === "running" ? "生成中" : v.status === "done" ? "模型返回" : v.status === "error" ? "失败 / 待核对" : "待执行"}</Tag></div>
        {v.error && <p role="alert">{v.error}</p>}
        <Input.TextArea aria-label={`${v.model} 第${episode}集剧本`} rows={13} disabled={running || saving === episode} placeholder="模型结果会显示在这里。你也可以粘贴草稿，人工录入会保留来源标记。" value={v.text} onChange={event => { setVersions(all => all.map(item => item === v ? { ...item, text: event.target.value } : item)); setChosen(current => { const next = { ...current }; delete next[episode]; return next; }); }} />
        <p>{v.text.length} 字符 · {v.status === "done" ? "模型返回，仍需人工审稿" : "手工输入不会标记为模型生成"}</p>
        <Button block type={chosen[episode] === v.model ? "primary" : "default"} loading={saving === episode && chosen[episode] !== v.model} disabled={!v.text.trim() || running || saving !== null || chosen[episode] === v.model} onClick={() => void useVersion(v)}>保存此版到项目与画布</Button>
      </article>)}</div></>}
    <Drawer title={`${project.title} · 剧本生成记录`} open={historyOpen} onClose={() => setHistoryOpen(false)} width={640}>
      <p>仅显示当前项目、当前账号的请求记录。超时或未知状态不会自动重跑。</p><Button onClick={() => void loadHistory()}>刷新记录</Button>
      {historyError ? <p role="alert">{historyError}</p> : !history.length ? <Empty description="当前项目暂无生成记录" /> : history.map(run => <article key={run.request_id} style={{ padding: "18px 0", borderBottom: "1px solid #8884" }}>
        <Tag>{run.model_id}</Tag><Tag>{({ running: "运行中", succeeded: "已完成", failed: "失败", unknown: "结果待核对" } as Record<string, string>)[run.status] || run.status}</Tag><p>{run.episode ? `第 ${run.episode} 集 · ` : ""}{new Date(run.created_at).toLocaleString("zh-CN")}</p><small>请求：{run.request_id}</small><p>Skill：{run.skill_versions?.map(version => version.id + " @ " + version.version.slice(0, 8)).join("、") || "基础模型"}</p>
        {run.error && <p>{run.error}</p>}
        {run.result?.text && <><Input.TextArea readOnly rows={5} value={run.result.text} /><p>服务商报告 Token：{run.result.usage?.total_tokens ?? "未提供"}</p><Button disabled={!run.task_id || !run.episode} onClick={async () => { try { await onUse(`恢复 / ${run.model_id}`, run.result!.text!, run.episode!, run.model_id, run.request_id, true); message.success("已恢复到对应项目分集与画布"); } catch (error) { message.error((error as Error).message); } }}>恢复结果到画布</Button></>}
      </article>)}
    </Drawer>
  </section>;
}
