"use client";

import React, { useEffect, useRef, useState } from "react";
import { App, Button, Empty, Input, Modal, Select, Tag } from "antd";
import { AudioLines, Image as ImageIcon, Upload } from "lucide-react";
import s from "./ProductionTools.module.css";

type Asset = { id: string; name: string; character: string; style: string; view: string; category: string; scope: "official" | "story"; kind: "image" | "video" | "audio"; bytes: number; episode?: number | null; createdAt: string; url: string };

export function CanvasAssetPicture({ id, kind = "image" }: { id: string; kind?: "image" | "video" | "audio" }) {
  const url = "/api/production-lab/assets/" + encodeURIComponent(id) + "/content";
  if (kind === "video") return <video src={url} controls preload="metadata" style={{ width: "100%", maxHeight: 180, objectFit: "contain", marginTop: 10 }} />;
  if (kind === "audio") return <audio src={url} controls preload="metadata" style={{ width: "100%", marginTop: 10 }} />;
  return <img src={url} alt="团队云端素材" loading="lazy" style={{ width: "100%", height: 140, objectFit: "contain", marginTop: 10 }} />;
}

function Thumbnail({ asset }: { asset: Asset }) {
  if (asset.kind === "video") return <video src={asset.url} muted preload="metadata" />;
  if (asset.kind === "audio") return <div className={s.assetAudio}><AudioLines size={35} /><span>音频素材</span></div>;
  return <img src={asset.url} alt={`${asset.character} ${asset.style} ${asset.view}`} loading="lazy" />;
}

export default function AssetLibrary({ onUse, projectId, episode, projectName, demo = false }: { onUse: (asset: { id: string; name: string; text: string; kind: Asset["kind"]; category: string }) => void; projectId?: string; episode: number; projectName: string; demo?: boolean }) {
  const { message } = App.useApp();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [scope, setScope] = useState<"official" | "story">("official");
  const [query, setQuery] = useState("");
  const [styleFilter, setStyleFilter] = useState("全部画风");
  const [files, setFiles] = useState<File[]>([]);
  const [character, setCharacter] = useState("");
  const [style, setStyle] = useState("2D");
  const [view, setView] = useState("三视图");
  const [category, setCategory] = useState("角色设定");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function refresh() {
    if (demo) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ scope });
      if (projectId) params.set("projectId", projectId);
      const response = await fetch("/api/production-lab/assets?" + params.toString(), { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "团队素材读取失败");
      setAssets(Array.isArray(body.assets) ? body.assets : []);
    } catch (error) { message.error(error instanceof Error ? error.message : "团队素材读取失败"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, [demo, projectId, scope]);

  const save = async () => {
    if (demo || !character.trim() || !files.length || (scope === "story" && !projectId)) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("scope", scope);
      form.set("projectId", projectId || "");
      form.set("episode", String(episode));
      form.set("character", character.trim());
      form.set("style", style.trim());
      form.set("view", view);
      form.set("category", category);
      files.forEach((file) => form.append("files", file));
      const response = await fetch("/api/production-lab/assets", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "素材上传失败");
      setAssets((current) => [...body.assets, ...current]);
      setFiles([]);
      message.success(`已上传 ${body.assets.length} 个素材到团队云端库`);
    } catch (error) { message.error(error instanceof Error ? error.message : "素材上传失败"); }
    finally { setBusy(false); }
  };

  const visible = assets.filter((asset) => (styleFilter === "全部画风" || asset.style === styleFilter) && `${asset.name} ${asset.character} ${asset.category} ${asset.style} ${asset.view}`.toLowerCase().includes(query.toLowerCase()));
  const styles = ["全部画风", ...Array.from(new Set(["羊毛毡", "2D", "3D", ...assets.map((asset) => asset.style).filter(Boolean)]))];
  const fileTotal = files.reduce((sum, file) => sum + file.size, 0);

  return <section className={s.page}>
    <div className={s.pageHead}><div><span className={s.eyebrow}>TEAM ASSET CLOUD</span><h1>团队素材，随项目沉淀。</h1><p>角色、场景、画风和镜头参考保存在服务器素材库，画布与生成任务可直接复用。</p></div><Button type="primary" icon={<Upload size={15} />} disabled={demo} onClick={() => input.current?.click()}>上传素材</Button></div>
    <input ref={input} type="file" multiple disabled={demo} accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,audio/mpeg,audio/wav" hidden onChange={event => { const chosen = Array.from(event.target.files || []); const total = chosen.reduce((sum, file) => sum + file.size, 0); if (chosen.length > 20 || total > 100 * 1024 * 1024 || chosen.some(file => file.size > 20 * 1024 * 1024)) message.error("每次最多 20 个素材；单个不超过 20 MB，总量不超过 100 MB"); else setFiles(chosen); event.target.value = ""; }} />
    <div className={s.toolbar}><Button type={scope === "official" ? "primary" : "default"} onClick={() => setScope("official")}>官方素材库</Button><Button type={scope === "story" ? "primary" : "default"} disabled={!projectId} onClick={() => setScope("story")}>故事资产</Button><Input aria-label="搜索素材" placeholder="搜索角色、场景、画风……" value={query} onChange={event => setQuery(event.target.value)} /><Select aria-label="画风分类" value={styleFilter} onChange={setStyleFilter} options={styles.map(value => ({ value, label: value }))} /></div>
    <p className={s.note}>{scope === "official" ? "官方素材由试用管理员上传，当前已在团队内共享。后续可继续按品牌、角色和画风细分。" : `当前故事：${projectName} · EP${String(episode).padStart(2, "0")}。仅显示官方素材与本项目故事资产。`}</p>
    {demo ? <div className={s.empty}><ImageIcon size={40} strokeWidth={1} /><h2>预览模式不连接团队素材云</h2><p>登录第六板块试用环境后，素材会写入独立的 NAS 素材目录。</p></div> : visible.length ? <div className={s.assetGrid}>{visible.map(asset => <article className={s.assetCard} key={asset.id}><Thumbnail asset={asset} /><div><Tag>{asset.category}</Tag><Tag>{asset.style || "风格待标注"}</Tag><Tag>{asset.view || asset.kind}</Tag><h3>{asset.character || asset.name}</h3><small>{asset.name}</small><p>{asset.scope === "official" ? "团队官方素材" : `${projectName} · EP${String(asset.episode || 1).padStart(2, "0")}`} · {(asset.bytes / 1024 / 1024).toFixed(1)} MB</p><Button block onClick={() => onUse({ id: asset.id, name: asset.character || asset.name, kind: asset.kind, category: asset.category, text: `素材：${asset.name}\n分类：${asset.category}\n画风：${asset.style || "待标注"}\n视图：${asset.view || "未标注"}\n云端素材编号：${asset.id}` })}>引用到画布</Button></div></article>)}</div> : <div className={s.empty}>{loading ? <p>正在读取团队云端素材……</p> : <><ImageIcon size={40} strokeWidth={1} /><h2>{scope === "official" ? "官方素材库还没有内容" : "这个故事还没有专属资产"}</h2><p>上传贝瓦角色三视图、羊毛毡 / 2D / 3D 版本、场景和道具参考。<br />上传成功后，团队可在画布和媒体生成任务中共同使用。</p><Button onClick={() => input.current?.click()}>上传并分类</Button></>}</div>}
    <Modal title={`整理 ${files.length} 个素材`} open={files.length > 0} onCancel={() => setFiles([])} onOk={save} confirmLoading={busy} okText="上传到团队云端库" okButtonProps={{ disabled: !character.trim() || fileTotal > 100 * 1024 * 1024 }} width={540}>
      <div className={s.form}><p className={s.muted}>{files.map(file => file.name).join("、")} · {(fileTotal / 1024 / 1024).toFixed(1)} MB</p><label>名称 / 角色或场景<Input value={character} onChange={event => setCharacter(event.target.value)} placeholder="贝瓦" /></label><label>资产类别<Select value={category} onChange={setCategory} options={["角色设定", "场景", "道具", "风格参考", "镜头参考", "声音", "其他"].map(value => ({ value, label: value }))} /></label><label>画风<Select showSearch value={style} onChange={setStyle} options={["羊毛毡", "2D", "3D", "水彩", "写实"].map(value => ({ value, label: value }))} /><Input aria-label="自定义画风" value={style} onChange={event => setStyle(event.target.value)} placeholder="可输入自定义画风" /></label><label>视图 / 版本<Select value={view} onChange={setView} options={["三视图", "正面", "侧面", "背面", "表情集", "场景全景", "道具", "视频", "音频"].map(value => ({ value, label: value }))} /></label><label>归属<Select value={scope} onChange={setScope} options={[{ value: "official", label: "官方素材库 · 团队共享" }, { value: "story", label: `故事资产 · ${projectName}` }]} /></label><p className={s.muted}>上传会写入 Mac mini 的 NAS 媒体盘和第六板块独立素材目录。</p></div>
    </Modal>
  </section>;
}
