"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Check, Clapperboard, FileSearch, Film, ImagePlus, LoaderCircle, MessageCircleMore, ReceiptText, Search, Sparkles, UserRound, WandSparkles, X } from "lucide-react";
import { getVideoModel } from "@/lib/ai/video-models";
import { estimateCompanyVideoProduction } from "@/lib/creator/company-video-production";
import { MaterialLibraryPickerModal } from "@/reference/infinite-canvas/src/components/canvas/material-library-picker-modal";
import { uploadCanvasAsset } from "@/reference/infinite-canvas/src/services/api/canvas-assets";
import type { MaterialInsertPayload } from "@/reference/infinite-canvas/src/stores/use-material-library-store";
import type { CompanyVideoPlan, CompanyVideoQuote, CompanyVideoSkill, CompanyVideoSkillFlowInput } from "./company-video-skill-flow";

export type CompanyProductionPhase = "direction" | "research" | "script" | "visuals" | "plan" | "render" | "complete";
export type CompanyProductionDraft = {
  phase: CompanyProductionPhase;
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
  materialReferences?: MaterialInsertPayload[];
  plan: CompanyVideoPlan | null;
  quote: CompanyVideoQuote | null;
};

type ModelOption = { value: string; label: string };
type Stage = Exclude<CompanyProductionPhase, "direction" | "complete">;
type Props = {
  skills: CompanyVideoSkill[];
  planningModelLabel: string;
  videoModels: ModelOption[];
  imageModels: ModelOption[];
  canvasReady: boolean;
  initial?: Partial<CompanyProductionDraft> | null;
  onPrepare: (input: CompanyVideoSkillFlowInput) => Promise<{ plan: CompanyVideoPlan; quote: CompanyVideoQuote }>;
  onConfirmStage?: (stage: Stage, input: CompanyVideoSkillFlowInput) => Promise<void>;
  onStart: (input: CompanyVideoSkillFlowInput) => Promise<void>;
  onDiscuss?: (text: string) => Promise<string>;
  onDraftChange?: (draft: CompanyProductionDraft) => void;
  onClose: () => void;
};

const RATIO_OPTIONS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
const DURATION_OPTIONS = [4, 5, 6, 8, 10, 15];
const IMAGE_RESOLUTION_OPTIONS = ["1024x1024 · 1K", "1536x1024 · 1K 横版", "1024x1536 · 1K 竖版", "2048x2048 · 2K"];
const PHASES: Array<{ id: CompanyProductionPhase; label: string; icon: typeof Search }> = [
  { id: "research", label: "调研", icon: Search },
  { id: "script", label: "脚本", icon: FileSearch },
  { id: "visuals", label: "人设与风格", icon: UserRound },
  { id: "plan", label: "分镜与报价", icon: WandSparkles },
  { id: "render", label: "生成与交付", icon: Film },
];

function price(value: number | null) { return value === null ? "待核价" : `$${value.toFixed(3)}`; }
function modelName(value: string) { const index = value.indexOf("::"); return (index >= 0 ? value.slice(index + 2) : value).trim(); }
function imageResolution(value: string) { return value.split(" · ")[0]; }
function phaseIndex(phase: CompanyProductionPhase) { return PHASES.findIndex((item) => item.id === phase); }

export function CompanyProductionFlow({ skills, planningModelLabel, videoModels, imageModels, canvasReady, initial, onPrepare, onConfirmStage, onStart, onDiscuss, onDraftChange, onClose }: Props) {
  const [phase, setPhase] = useState<CompanyProductionPhase>(initial?.phase || "direction");
  const [brief, setBrief] = useState(initial?.brief || "");
  const [subject, setSubject] = useState(initial?.subject || "");
  const [visualDirection, setVisualDirection] = useState(initial?.visualDirection || "");
  const [ratio, setRatio] = useState(initial?.ratio || "16:9");
  const [duration, setDuration] = useState(initial?.duration || 5);
  const [segmentCount, setSegmentCount] = useState(initial?.segmentCount || 1);
  const [videoModel, setVideoModel] = useState(initial?.videoModel || videoModels[0]?.value || "doubao-seedance-2-0");
  const [videoResolution, setVideoResolution] = useState(initial?.videoResolution || "720p");
  const [storyboardModel, setStoryboardModel] = useState(initial?.storyboardModel || imageModels[0]?.value || "gpt-image-2");
  const [storyboardResolution, setStoryboardResolution] = useState(initial?.storyboardResolution || "1024x1024");
  const [visualModel, setVisualModel] = useState(initial?.visualModel || imageModels[0]?.value || "gpt-image-2");
  const [visualResolution, setVisualResolution] = useState(initial?.visualResolution || "1024x1024");
  const [characterCount, setCharacterCount] = useState(initial?.characterCount ?? 1);
  const [styleCount, setStyleCount] = useState(initial?.styleCount ?? 1);
  const [researchMode, setResearchMode] = useState<"library" | "online">(initial?.researchMode || "library");
  const [assemble, setAssemble] = useState(initial?.assemble ?? false);
  const [materialReferences, setMaterialReferences] = useState<MaterialInsertPayload[]>(initial?.materialReferences || []);
  const [materialPickerOpen, setMaterialPickerOpen] = useState(false);
  const [uploadingReferences, setUploadingReferences] = useState(false);
  const [plan, setPlan] = useState<CompanyVideoPlan | null>(initial?.plan || null);
  const [quote, setQuote] = useState<CompanyVideoQuote | null>(initial?.quote || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [discussion, setDiscussion] = useState("");
  const [discussionReply, setDiscussionReply] = useState("");
  const uploadRef = useRef<HTMLInputElement>(null);

  const visualImageCount = Math.min(12, Math.max(0, characterCount + styleCount));
  const videoResolutions = useMemo(() => getVideoModel(modelName(videoModel))?.resolutions || ["480p", "720p", "1080p", "4K"], [videoModel]);
  const skillNames = skills.map((skill) => skill.name);
  const liveQuote = useMemo(() => plan ? estimateCompanyVideoProduction({
    videoModel, videoResolution, secondsPerSegment: duration, segmentCount,
    storyboardModel, storyboardResolution, visualImageCount, visualModel, visualResolution,
  }) : quote, [duration, plan, quote, segmentCount, storyboardModel, storyboardResolution, videoModel, videoResolution, visualImageCount, visualModel, visualResolution]);
  const draft = (): CompanyProductionDraft => ({
    phase, brief: brief.trim(), subject: subject.trim(), visualDirection: visualDirection.trim(), ratio, duration, segmentCount,
    videoModel, videoResolution, storyboardModel, storyboardResolution, visualImageCount, visualModel, visualResolution,
    characterCount, styleCount, researchMode, assemble, materialReferences, plan, quote: liveQuote,
  });
  const input = (): CompanyVideoSkillFlowInput => ({
    brief: brief.trim(), subject: subject.trim(), visualDirection: visualDirection.trim(), ratio, duration, segmentCount,
    videoModel, videoResolution, storyboardModel, storyboardResolution, visualImageCount, visualModel, visualResolution,
    characterCount, styleCount, researchMode, assemble, references: [], materialReferences, prompt: plan?.prompt.trim() || "", plan, quote: liveQuote,
  });

  useEffect(() => { onDraftChange?.(draft()); }, [phase, brief, subject, visualDirection, ratio, duration, segmentCount, videoModel, videoResolution, storyboardModel, storyboardResolution, visualImageCount, visualModel, visualResolution, characterCount, styleCount, researchMode, assemble, materialReferences, plan, liveQuote]);

  async function addReferences(event: ChangeEvent<HTMLInputElement>) {
    const remaining = Math.max(0, 8 - materialReferences.length);
    const files = Array.from(event.target.files || []).filter((file) => file.size > 0 && /^(image|video|audio)\//.test(file.type)).slice(0, remaining);
    event.target.value = "";
    if (!files.length) return;
    setUploadingReferences(true); setError("");
    try {
      const uploaded = await Promise.all(files.map(async (file): Promise<MaterialInsertPayload> => {
        const kind = file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : "image";
        const stored = await uploadCanvasAsset(file, { kind, source: "upload", name: file.name });
        const base = { title: file.name || "上传参考素材", cloudStoragePath: stored.storagePath, cloudAssetId: stored.assetId, origin: "upload" as const };
        if (kind === "image") return { kind, dataUrl: stored.contentUrl, ...base };
        if (kind === "video") return { kind, url: stored.contentUrl, ...base };
        return { kind, url: stored.contentUrl, mimeType: file.type || "application/octet-stream", ...base };
      }));
      setMaterialReferences((current) => [...current, ...uploaded].filter((item, index, all) => !item.cloudAssetId || all.findIndex((candidate) => candidate.cloudAssetId === item.cloudAssetId) === index).slice(0, 8));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "上传参考素材失败，请稍后重试。");
    } finally {
      setUploadingReferences(false);
    }
  }

  function addMaterialReference(item: MaterialInsertPayload) {
    setMaterialReferences((current) => current.some((reference) => reference.cloudAssetId && reference.cloudAssetId === item.cloudAssetId) ? current : [...current, item].slice(0, 8));
    setMaterialPickerOpen(false);
  }

  function changeDuration(nextDuration: number) {
    setDuration(nextDuration);
    setPlan((current) => current ? { ...current, shots: current.shots.map((shot) => ({ ...shot, duration: nextDuration })) } : current);
  }

  function changeSegmentCount(nextCount: number) {
    setSegmentCount(nextCount);
    setPlan((current) => {
      if (!current) return current;
      const source = current.shots.at(-1);
      const shots = Array.from({ length: nextCount }, (_, index) => current.shots[index] || {
        title: `镜头 ${index + 1}`,
        storyboardPrompt: `${source?.storyboardPrompt || current.prompt}\n\n新增第 ${index + 1} 段的连续分镜。`,
        videoPrompt: `${source?.videoPrompt || current.prompt}\n\n新增第 ${index + 1} 段的视频镜头，承接前一段连续性。`,
        duration,
      }).map((shot) => ({ ...shot, duration }));
      return { ...current, shots };
    });
  }

  async function prepare() {
    if (!brief.trim()) { setError("先写下创作目标，Agent 才能给出调研与制片提案。"); return; }
    if (!skills.length) { setError("请先选择至少一个 Skill，再开始制片。 "); return; }
    setBusy(true); setError("");
    try {
      const output = await onPrepare(input());
      setPlan(output.plan); setQuote(output.quote); setPhase("research");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "制片提案生成失败，请稍后重试。"); }
    finally { setBusy(false); }
  }

  async function confirm(stage: Stage, next: CompanyProductionPhase) {
    if (!plan) { setError("请先生成制片提案。"); return; }
    setBusy(true); setError("");
    try { await onConfirmStage?.(stage, input()); setPhase(next); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "保存确认失败，请稍后重试。"); }
    finally { setBusy(false); }
  }

  async function start() {
    if (!canvasReady) { setError("请先打开一个画布项目，再开始生成。"); return; }
    if (!plan?.shots.length || !liveQuote) { setError("请先确认完整分镜与报价。"); return; }
    setBusy(true); setError("");
    try { await onStart(input()); setPhase("render"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "无法开始制作，请稍后重试。"); }
    finally { setBusy(false); }
  }

  async function discuss() {
    const text = discussion.trim();
    if (!text || !onDiscuss) return;
    setBusy(true); setError("");
    try { setDiscussionReply(await onDiscuss(text)); setDiscussion(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "制片 Agent 暂时无法回复。"); }
    finally { setBusy(false); }
  }

  return <section className="fg-production-flow" aria-label="FG 制片 Agent">
    <header className="fg-production-flow-header">
      <div><span>FG STUDIO · PRODUCTION RUN</span><strong><Clapperboard size={17} /> 制片 Agent</strong><small>{skillNames.length ? `Skill · ${skillNames.join(" + ")} · 提案模型 ${planningModelLabel}` : `先选择 Skill，定义制作方法 · 提案模型 ${planningModelLabel}`}</small></div>
      <button type="button" onClick={onClose} aria-label="返回普通 Agent"><X size={17} /></button>
    </header>
    <div className="fg-production-flow-rail" aria-label="制片阶段">
      {PHASES.map(({ id, label, icon: Icon }) => { const current = phaseIndex(phase); const index = phaseIndex(id); return <div className={phase === id ? "active" : current > index || phase === "complete" ? "done" : ""} key={id}><span>{current > index || phase === "complete" ? <Check size={12} /> : <Icon size={13} />}</span><em>{label}</em></div>; })}
    </div>

    <div className="fg-production-flow-body">
      {phase === "direction" ? <section className="fg-production-card intro"><span>01 · 对话确认方向</span><h3>这次想做成什么片子？</h3><p>先确定受众、目标、故事与调性。确认后，Agent 才会提调研、脚本、人设、分镜和模型方案。</p><textarea autoFocus value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="例如：为新款互动玩具做 15 秒竖版种草视频，强调孩子第一次发现琴颈和按键会发声的惊喜。" /><label>主体、故事和关键动作<textarea value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="谁在什么场景里做什么，必须保持什么结构或人物连续性？" /></label><label>画面与镜头方向<textarea value={visualDirection} onChange={(event) => setVisualDirection(event.target.value)} placeholder="风格、光线、景别、运镜、禁止出现的元素。" /></label><button type="button" className="primary" disabled={busy} onClick={() => void prepare()}>{busy ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}生成制片提案</button></section> : null}

      {phase === "research" && plan ? <section className="fg-production-card"><span>02 · 调研提案确认</span><h3>参考不是装饰，是后续每个节点的上游依据。</h3><p>{plan.research.summary}</p><div className="fg-production-query-list">{plan.research.searchQueries.map((query, index) => <code key={`${query}-${index}`}>{query}</code>)}</div><div className="fg-production-choice"><button type="button" className={researchMode === "library" ? "active" : ""} onClick={() => setResearchMode("library")}>素材库 / 上传内容</button><button type="button" className={researchMode === "online" ? "active" : ""} onClick={() => setResearchMode("online")}>Agent 联网检索</button></div><p className="fg-production-help">素材库引用与上传参考都会立即私有存储并写入制片项目；当前未配置联网图片源时，“联网检索”只会保留检索方向，配置合规来源后才会拉取外部图片。</p><div className="fg-production-upload"><input ref={uploadRef} hidden type="file" accept="image/*,video/*,audio/*" multiple onChange={(event) => void addReferences(event)} /><button type="button" disabled={uploadingReferences || materialReferences.length >= 8} onClick={() => uploadRef.current?.click()}><ImagePlus size={14} />{uploadingReferences ? "正在存储…" : "上传参考素材"}</button><button type="button" disabled={uploadingReferences || materialReferences.length >= 8} onClick={() => setMaterialPickerOpen(true)}>从素材库选择</button><small>{materialReferences.length}/8</small></div>{materialReferences.length ? <ul className="fg-production-files">{materialReferences.map((item, index) => <li key={`${item.cloudAssetId || item.title}-${index}`}><span>{item.origin === "upload" ? "上传" : item.kind === "video" ? "素材库视频" : item.kind === "audio" ? "素材库音频" : "素材库图片"}</span><strong>{item.title}</strong><button type="button" onClick={() => setMaterialReferences((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={12} /></button></li>)}</ul> : null}<button type="button" className="primary" disabled={busy || uploadingReferences} onClick={() => void confirm("research", "script")}>确认调研提案</button></section> : null}

      {phase === "script" && plan ? <section className="fg-production-card"><span>03 · 脚本 / 镜头确认</span><label>片名<input value={plan.script.title} onChange={(event) => setPlan((current) => current ? { ...current, script: { ...current.script, title: event.target.value } } : current)} /></label><label>一句话故事<textarea value={plan.script.logline} onChange={(event) => setPlan((current) => current ? { ...current, script: { ...current.script, logline: event.target.value } } : current)} /></label><div className="fg-production-beats">{plan.script.beats.map((beat, index) => <label key={index}>节拍 {index + 1}<textarea value={beat} onChange={(event) => setPlan((current) => current ? { ...current, script: { ...current.script, beats: current.script.beats.map((value, item) => item === index ? event.target.value : value) } } : current)} /></label>)}</div><button type="button" className="primary" disabled={busy} onClick={() => void confirm("script", "visuals")}>确认脚本与镜头</button></section> : null}

      {phase === "visuals" && plan ? <section className="fg-production-card"><span>04 · 人设与风格确认</span><h3>先锁定角色和视觉语法，再让镜头连续。</h3><div className="fg-production-grid">{plan.visuals.characters.slice(0, Math.max(1, characterCount)).map((item, index) => <article key={`character-${index}`}><strong>角色 · {item.name}</strong><textarea value={item.prompt} onChange={(event) => setPlan((current) => current ? { ...current, visuals: { ...current.visuals, characters: current.visuals.characters.map((value, itemIndex) => itemIndex === index ? { ...value, prompt: event.target.value } : value) } } : current)} /></article>)}{plan.visuals.styles.slice(0, Math.max(1, styleCount)).map((item, index) => <article key={`style-${index}`}><strong>风格 · {item.name}</strong><textarea value={item.prompt} onChange={(event) => setPlan((current) => current ? { ...current, visuals: { ...current.visuals, styles: current.visuals.styles.map((value, itemIndex) => itemIndex === index ? { ...value, prompt: event.target.value } : value) } } : current)} /></article>)}</div><div className="fg-production-selects"><label>角色图数量<select value={characterCount} onChange={(event) => setCharacterCount(Number(event.target.value))}>{[0, 1, 2, 3, 4].map((value) => <option value={value} key={value}>{value} 张</option>)}</select></label><label>风格图数量<select value={styleCount} onChange={(event) => setStyleCount(Number(event.target.value))}>{[0, 1, 2, 3, 4].map((value) => <option value={value} key={value}>{value} 张</option>)}</select></label><label>视觉图模型<select value={visualModel} onChange={(event) => setVisualModel(event.target.value)}>{imageModels.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label><label>视觉图清晰度<select value={visualResolution} onChange={(event) => setVisualResolution(imageResolution(event.target.value))}>{IMAGE_RESOLUTION_OPTIONS.map((item) => <option value={item} key={item}>{item}</option>)}</select></label></div><button type="button" className="primary" disabled={busy} onClick={() => void confirm("visuals", "plan")}>确认人设与风格</button></section> : null}

      {phase === "plan" && plan ? <section className="fg-production-card"><span>05 · 分镜、模型与报价确认</span><div className="fg-production-selects"><label>视频模型<select value={videoModel} onChange={(event) => { const next = event.target.value; setVideoModel(next); const options = getVideoModel(modelName(next))?.resolutions || videoResolutions; if (!options.includes(videoResolution)) setVideoResolution(options[0]); }}>{videoModels.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label><label>视频清晰度<select value={videoResolution} onChange={(event) => setVideoResolution(event.target.value)}>{videoResolutions.map((item) => <option value={item} key={item}>{item}</option>)}</select></label><label>画幅<select value={ratio} onChange={(event) => setRatio(event.target.value)}>{RATIO_OPTIONS.map((item) => <option value={item} key={item}>{item}</option>)}</select></label><label>每段时长<select value={duration} onChange={(event) => changeDuration(Number(event.target.value))}>{DURATION_OPTIONS.map((item) => <option value={item} key={item}>{item} 秒</option>)}</select></label><label>视频段数<select value={segmentCount} onChange={(event) => changeSegmentCount(Number(event.target.value))}>{[1, 2, 3, 4].map((item) => <option value={item} key={item}>{item} 段</option>)}</select></label><label>分镜图模型<select value={storyboardModel} onChange={(event) => setStoryboardModel(event.target.value)}>{imageModels.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label><label>分镜图清晰度<select value={storyboardResolution} onChange={(event) => setStoryboardResolution(imageResolution(event.target.value))}>{IMAGE_RESOLUTION_OPTIONS.map((item) => <option value={item} key={item}>{item}</option>)}</select></label></div><div className="fg-production-shot-list">{plan.shots.map((shot, index) => <article key={`${shot.title}-${index}`}><header><span>SHOT {String(index + 1).padStart(2, "0")}</span><strong>{shot.title}</strong><small>{duration} 秒</small></header><label>分镜图<textarea value={shot.storyboardPrompt} onChange={(event) => setPlan((current) => current ? { ...current, shots: current.shots.map((value, item) => item === index ? { ...value, storyboardPrompt: event.target.value, duration } : value) } : current)} /></label><label>视频段<textarea value={shot.videoPrompt} onChange={(event) => setPlan((current) => current ? { ...current, shots: current.shots.map((value, item) => item === index ? { ...value, videoPrompt: event.target.value, duration } : value) } : current)} /></label></article>)}</div><label className="fg-production-assembly-choice"><input type="checkbox" checked={assemble} onChange={(event) => setAssemble(event.target.checked)} /><span><strong>所有镜头完成后拼接为完整视频</strong><small>确认后进入服务端 FFmpeg 拼接队列；不勾选则保留逐段视频与导出顺序。</small></span></label>{liveQuote ? <section className="fg-production-quote"><div><ReceiptText size={16} /><span>预计总价</span><strong>{price(liveQuote.totalCostUsd)}</strong><small>{liveQuote.hasUnpricedItems ? "含待核价模型，实际以账单为准。" : "每次调整模型、清晰度、时长或数量都会立即重算；确认后才会创建节点和开始扣费。"}</small></div><dl><div><dt>人设/风格图 × {liveQuote.visualImageCount}</dt><dd>{price(liveQuote.visualCostUsd)}</dd></div><div><dt>分镜图 × {liveQuote.storyboardCount}</dt><dd>{price(liveQuote.storyboardCostUsd)}</dd></div><div><dt>视频段 × {liveQuote.segmentCount}</dt><dd>{price(liveQuote.videoCostUsd)}</dd></div></dl></section> : null}<button type="button" className="primary" disabled={busy} onClick={() => void confirm("plan", "render")}>确认分镜、模型与报价</button></section> : null}

      {phase === "render" ? <section className="fg-production-card"><span>06 · 开始生成与交付</span><h3>画布会按已确认的阶段持续写入节点。</h3><p>已确认的内容会留下可恢复的制片项目；每段视频仍会按顺序生成，避免把新视频误当成参考视频。</p><button type="button" className="primary" disabled={busy || !canvasReady} onClick={() => void start()}>{busy ? <LoaderCircle className="spin" size={15} /> : <Clapperboard size={15} />}确认并开始制作</button><div className="fg-production-discuss"><label><MessageCircleMore size={14} />继续与制片 Agent 沟通修改<textarea value={discussion} onChange={(event) => setDiscussion(event.target.value)} placeholder="例如：第 2 段改成更近的低机位，但保留人物与服装连续性。" /></label><button type="button" disabled={busy || !discussion.trim() || !onDiscuss} onClick={() => void discuss()}>发送修改意见</button>{discussionReply ? <p>{discussionReply}</p> : null}</div></section> : null}
    </div>
    {error ? <p className="fg-production-error">{error}</p> : null}
    <MaterialLibraryPickerModal open={materialPickerOpen} title="选择制片调研参考素材" onInsert={addMaterialReference} onClose={() => setMaterialPickerOpen(false)} />
  </section>;
}
