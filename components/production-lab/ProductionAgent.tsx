"use client";
import React, { useEffect, useMemo, useState } from "react";
import { App, Button, Select, Tag } from "antd";
import { ArrowUp, ChevronRight, Sparkles, WandSparkles } from "lucide-react";
import type { Project, ScriptTask } from "../../lib/production-lab/domain";
import type { AgentDraft } from "../../lib/production-lab/production-agent";
import type { DraftGraph, DraftOperation, DraftNode } from "../../lib/production-lab/canvas-draft";
import { createDraft, kindLabels } from "../../lib/production-lab/canvas-draft";
import s from "./ProductionAgent.module.css";

type Model = { id: string; label: string; configured: boolean };
type Turn = { role: "user" | "assistant"; content: string; options?: string[]; drafts?: AgentDraft[]; applied?: boolean };

function conversationKey(actorId: string, projectId: string, episode: number) {
  return `fg-lab-production-agent-v1:${actorId}:${projectId}:ep-${episode}`;
}

export default function ProductionAgent({ demo, appearance, actorId, project, episode, task, selectedNode, graph, canvasSync, skillIds, skillLabels, onSkills, onOpenMedia, onApply }: {
  demo?: boolean;
  appearance: "dark" | "light";
  actorId: string;
  project: Project;
  episode: number;
  task?: ScriptTask;
  selectedNode?: DraftNode;
  graph: DraftGraph;
  canvasSync: "loading" | "saved" | "saving" | "local" | "conflict" | "error";
  skillIds: string[];
  skillLabels: string[];
  onSkills: () => void;
  onOpenMedia: () => void;
  onApply: (operations: DraftOperation[]) => boolean | void;
}) {
  const { message } = App.useApp();
  const key = conversationKey(actorId, project.id, episode);
  const [models, setModels] = useState<Model[]>([]);
  const [modelId, setModelId] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const canContinue = !demo && !busy && canvasSync === "saved" && Boolean(modelId);
  const canSend = canContinue && Boolean(input.trim());
  const availableModels = useMemo(() => models.filter(model => model.configured), [models]);

  useEffect(() => {
    setTurns([]);
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved)) setTurns(saved.slice(-20));
      }
    } catch { message.error("制作对话记录读取失败"); }
    if (!demo) {
      fetch("/api/production-lab/models")
        .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "模型目录读取失败"); return data; })
        .then(data => { const ready = Array.isArray(data.models) ? data.models.filter((item: Model) => item.configured) as Model[] : []; setModels(ready); setModelId(current => current || ready[0]?.id || ""); })
        .catch(error => message.error((error as Error).message));
    } else { setModels([]); setModelId(""); }
  }, [key, demo, message]);

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(turns.slice(-20))); }
    catch { message.error("制作对话记录无法保存"); }
  }, [turns, key, message]);

  function toOperations(drafts: AgentDraft[]): DraftOperation[] {
    const anchor = selectedNode;
    const maxY = graph.nodes.reduce((max, node) => Math.max(max, node.y + 360), 120);
    const maxX = graph.nodes.reduce((max, node) => Math.max(max, node.x + 350), 90);
    return drafts.flatMap((draft, index) => {
      if (draft.type === "update-selected") {
        return anchor ? [{ type: "update" as const, id: anchor.id, ...(draft.title !== undefined ? { title: draft.title } : {}), ...(draft.text !== undefined ? { text: draft.text } : {}) }] : [];
      }
      const node = createDraft(draft.kind, draft.title, draft.text, anchor ? anchor.x + 360 : maxX, anchor ? anchor.y + index * 390 : maxY + index * 390, skillIds);
      const operations: DraftOperation[] = [{ type: "add", node }];
      if (draft.connectToSelected && anchor) operations.push({ type: "connect", from: anchor.id, to: node.id });
      return operations;
    });
  }

  async function send(content = input) {
    const value = content.trim();
    if (!value || !canContinue) return;
    const nextTurns: Turn[] = [...turns, { role: "user" as const, content: value }];
    setTurns(nextTurns); setInput(""); setBusy(true);
    try {
      const recent = nextTurns.slice(-15).map(turn => ({ role: turn.role, content: turn.content }));
      const response = await fetch("/api/production-lab/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelId, projectId: project.id, episode, selectedNodeId: selectedNode?.id, skillIds, messages: recent }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "制作 Agent 请求失败");
      setTurns(current => [...current, { role: "assistant" as const, content: data.reply, options: data.options || [], drafts: data.drafts?.length ? data.drafts : undefined }].slice(-20));
    } catch (error) {
      setTurns(current => [...current, { role: "assistant" as const, content: (error as Error).message }].slice(-20));
    } finally { setBusy(false); }
  }

  function apply(turn: Turn, index: number) {
    if (!turn.drafts?.length) return;
    const operations = toOperations(turn.drafts);
    const applied = onApply(operations);
    if (applied !== false) setTurns(current => current.map((item, i) => i === index ? { ...item, applied: true } : item));
  }

  return <section className={`${s.root} ${appearance === "light" ? s.light : ""}`}>
    <header className={s.heading}>
      <span className={s.mark}><Sparkles size={17}/></span>
      <div className={s.headingCopy}><span className={s.eyebrow}>FG STUDIO · STORY COPILOT</span><strong>制作 Agent</strong><small>围绕当前故事，推进下一步创作</small></div>
      <span className={s.headerBadge}>{demo ? "本机预览" : availableModels.length ? `${availableModels.length} 个模型` : "需配置模型"}</span>
    </header>
    <div className={s.context}>
      <div className={s.contextTop}><div className={s.contextTitle}><span>当前制作项目</span><strong>{project.title}</strong></div><span className={s.episode}>EP {String(episode).padStart(2, "0")}</span></div>
      <div className={s.controls}>
        <label className={s.modelField}><span>文本模型</span><Select size="small" aria-label="制作 Agent 文本模型" value={modelId || undefined} onChange={setModelId} options={availableModels.map(model => ({ value: model.id, label: model.label }))} placeholder={demo ? "预览未接入模型" : "选择已配置模型"} disabled={busy || !availableModels.length} /></label>
        <Button className={s.skillButton} size="small" icon={<Sparkles size={13}/>} onClick={onSkills} disabled={busy}>Skills <b>{skillIds.length}</b></Button>
      </div>
      <div className={s.skills}>{skillLabels.length ? skillLabels.map(label => <Tag key={label}>{label}</Tag>) : <small>选择编导、美术或视频制作 Skill</small>}</div>
      <Button className={s.mediaAction} block onClick={onOpenMedia} disabled={demo}>
        <span className={s.mediaActionIcon}><WandSparkles size={16} /></span>
        <span className={s.mediaActionText}><strong>图片 / 视频生成</strong><small>打开 WeToken 队列 · 先看估价，再确认提交</small></span>
        <ChevronRight size={16} />
      </Button>
    </div>
    <div className={s.thread} aria-live="polite">
      {!turns.length && <div className={s.empty}>
        <div className={s.emptyVisual}><span className={s.emptyOrb}><Sparkles size={19}/></span><span className={s.emptyIndex}>01 <i/> SESSION</span></div>
        <span className={s.eyebrow}>START WITH A CREATIVE DIRECTION</span>
        <p>从故事，到每一个镜头。</p>
        <small>{selectedNode ? `当前聚焦：${selectedNode.title}。描述你希望 Agent 如何完善这个节点。` : "基于当前选题与分集，拆解角色、场景和镜头；每一步都先给你确认，再写回画布。"}</small>
        <div className={s.steps}><div><b>01</b><span>说清方向</span></div><i/><div><b>02</b><span>确认方案</span></div><i/><div><b>03</b><span>写入画布</span></div></div>
        <div className={s.promptExamples}><span>你可以先试试</span><small>拆出本集角色与场景</small><small>将剧本转成 6 个镜头</small><small>为选中镜头补全视频提示</small></div>
      </div>}
      {turns.map((turn, index) => <article className={turn.role === "user" ? s.userTurn : s.agentTurn} key={index}>
        <div className={s.role}>{turn.role === "user" ? "你" : "制作 Agent"}</div>
        <p>{turn.content}</p>
        {turn.role === "assistant" && turn.options?.length ? <div className={s.options}>{turn.options.map(option => <button key={option} disabled={!canContinue} onClick={() => void send(option)}>{option}</button>)}</div> : null}
        {turn.drafts?.length ? <div className={s.plan}><div className={s.planHead}><strong>待确认的画布计划</strong><Tag>{turn.drafts.length} 项</Tag></div>{turn.drafts.map((draft, i) => <div className={s.planItem} key={i}><span>{String(i + 1).padStart(2, "0")}</span><div>{draft.type === "add" ? <><strong>新增{kindLabels[draft.kind]} · {draft.title}</strong><small>{draft.text.slice(0, 180) || "空白草稿"}</small></> : <><strong>修改当前选中节点{draft.title ? ` · ${draft.title}` : ""}</strong><small>{draft.text?.slice(0, 180) || "仅更新节点标题"}</small></>}</div></div>)}<Button type="primary" block disabled={turn.applied || canvasSync !== "saved"} onClick={() => apply(turn, index)}>{turn.applied ? "已应用到画布" : "确认并写入画布"}</Button></div> : null}
      </article>)}
      {busy && <div className={s.thinking}><span/>正在读取项目上下文并整理下一步…</div>}
    </div>
    <div className={s.composer}>
      <div className={s.composerHead}><span>制作指令</span><small>ENTER 发送 · SHIFT + ENTER 换行</small></div>
      <textarea value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={demo ? "本机预览未连接文本模型" : selectedNode ? `围绕“${selectedNode.title}”说明想做什么…` : "例如：为这一集先拆角色、场景和 6 个镜头…"} disabled={demo || busy || canvasSync !== "saved" || !modelId} aria-label="发送制作要求"/>
      <div className={s.composerFoot}><small>{demo ? "本机预览 · 模型连接后可开始对话" : canContinue ? "Agent 会先整理方案，确认后才修改画布" : "选择已配置模型后开始对话"}</small><Button type="primary" aria-label="发送给制作 Agent" icon={<ArrowUp size={15}/>} onClick={() => void send()} disabled={!canSend} loading={busy}/></div>
    </div>
    <div className={s.status}>
      <span>{canvasSync === "saved" ? "画布已同步" : canvasSync === "saving" ? "画布保存中" : canvasSync === "conflict" ? "多人编辑冲突" : canvasSync === "error" ? "画布未同步" : canvasSync === "local" ? "本机交互预览" : "读取画布中"}</span>
      <small>{demo ? "预览模式不请求模型或媒体服务" : "Agent 对话先整理文字方案；图片 / 视频到上方队列选择模型并确认费用"}</small>
    </div>
  </section>;
}
