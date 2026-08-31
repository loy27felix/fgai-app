"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { ArrowLeft, Check, Clapperboard, FileVideo, ImagePlus, LoaderCircle, Sparkles, X } from "lucide-react";

export type CompanyVideoSkillFlowInput = {
  brief: string;
  subject: string;
  visualDirection: string;
  ratio: string;
  duration: number;
  references: File[];
  prompt: string;
};

type Props = {
  skill: { name: string; content: string };
  modelLabel: string;
  canvasReady: boolean;
  onPrepare: (input: CompanyVideoSkillFlowInput) => Promise<string>;
  onStart: (input: CompanyVideoSkillFlowInput) => Promise<void>;
  onClose: () => void;
};

const STEPS = ["创作目标", "主体与镜头", "参考与规格", "确认制作"];
const RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
const DURATIONS = [4, 5, 6, 8, 10, 15];

function fileKind(file: File) {
  if (file.type.startsWith("image/")) return "图片";
  if (file.type.startsWith("video/")) return "视频";
  if (file.type.startsWith("audio/")) return "音频";
  return "文件";
}

function fileSize(file: File) {
  if (file.size < 1_000_000) return `${Math.max(1, Math.round(file.size / 1024))} KB`;
  return `${(file.size / 1_000_000).toFixed(1)} MB`;
}

export function CompanyVideoSkillFlow({ skill, modelLabel, canvasReady, onPrepare, onStart, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [brief, setBrief] = useState("");
  const [subject, setSubject] = useState("");
  const [visualDirection, setVisualDirection] = useState("");
  const [ratio, setRatio] = useState("16:9");
  const [duration, setDuration] = useState(5);
  const [references, setReferences] = useState<File[]>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const uploadRef = useRef<HTMLInputElement>(null);

  const input = (): CompanyVideoSkillFlowInput => ({ brief: brief.trim(), subject: subject.trim(), visualDirection: visualDirection.trim(), ratio, duration, references, prompt: prompt.trim() });

  function addReferences(event: ChangeEvent<HTMLInputElement>) {
    const next = Array.from(event.target.files || []).filter((file) => file.size > 0 && (file.type.startsWith("image/") || file.type.startsWith("video/") || file.type.startsWith("audio/")));
    setReferences((current) => [...current, ...next].slice(0, 8));
    event.target.value = "";
  }

  async function prepare() {
    if (!brief.trim()) {
      setError("先告诉 Agent 这支视频要达成什么目标。");
      setStep(0);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const nextPrompt = await onPrepare(input());
      setPrompt(nextPrompt);
      setStep(3);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "制作计划生成失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (!canvasReady) {
      setError("当前没有可执行的画布，请先打开一个画布项目。");
      return;
    }
    if (!prompt.trim()) {
      setError("请先生成并确认制作提示词。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onStart(input());
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法开始视频制作，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="fg-company-video-flow" aria-label="公司模型 Skill 视频制作">
      <header className="fg-company-video-flow-header">
        <div><span className="fg-company-video-flow-kicker">SKILL PRODUCTION DESK</span><strong><Clapperboard size={16} /> Skill 视频制作</strong></div>
        <button type="button" onClick={onClose} aria-label="关闭 Skill 视频制作"><X size={17} /></button>
      </header>
      <div className="fg-company-video-flow-skill"><Sparkles size={13} /><span>已选 Skill</span><strong title={skill.name}>{skill.name}</strong></div>
      <ol className="fg-company-video-flow-steps" aria-label="制作步骤">{STEPS.map((label, index) => <li className={index === step ? "active" : index < step ? "done" : ""} key={label}><span>{index < step ? <Check size={11} /> : index + 1}</span><em>{label}</em></li>)}</ol>

      <div className="fg-company-video-flow-body">
        {step === 0 ? <div className="fg-company-video-flow-question"><span className="fg-company-video-flow-question-number">01 / 04</span><h3>这支视频要替谁解决什么问题？</h3><p>写清目标、投放场景或想让观众记住的核心。不必写成提示词，Agent 会结合 Skill 来整理。</p><textarea autoFocus value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="例如：为新款玩具制作一支 9:16 的开箱种草短片，突出可互动的功能和儿童真实反应。" /></div> : null}
        {step === 1 ? <div className="fg-company-video-flow-question"><span className="fg-company-video-flow-question-number">02 / 04</span><h3>主角、故事和关键动作是什么？</h3><p>可以描述人物、物体、事件顺序、不可改变的产品功能，或让 Agent 自由发挥。</p><textarea autoFocus value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="例如：小女孩第一次触碰玩具吉他，发现不同区域会发出不同音色；镜头始终以产品结构准确为前提。" /></div> : null}
        {step === 2 ? <div className="fg-company-video-flow-question fg-company-video-flow-specs"><span className="fg-company-video-flow-question-number">03 / 04</span><h3>给它一个可执行的制作规格</h3><label>画面与镜头方向<textarea value={visualDirection} onChange={(event) => setVisualDirection(event.target.value)} placeholder="例如：明亮午后、玩具广告质感、由近及远的跟拍，避免文字、水印和畸形手部。" /></label><div className="fg-company-video-flow-selects"><label>画幅<select value={ratio} onChange={(event) => setRatio(event.target.value)}>{RATIOS.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>时长<select value={duration} onChange={(event) => setDuration(Number(event.target.value))}>{DURATIONS.map((item) => <option key={item} value={item}>{item} 秒</option>)}</select></label></div><div className="fg-company-video-flow-reference-header"><div><strong>参考素材</strong><span>图片、视频或音频，最多 8 个</span></div><input ref={uploadRef} hidden type="file" accept="image/*,video/*,audio/*" multiple onChange={addReferences} /><button type="button" onClick={() => uploadRef.current?.click()}><ImagePlus size={14} /> 上传素材</button></div>{references.length ? <ul className="fg-company-video-flow-files">{references.map((file, index) => <li key={`${file.name}-${index}`}><FileVideo size={13} /><span><strong>{file.name}</strong><small>{fileKind(file)} · {fileSize(file)}</small></span><button type="button" onClick={() => setReferences((current) => current.filter((_, item) => item !== index))} aria-label={`移除 ${file.name}`}><X size={13} /></button></li>)}</ul> : <div className="fg-company-video-flow-drop-hint">可不上传；上传后的素材会先成为当前画布的参考节点，再自动连到视频节点。</div>}</div> : null}
        {step === 3 ? <div className="fg-company-video-flow-question fg-company-video-flow-review"><span className="fg-company-video-flow-question-number">04 / 04</span><h3>确认制作计划</h3><p>公司模型已按 <strong>{skill.name}</strong> 组织提示词。你可以直接修改；点击开始后才会写入画布并发起视频生成。</p><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="正在整理制作提示词…" /><div className="fg-company-video-flow-plan-meta"><span>{modelLabel}</span><span>{ratio} · {duration} 秒</span><span>{references.length} 个参考素材</span></div></div> : null}
      </div>

      {error ? <p className="fg-company-video-flow-error">{error}</p> : null}
      <footer className="fg-company-video-flow-footer">
        {step > 0 && step < 3 ? <button type="button" onClick={() => setStep((current) => current - 1)} disabled={busy}><ArrowLeft size={14} /> 上一步</button> : <span />}
        {step < 2 ? <button type="button" className="primary" onClick={() => { if (!brief.trim() && step === 0) { setError("请先填写创作目标。"); return; } setError(""); setStep((current) => current + 1); }} disabled={busy}>下一步</button> : null}
        {step === 2 ? <button type="button" className="primary" onClick={() => void prepare()} disabled={busy}>{busy ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}生成制作计划</button> : null}
        {step === 3 ? <button type="button" className="primary" onClick={() => void start()} disabled={busy || !canvasReady}>{busy ? <LoaderCircle className="spin" size={14} /> : <Clapperboard size={14} />}开始制作</button> : null}
      </footer>
    </section>
  );
}
