"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Checkbox, Empty, Input, Modal, Select, Spin, Tag, Tooltip } from "antd";
import { AlertTriangle, Check, ClipboardList, Clock3, Coins, ImagePlus, LoaderCircle, Video as VideoIcon, WandSparkles } from "lucide-react";
import type { Project, ScriptTask } from "@/lib/production-lab/domain";
import type { DraftNode } from "@/lib/production-lab/canvas-draft";
import s from "./ProductionMediaQueue.module.css";

type Asset = { id: string; name: string; character: string; category: string; style: string; view: string; scope: "official" | "story"; kind: "image" | "video" | "audio"; bytes: number; url: string };
type ImageModel = { id: string; label: string; experimental: boolean; sizes: string[]; maxReferences: number };
type VideoModel = { id: string; label: string; resolutions: string[]; ratios: string[]; minDuration: number; maxDuration: number; minImageReferences: number; maxImageReferences: number; imageRoles: string[]; supportsAudioGeneration: boolean };
type Job = {
  id: string; kind: "image" | "video"; status: "queued" | "submitting" | "running" | "succeeded" | "failed" | "unknown";
  providerReferenceKind?: "reference_id" | "task_id_fallback";
  model: string; providerRequestId: string | null; request: Record<string, unknown>;
  output: { assetId: string | null; mimeType?: string | null; bytes?: number | null; archivePending?: boolean; providerStatus?: string | null };
  assetUrl: string | null; error: string | null; accountingError: string | null;
  estimateUsd: number | string | null; reportedUsd: number | string | null; settledUsd: number | string | null; costSource: string;
  accountingStatus: string; createdAt: string; completedAt: string | null;
};
type Models = { images: ImageModel[]; videos: VideoModel[]; wetokenConfigured: boolean; videoReferencesReady: boolean };

const statusLabel: Record<Job["status"], string> = { queued: "队列等待", submitting: "提交中", running: "生成中", succeeded: "已完成", failed: "失败", unknown: "待核对" };
const targetOptions = [{ value: "character", label: "角色设定" }, { value: "scene", label: "场景" }, { value: "shot", label: "镜头 / 分镜" }];
function money(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `US$ ${amount.toFixed(4)}` : "待估价";
}
function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间未知" : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function targetKind(category: string, kind: Asset["kind"]): "character" | "scene" | "shot" | "video" | "audio" {
  if (kind === "video" || kind === "audio") return kind;
  if (/场景|环境/.test(category)) return "scene";
  if (/镜头|分镜/.test(category)) return "shot";
  return "character";
}

export default function ProductionMediaQueue({
  open, onClose, demo, project, episode, task, selectedNode, appearance, onUseAsset,
}: {
  open: boolean; onClose: () => void; demo: boolean; project: Project | null; episode: number;
  task?: ScriptTask; selectedNode?: DraftNode; appearance: "light" | "dark";
  onUseAsset: (asset: { id: string; name: string; text: string; kind: Asset["kind"]; category: string; targetKind: "character" | "scene" | "shot" | "video" | "audio" }) => void;
}) {
  const { message, modal } = App.useApp();
  const [tab, setTab] = useState<"image" | "video" | "queue">("image");
  const [models, setModels] = useState<Models | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [modelId, setModelId] = useState("");
  const [videoModelId, setVideoModelId] = useState("doubao-seedance-2-0-fast");
  const [size, setSize] = useState("1K");
  const [target, setTarget] = useState("character");
  const [style, setStyle] = useState("");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(5);
  const [ratio, setRatio] = useState("9:16");
  const [resolution, setResolution] = useState("720p");
  const [generateAudio, setGenerateAudio] = useState(true);
  const [referenceIds, setReferenceIds] = useState<string[]>([]);
  const inFlight = useRef(false);
  const lastSubmission = useRef<{ signature: string; key: string } | null>(null);
  const selectedImageModel = models?.images.find(item => item.id === modelId);
  const selectedVideoModel = models?.videos.find(item => item.id === videoModelId);
  const imageAssets = useMemo(() => assets.filter(asset => asset.kind === "image"), [assets]);
  const videoAllowed = Boolean(project && ["样片制作", "批量制作"].includes(project.stage) && task?.status === "已通过");

  const reload = useCallback(async (showSpinner = false) => {
    if (!open || !project || demo || inFlight.current) return;
    inFlight.current = true;
    if (showSpinner) setLoading(true);
    try {
      const query = new URLSearchParams({ projectId: project.id, episode: String(episode) });
      const [jobResponse, assetResponse] = await Promise.all([
        fetch(`/api/production-lab/media/jobs?${query}`, { cache: "no-store" }),
        fetch(`/api/production-lab/assets?${new URLSearchParams({ projectId: project.id })}`, { cache: "no-store" }),
      ]);
      const [jobBody, assetBody] = await Promise.all([jobResponse.json(), assetResponse.json()]);
      if (!jobResponse.ok) throw new Error(jobBody.error || "读取媒体队列失败");
      if (!assetResponse.ok) throw new Error(assetBody.error || "读取云端素材失败");
      setJobs(Array.isArray(jobBody.jobs) ? jobBody.jobs : []);
      setAssets(Array.isArray(assetBody.assets) ? assetBody.assets : []);
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "媒体服务暂不可用");
    } finally {
      inFlight.current = false;
      if (showSpinner) setLoading(false);
    }
  }, [demo, episode, open, project]);

  useEffect(() => {
    if (!open || demo || !project) return;
    let cancelled = false;
    fetch("/api/production-lab/media/models", { cache: "no-store" })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "读取生成模型失败"); return body as Models; })
      .then(value => { if (!cancelled) setModels(value); })
      .catch(error => { if (!cancelled) setLoadError(error instanceof Error ? error.message : "生成模型暂不可用"); });
    void reload(true);
    return () => { cancelled = true; };
  }, [demo, open, project, reload]);

  useEffect(() => {
    if (!open || demo || !project) return;
    const timer = window.setInterval(() => { void reload(); }, 5000);
    return () => window.clearInterval(timer);
  }, [demo, open, project, reload]);

  useEffect(() => {
    if (!open) return;
    setPrompt(selectedNode?.text?.slice(0, 10000) || task?.content?.slice(0, 10000) || "");
    setTitle(selectedNode?.title || `${project?.title || "故事"} · EP${String(episode).padStart(2, "0")}`);
    setStyle(project?.style || "");
    setTab(selectedNode?.kind === "video" ? "video" : "image");
    if (selectedNode?.kind === "scene") setTarget("scene");
    else if (selectedNode?.kind === "shot") setTarget("shot");
    else setTarget("character");
  }, [episode, open, project?.id, selectedNode?.id, task?.id]);

  useEffect(() => {
    if (!models) return;
    if (!models.images.some(item => item.id === modelId)) setModelId(models.images[0]?.id || "");
    if (!models.videos.some(item => item.id === videoModelId)) setVideoModelId(models.videos.find(item => item.id === "doubao-seedance-2-0-fast")?.id || models.videos[0]?.id || "");
  }, [modelId, models, videoModelId]);

  useEffect(() => {
    if (!selectedImageModel?.sizes.includes(size)) setSize(selectedImageModel?.sizes[0] || "1K");
    if (selectedImageModel) setReferenceIds(current => current.slice(0, Math.min(4, selectedImageModel.maxReferences)));
    if (selectedVideoModel) {
      if (!selectedVideoModel.resolutions.includes(resolution)) setResolution(selectedVideoModel.resolutions[0] || "720p");
      if (!selectedVideoModel.ratios.includes(ratio)) setRatio(selectedVideoModel.ratios.includes("9:16") ? "9:16" : selectedVideoModel.ratios[0] || "16:9");
      setDuration(current => Math.min(selectedVideoModel.maxDuration, Math.max(selectedVideoModel.minDuration, current)));
      setReferenceIds(current => current.slice(0, selectedVideoModel.maxImageReferences));
    }
  }, [ratio, resolution, selectedImageModel, selectedVideoModel, size]);

  const createJob = async () => {
    if (!project || demo || submitting) return;
    const kind = tab === "video" ? "video" : "image";
    const chosenModel = kind === "video" ? selectedVideoModel : selectedImageModel;
    if (!chosenModel) return message.error("请先选择可用模型");
    if (!prompt.trim()) return message.error("先补充生成描述，再提交任务");
    if (kind === "video" && !videoAllowed) return message.error("视频生成前需先通过剧本审核，并将项目推进到样片制作或批量制作");
    if (kind === "video" && selectedVideoModel && (referenceIds.length < selectedVideoModel.minImageReferences || referenceIds.length > selectedVideoModel.maxImageReferences)) return message.error(`当前模型需选 ${selectedVideoModel.minImageReferences}–${selectedVideoModel.maxImageReferences} 张图片参考`);
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = { kind, model: chosenModel.id, prompt: prompt.trim(), referenceAssetIds: referenceIds };
      if (kind === "image") Object.assign(payload, { size, title: title.trim() || "生成图片", targetKind: target, style: style.trim() || "待标注" });
      else Object.assign(payload, { duration, ratio, resolution, generateAudio: generateAudio && Boolean(selectedVideoModel?.supportsAudioGeneration), title: title.trim() || "分集视频", style: style.trim() || "待标注" });
      const estimateResponse = await fetch("/api/production-lab/media/estimate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const estimateBody = await estimateResponse.json();
      if (!estimateResponse.ok) throw new Error(estimateBody.error || "无法估算本次生成费用");
      if (!estimateBody.allowed) throw new Error(estimateBody.budgetMessage || "本月费用预算已达到上限");
      const amount = Number(estimateBody.estimate?.amountUsd);
      if (!Number.isFinite(amount)) throw new Error("当前模型缺少可靠的费用估价，暂不允许提交付费任务");
      const confirmed = await new Promise<boolean>(resolve => {
        let settled = false;
        const finish = (value: boolean) => { if (!settled) { settled = true; resolve(value); } };
        modal.confirm({
          title: "确认提交付费生成",
          content: <div className={s.confirmCopy}><strong>{kind === "image" ? "图片" : "视频"} · {chosenModel.label}</strong><p>估算费用 <b>{money(amount)}</b></p><p>{String(estimateBody.estimate?.note || "估算仅供参考；最终以 WeToken 账单 CSV 中匹配的 Reference ID 为准。")}</p><small>提交后会实际调用 WeToken。任务会关联此项目 / EP{String(episode).padStart(2, "0")}，成片保存到团队云端素材库。</small></div>,
          okText: "确认并加入队列", cancelText: "再检查一下",
          onOk: () => finish(true), onCancel: () => finish(false),
        });
      });
      if (!confirmed) return;
      const signature = JSON.stringify({ ...payload, projectId: project.id, episode, nodeId: selectedNode?.id || null });
      if (lastSubmission.current?.signature !== signature) lastSubmission.current = { signature, key: crypto.randomUUID() };
      const response = await fetch("/api/production-lab/media/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, projectId: project.id, episode, nodeId: selectedNode?.id || null, idempotencyKey: lastSubmission.current.key }) });
      const body = await response.json();
      if (!response.ok) { if (response.status >= 400 && response.status < 500) lastSubmission.current = null; throw new Error(body.error || "任务创建失败"); }
      lastSubmission.current = null;
      setTab("queue");
      message.success(body.replayed ? "已找到这次提交的既有任务" : "任务已加入生产队列");
      await reload(true);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "媒体生成提交失败");
    } finally { setSubmitting(false); }
  };

  const useAsset = (asset: Asset) => {
    onUseAsset({ id: asset.id, name: asset.character || asset.name, kind: asset.kind, category: asset.category, targetKind: targetKind(asset.category, asset.kind), text: `素材：${asset.name}\n分类：${asset.category}\n画风：${asset.style || "待标注"}\n视图：${asset.view || "未标注"}\n云端素材编号：${asset.id}` });
  };

  return <Modal open={open} onCancel={onClose} footer={null} width={980} destroyOnClose={false} className={s.modal} styles={{ body: { padding: 0 } }}>
    <div className={`${s.shell} ${appearance === "light" ? s.light : s.dark}`}>
      <header className={s.header}><div className={s.brand}><span className={s.mark}><WandSparkles size={17} /></span><div><span className={s.eyebrow}>FG STUDIO · MEDIA PIPELINE</span><h2>创作生成队列</h2><p>{project?.title || "未选择项目"} <i /> EP{String(episode).padStart(2, "0")} <i /> 项目推进 / 剧本 / 画布同源</p></div></div><Button type="text" onClick={onClose}>关闭</Button></header>
      <nav className={s.tabs} aria-label="媒体生成类型"><button className={tab === "image" ? s.active : ""} onClick={() => setTab("image")}><ImagePlus size={16} />图片生成</button><button className={tab === "video" ? s.active : ""} onClick={() => setTab("video")}><VideoIcon size={16} />视频生成</button><button className={tab === "queue" ? s.active : ""} onClick={() => setTab("queue")}><ClipboardList size={16} />任务队列 <span>{jobs.filter(job => ["queued", "submitting", "running", "unknown"].includes(job.status)).length}</span></button></nav>
      {demo ? <div className={s.demoNotice}><AlertTriangle size={16} />这是本机预览。真实队列仅在超级管理员试用版并连接服务端后启用。</div> : <>
        {loadError && <div className={s.error}><AlertTriangle size={16} />{loadError}<Button type="link" onClick={() => void reload(true)}>重试</Button></div>}
        {!models ? <div className={s.loading}><Spin /> 正在读取模型与项目素材…</div> : <>
          {tab === "image" && <section className={s.formGrid}>
            <div className={s.intro}><span>01 / STILL IMAGE</span><h3>先做角色、场景与镜头资产</h3><p>选择 WeToken 图片模型，生成结果自动进入本故事的云端素材库，并带着 Reference ID 进入费用核对。</p></div>
            {!models.wetokenConfigured && <div className={s.warning}>服务端尚未配置 WeToken API Key，生成按钮会保持不可用。</div>}
            <label className={s.field}><span>图片模型</span><Select value={modelId || undefined} onChange={setModelId} options={models.images.map(model => ({ value: model.id, label: `${model.label}${model.experimental ? " · 实验" : ""}` }))} placeholder="选择图片模型" /></label>
            <label className={s.field}><span>画面尺寸</span><Select value={size} onChange={setSize} options={(selectedImageModel?.sizes || ["1K"]).map(value => ({ value, label: value }))} /></label>
            <label className={s.field}><span>资产类型</span><Select value={target} onChange={setTarget} options={targetOptions} /></label>
            <label className={s.field}><span>画风</span><Input value={style} onChange={event => setStyle(event.target.value)} maxLength={100} placeholder="如：羊毛毡、2D 动画" /></label>
            <label className={`${s.field} ${s.full}`}><span>资产名称</span><Input value={title} onChange={event => setTitle(event.target.value)} maxLength={160} placeholder="角色 / 场景名称" /></label>
            <label className={`${s.field} ${s.full}`}><span>生成描述</span><Input.TextArea value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={10000} showCount rows={5} placeholder="描述角色、构图、光线、材质和需要保持的连续性……" /></label>
            <label className={`${s.field} ${s.full}`}><span>图片参考 · 最多 {selectedImageModel?.maxReferences || 0} 张</span><Select mode="multiple" value={referenceIds} onChange={setReferenceIds} maxCount={Math.min(4, selectedImageModel?.maxReferences || 0)} options={imageAssets.map(asset => ({ value: asset.id, label: `${asset.character || asset.name} · ${asset.style || asset.category}` }))} placeholder="可选：从官方素材库或当前故事中选择" /></label>
            <div className={`${s.formFoot} ${s.full}`}><small>引用已有角色三视图可保持人物一致。上传与分类请先到“素材库”完成。</small><Button type="primary" icon={<WandSparkles size={15} />} loading={submitting} disabled={!models.wetokenConfigured || !modelId || !prompt.trim()} onClick={() => void createJob()}>估价并提交生图</Button></div>
          </section>}
          {tab === "video" && <section className={s.formGrid}>
            <div className={s.intro}><span>02 / VIDEO GENERATION</span><h3>从分镜走向可追踪的成片任务</h3><p>生成视频需要剧本已审核通过、项目进入样片或批量制作阶段。成片会下载到 NAS 后才标记完成。</p></div>
            {!videoAllowed && <div className={s.warning}>当前项目阶段：{project?.stage || "未选择项目"} · 分集审核：{task?.status || "未建分集"}。推进到“样片制作 / 批量制作”且分集审核通过后才能生成。</div>}
            {!models.wetokenConfigured && <div className={s.warning}>服务端尚未配置 WeToken API Key，生成按钮会保持不可用。</div>}
            {referenceIds.length > 0 && !models.videoReferencesReady && <div className={s.warning}>视频参考图需要公网可读取的 HTTPS 地址，请管理员配置 PROVIDER_MEDIA_URL；清空参考图后仍可提交支持文生视频的模型。</div>}
            <label className={s.field}><span>视频模型</span><Select value={videoModelId || undefined} onChange={setVideoModelId} options={models.videos.map(model => ({ value: model.id, label: model.label }))} placeholder="选择视频模型" /></label>
            <label className={s.field}><span>时长（秒）</span><Input type="number" min={selectedVideoModel?.minDuration || 3} max={selectedVideoModel?.maxDuration || 15} value={duration} onChange={event => setDuration(Number(event.target.value))} /></label>
            <label className={s.field}><span>画幅</span><Select value={ratio} onChange={setRatio} options={(selectedVideoModel?.ratios || ["9:16"]).map(value => ({ value, label: value }))} /></label>
            <label className={s.field}><span>清晰度</span><Select value={resolution} onChange={setResolution} options={(selectedVideoModel?.resolutions || ["720p"]).map(value => ({ value, label: value }))} /></label>
            <label className={`${s.field} ${s.full}`}><span>任务名称</span><Input value={title} onChange={event => setTitle(event.target.value)} maxLength={160} placeholder="镜头名称 / 分集视频" /></label>
            <label className={`${s.field} ${s.full}`}><span>镜头描述</span><Input.TextArea value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={10000} showCount rows={5} placeholder="描述镜头运动、主体动作、景别、环境和连续性约束……" /></label>
            <label className={`${s.field} ${s.full}`}><span>图片参考 · 当前模型需 {selectedVideoModel?.minImageReferences || 0}–{selectedVideoModel?.maxImageReferences || 0} 张</span><Select mode="multiple" value={referenceIds} onChange={setReferenceIds} maxCount={selectedVideoModel?.maxImageReferences || 0} options={imageAssets.map(asset => ({ value: asset.id, label: `${asset.character || asset.name} · ${asset.style || asset.category}` }))} placeholder="选择角色图、关键帧或场景参考" /></label>
            <div className={`${s.formFoot} ${s.full}`}><Checkbox checked={generateAudio} disabled={!selectedVideoModel?.supportsAudioGeneration} onChange={event => setGenerateAudio(event.target.checked)}>同时生成音频{selectedVideoModel?.supportsAudioGeneration ? "" : "（该模型不支持）"}</Checkbox><Button type="primary" icon={<VideoIcon size={15} />} loading={submitting} disabled={!models.wetokenConfigured || !videoAllowed || !videoModelId || !prompt.trim() || !selectedVideoModel || referenceIds.length < selectedVideoModel.minImageReferences || referenceIds.length > selectedVideoModel.maxImageReferences || (referenceIds.length > 0 && !models.videoReferencesReady)} onClick={() => void createJob()}>估价并提交视频</Button></div>
          </section>}
          {tab === "queue" && <section className={s.queuePane}>
            <div className={s.queueTitle}><div><span className={s.eyebrow}>LIVE JOBS · {project?.title}</span><h3>任务 / 资产 / 费用在这里汇合</h3></div><Button icon={<LoaderCircle size={14} className={loading ? s.spin : ""} />} onClick={() => void reload(true)}>刷新队列</Button></div>
            <p className={s.accountingNote}><Coins size={15} /> 估价来自当前模型价格表；账单导入后按 WeToken Reference ID 精确对账，不按时间或金额猜配。</p>
            {jobs.length ? <div className={s.jobs}>{jobs.map(job => {
              const asset = assets.find(item => item.id === job.output.assetId);
              const busy = ["queued", "submitting", "running"].includes(job.status) || job.output.archivePending;
              return <article className={s.job} key={job.id}>
                <div className={s.jobIcon}>{job.kind === "image" ? <ImagePlus size={17} /> : <VideoIcon size={17} />}</div>
                <div className={s.jobMain}><div className={s.jobTop}><strong>{String(job.request.title || (job.kind === "image" ? "生成图片" : "分集视频"))}</strong><Tag color={job.status === "succeeded" ? "success" : job.status === "failed" ? "error" : job.status === "unknown" ? "warning" : "processing"}>{statusLabel[job.status]}</Tag></div><p>{job.model} · EP{String(episode).padStart(2, "0")} · {dateLabel(job.createdAt)}{busy ? <span className={s.progress}><Clock3 size={12} />{job.output.archivePending ? "成片已出，正在归档到云端" : "后台持续跟进"}</span> : null}</p>
                  {job.error && <small className={job.status === "unknown" ? s.warningText : s.errorText}>{job.error}</small>}
                  {job.providerRequestId && <div className={s.reference}>{job.providerReferenceKind === "task_id_fallback" ? "WeToken 任务 ID · 等待 CSV 同号核对" : "Reference ID"} <code>{job.providerRequestId}</code><Tooltip title="复制编号"><button onClick={() => void navigator.clipboard?.writeText(job.providerRequestId || "").then(() => message.success("已复制编号"))}><Check size={12} /></button></Tooltip></div>}
                  <div className={s.costLine}><span>{job.settledUsd != null ? `账单实付 ${money(job.settledUsd)}` : job.reportedUsd != null ? `WeToken 回报 ${money(job.reportedUsd)}` : `估算 ${money(job.estimateUsd)}`}</span><span className={job.accountingStatus.includes("按 WeToken") ? s.settled : ""}>{job.accountingStatus}</span></div>
                  {job.accountingError && <small className={s.warningText}>账本提示：{job.accountingError}</small>}
                  {asset && <div className={s.resultAsset}>{asset.kind === "video" ? <video src={asset.url} controls preload="metadata" /> : <img src={asset.url} alt={asset.name} loading="lazy" />}<div><strong>已归档到故事素材</strong><small>{asset.name} · {asset.style || "风格待标注"}</small><Button size="small" onClick={() => useAsset(asset)}>放入画布</Button></div></div>}
                </div>
              </article>;
            })}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={loading ? "正在读取任务" : "这个项目分集暂时没有媒体任务"} />}
            <div className={s.queueFoot}><span><i className={s.dot} />队列服务由页面轮询唤醒；刷新页面不会重新提交未知任务。</span><Button type="link" onClick={() => { setTab("image"); }}>返回生成</Button></div>
          </section>}
        </>}
      </>}
      <footer className={s.footer}><span><i />第六板块 · 独立试用</span><span>WeToken · NAS 团队云端 · 费用 Reference ID</span></footer>
    </div>
  </Modal>;
}
