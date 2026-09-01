"use client";

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { ArrowLeft, Check, Clapperboard, FileVideo, ImagePlus, LoaderCircle, ReceiptText, Sparkles, X } from "lucide-react";
import { getVideoModel } from "@/lib/ai/video-models";
import type { MaterialInsertPayload } from "@/reference/infinite-canvas/src/stores/use-material-library-store";

export type CompanyVideoSkill = { name: string; content: string };
export type CompanyVideoPlanShot = { title: string; storyboardPrompt: string; videoPrompt: string; duration: number };
export type CompanyVideoPlan = {
  prompt: string;
  research: { summary: string; searchQueries: string[] };
  script: { title: string; logline: string; beats: string[] };
  visuals: { characters: Array<{ name: string; prompt: string }>; styles: Array<{ name: string; prompt: string }> };
  shots: CompanyVideoPlanShot[];
};
export type CompanyVideoQuote = {
  visualImageCount: number;
  storyboardCount: number;
  segmentCount: number;
  visualCostUsd: number | null;
  storyboardCostUsd: number | null;
  videoCostUsd: number | null;
  totalCostUsd: number | null;
  hasUnpricedItems: boolean;
};
export type CompanyVideoSkillFlowInput = {
  brief: string;
  subject: string;
  visualDirection: string;
  ratio: string;
  duration: number;
  segmentCount: number;
  videoModel: string;
  videoResolution: string;
  storyboardModel: string;
  storyboardResolution: string;
  visualImageCount: number;
  visualModel: string;
  visualResolution: string;
  characterCount: number;
  styleCount: number;
  researchMode: "library" | "online";
  assemble: boolean;
  references: File[];
  materialReferences: MaterialInsertPayload[];
  prompt: string;
  plan: CompanyVideoPlan | null;
  quote: CompanyVideoQuote | null;
};

type ModelOption = { value: string; label: string };
type Props = {
  skills: CompanyVideoSkill[];
  planningModelLabel: string;
  videoModels: ModelOption[];
  storyboardModels: ModelOption[];
  canvasReady: boolean;
  onPrepare: (input: CompanyVideoSkillFlowInput) => Promise<{ plan: CompanyVideoPlan; quote: CompanyVideoQuote }>;
  onStart: (input: CompanyVideoSkillFlowInput) => Promise<void>;
  onClose: () => void;
};

const STEPS = ["创作目标", "镜头与规格", "参考素材", "分镜与报价"];
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

function money(value: number | null) {
  return value === null ? "待核价" : `$${value.toFixed(3)}`;
}

function modelName(value: string) {
  const index = value.indexOf("::");
  return (index >= 0 ? value.slice(index + 2) : value).trim();
}

export function CompanyVideoSkillFlow({ skills, planningModelLabel, videoModels, storyboardModels, canvasReady, onPrepare, onStart, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [brief, setBrief] = useState("");
  const [subject, setSubject] = useState("");
  const [visualDirection, setVisualDirection] = useState("");
  const [ratio, setRatio] = useState("16:9");
  const [duration, setDuration] = useState(5);
  const [segmentCount, setSegmentCount] = useState(1);
  const [videoModel, setVideoModel] = useState(videoModels[0]?.value || "doubao-seedance-2-0");
  const [videoResolution, setVideoResolution] = useState("720p");
  const [storyboardModel, setStoryboardModel] = useState(storyboardModels[0]?.value || "gpt-image-2");
  const [storyboardResolution, setStoryboardResolution] = useState("1024x1024");
  const [references, setReferences] = useState<File[]>([]);
  const [plan, setPlan] = useState<CompanyVideoPlan | null>(null);
  const [quote, setQuote] = useState<CompanyVideoQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const uploadRef = useRef<HTMLInputElement>(null);

  const skillNames = useMemo(() => skills.map((skill) => skill.name), [skills]);
  const videoResolutions = useMemo(() => getVideoModel(modelName(videoModel))?.resolutions || ["480p", "720p", "1080p", "4K"], [videoModel]);
  const input = (): CompanyVideoSkillFlowInput => ({
    brief: brief.trim(), subject: subject.trim(), visualDirection: visualDirection.trim(), ratio, duration, segmentCount,
    videoModel, videoResolution, storyboardModel, storyboardResolution,
    visualImageCount: 0, visualModel: storyboardModel, visualResolution: storyboardResolution, characterCount: 0, styleCount: 0,
    researchMode: "library", assemble: false,
    references, materialReferences: [], prompt: plan?.prompt.trim() || "", plan, quote,
  });

  function addReferences(event: ChangeEvent<HTMLInputElement>) {
    const next = Array.from(event.target.files || []).filter((file) => file.size > 0 && (file.type.startsWith("image/") || file.type.startsWith("video/") || file.type.startsWith("audio/")));
    setReferences((current) => [...current, ...next].slice(0, 8));
    event.target.value = "";
  }

  async function prepare() {
    if (!brief.trim()) { setError("先告诉 Agent 这支视频要达成什么目标。"); setStep(0); return; }
    setBusy(true); setError("");
    try {
      const prepared = await onPrepare(input());
      setPlan(prepared.plan);
      setQuote(prepared.quote);
      setStep(3);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "制作计划生成失败，请稍后重试。");
    } finally { setBusy(false); }
  }

  async function start() {
    if (!canvasReady) { setError("当前没有可执行的画布，请先打开一个画布项目。"); return; }
    if (!plan?.shots.length) { setError("请先生成并查看分镜与报价。"); return; }
    setBusy(true); setError("");
    try { await onStart(input()); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "无法开始视频制作，请稍后重试。"); }
    finally { setBusy(false); }
  }

  function updateShot(index: number, patch: Partial<CompanyVideoPlanShot>) {
    setPlan((current) => current ? { ...current, shots: current.shots.map((shot, shotIndex) => shotIndex === index ? { ...shot, ...patch } : shot) } : current);
  }

  return (
    <section className="fg-company-video-flow" aria-label="公司模型 Skill 视频制作">
      <header className="fg-company-video-flow-header">
        <div><span className="fg-company-video-flow-kicker">DIRECTOR'S PRODUCTION DESK</span><strong><Clapperboard size={16} /> 多 Skill 视频制作</strong></div>
        <button type="button" onClick={onClose} aria-label="关闭 Skill 视频制作"><X size={17} /></button>
      </header>
      <div className="fg-company-video-flow-skill"><Sparkles size={13} /><span>工作方法</span><strong>{skillNames.join(" · ")}</strong><small>{skillNames.length}/4</small></div>
      <ol className="fg-company-video-flow-steps" aria-label="制作步骤">{STEPS.map((label, index) => <li className={index === step ? "active" : index < step ? "done" : ""} key={label}><span>{index < step ? <Check size={11} /> : index + 1}</span><em>{label}</em></li>)}</ol>

      <div className="fg-company-video-flow-body">
        {step === 0 ? <div className="fg-company-video-flow-question"><span className="fg-company-video-flow-question-number">01 / 04</span><h3>这支视频要替谁解决什么问题？</h3><p>写目标、投放场景或想让观众记住的核心。不要先写提示词，Agent 会按已选 Skill 组织创作方案。</p><textarea autoFocus value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="例如：为新款玩具制作一支 9:16 的开箱种草短片，突出可互动的功能和儿童真实反应。" /></div> : null}
        {step === 1 ? <div className="fg-company-video-flow-question fg-company-video-flow-specs"><span className="fg-company-video-flow-question-number">02 / 04</span><h3>定义镜头节奏与制作规格</h3><label>主体、故事和关键动作<textarea value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="例如：小女孩第一次触碰玩具吉他，发现不同区域会发出不同音色；产品结构必须准确。" /></label><label>画面与镜头方向<textarea value={visualDirection} onChange={(event) => setVisualDirection(event.target.value)} placeholder="例如：明亮午后、玩具广告质感、由近及远的跟拍，避免文字、水印和畸形手部。" /></label><div className="fg-company-video-flow-selects"><label>视频模型<select value={videoModel} onChange={(event) => { const nextModel = event.target.value; setVideoModel(nextModel); const nextResolutions = getVideoModel(modelName(nextModel))?.resolutions || videoResolutions; if (!nextResolutions.includes(videoResolution)) setVideoResolution(nextResolutions[0]); }}>{videoModels.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>清晰度<select value={videoResolution} onChange={(event) => setVideoResolution(event.target.value)}>{videoResolutions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>画幅<select value={ratio} onChange={(event) => setRatio(event.target.value)}>{RATIOS.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>每段时长<select value={duration} onChange={(event) => setDuration(Number(event.target.value))}>{DURATIONS.map((item) => <option key={item} value={item}>{item} 秒</option>)}</select></label><label>视频段数<select value={segmentCount} onChange={(event) => setSegmentCount(Number(event.target.value))}>{[1, 2, 3, 4].map((item) => <option key={item} value={item}>{item} 段</option>)}</select></label><label>分镜图模型<select value={storyboardModel} onChange={(event) => setStoryboardModel(event.target.value)}>{storyboardModels.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div><p className="fg-company-video-flow-spec-note">每一段先生成 1 张分镜图，再把该图连到对应视频节点；分段越多，连续性控制越细，也会增加预计费用。</p></div> : null}
        {step === 2 ? <div className="fg-company-video-flow-question fg-company-video-flow-specs"><span className="fg-company-video-flow-question-number">03 / 04</span><h3>给 Agent 一组真实参考</h3><p>图片、视频或音频最多 8 个。它们会作为画布节点接入每个分镜和视频段，而不是被复制成无关副本。</p><div className="fg-company-video-flow-reference-header"><div><strong>参考素材</strong><span>{references.length}/8 个</span></div><input ref={uploadRef} hidden type="file" accept="image/*,video/*,audio/*" multiple onChange={addReferences} /><button type="button" onClick={() => uploadRef.current?.click()}><ImagePlus size={14} /> 上传素材</button></div>{references.length ? <ul className="fg-company-video-flow-files">{references.map((file, index) => <li key={`${file.name}-${index}`}><FileVideo size={13} /><span><strong>{file.name}</strong><small>{fileKind(file)} · {fileSize(file)}</small></span><button type="button" onClick={() => setReferences((current) => current.filter((_, item) => item !== index))} aria-label={`移除 ${file.name}`}><X size={13} /></button></li>)}</ul> : <div className="fg-company-video-flow-drop-hint">可不上传。没有参考图时，Agent 会从文字需求生成每段分镜图。</div>}</div> : null}
        {step === 3 ? <div className="fg-company-video-flow-question fg-company-video-flow-review"><span className="fg-company-video-flow-question-number">04 / 04</span><h3>确认分镜、费用与执行顺序</h3><p>策划模型：{planningModelLabel}。下方每段都可在开始前修改；点击“确认并开始制作”后才会创建节点并发起扣费。</p><textarea value={plan?.prompt || ""} onChange={(event) => setPlan((current) => current ? { ...current, prompt: event.target.value } : current)} placeholder="正在整理总提示词…" />{quote ? <section className="fg-company-video-flow-quote"><div><ReceiptText size={16} /><span>预计总价</span><strong>{money(quote.totalCostUsd)}</strong><small>{quote.hasUnpricedItems ? "含未公布价格的模型；确认前需以实际账单为准。" : "按当前模型公开示例估算，实际以 Wetoken 账单为准。"}</small></div><dl><div><dt>分镜图 × {quote.storyboardCount}</dt><dd>{money(quote.storyboardCostUsd)}</dd></div><div><dt>视频段 × {quote.segmentCount}</dt><dd>{money(quote.videoCostUsd)}</dd></div></dl></section> : null}<div className="fg-company-video-flow-shot-list">{plan?.shots.map((shot, index) => <article key={`${shot.title}-${index}`}><header><span>SHOT {String(index + 1).padStart(2, "0")}</span><strong>{shot.title}</strong><small>{shot.duration} 秒</small></header><label>分镜图<textarea value={shot.storyboardPrompt} onChange={(event) => updateShot(index, { storyboardPrompt: event.target.value })} /></label><label>视频段<textarea value={shot.videoPrompt} onChange={(event) => updateShot(index, { videoPrompt: event.target.value })} /></label></article>)}</div><div className="fg-company-video-flow-assembly"><span>FINAL ASSEMBLY</span><strong>所有视频段完成后，画布将新增“待拼接交付”节点，按镜头顺序汇总。</strong><small>当前系统尚未部署视频渲染/导出服务，因此此节点会明确标记为待导出，不会把多个片段伪装成一条已合成的视频。</small></div></div> : null}
      </div>

      {error ? <p className="fg-company-video-flow-error">{error}</p> : null}
      <footer className="fg-company-video-flow-footer">
        {step > 0 && step < 3 ? <button type="button" onClick={() => setStep((current) => current - 1)} disabled={busy}><ArrowLeft size={14} /> 上一步</button> : <span />}
        {step < 2 ? <button type="button" className="primary" onClick={() => { if (!brief.trim() && step === 0) { setError("请先填写创作目标。"); return; } setError(""); setStep((current) => current + 1); }} disabled={busy}>下一步</button> : null}
        {step === 2 ? <button type="button" className="primary" onClick={() => void prepare()} disabled={busy}>{busy ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}生成分镜与报价</button> : null}
        {step === 3 ? <button type="button" className="primary" onClick={() => void start()} disabled={busy || !canvasReady}>{busy ? <LoaderCircle className="spin" size={14} /> : <Clapperboard size={14} />}确认并开始制作</button> : null}
      </footer>
    </section>
  );
}
