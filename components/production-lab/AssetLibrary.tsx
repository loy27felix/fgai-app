"use client";
import React, { useEffect, useRef, useState } from "react";
import { App, Button, Empty, Input, Modal, Select, Tag } from "antd";
import { Upload, Image as ImageIcon } from "lucide-react";
import localforage from "localforage";
import s from "./ProductionTools.module.css";
type Asset = { id: string; name: string; character: string; style: string; view: string; scope: "official" | "story"; file: Blob; created: string };
const db = localforage.createInstance({ name: "fg-production-lab", storeName: "asset_drafts" });
export function CanvasAssetPicture({id,storageKey}:{id:string;storageKey:string}) {
  const [url,setUrl]=useState("");
  useEffect(()=>{let disposed=false,value="";db.getItem<Asset[]>(storageKey).then(items=>{const file=items?.find(a=>a.id===id)?.file;if(!disposed&&file){value=URL.createObjectURL(file);setUrl(value);}}).catch(()=>{});return()=>{disposed=true;if(value)URL.revokeObjectURL(value);};},[id,storageKey]);
  return url?<img src={url} alt="引用的本机素材" style={{width:"100%",height:140,objectFit:"contain",marginTop:10}}/>:<p>素材不在当前浏览器中，请重新关联。</p>;
}
function Thumbnail({ asset }: { asset: Asset }) {
  const [url,setUrl] = useState("");
  useEffect(() => { const value = URL.createObjectURL(asset.file); setUrl(value); return () => URL.revokeObjectURL(value); },[asset.file]);
  return <img src={url} alt={`${asset.character} ${asset.style} ${asset.view}`}/>;
}
export default function AssetLibrary({ onUse, storageKey, projectName }: { onUse: (asset: { id:string; name:string; text:string }) => void; storageKey:string; projectName:string }) {
  const {message} = App.useApp();
  const [assets,setAssets] = useState<Asset[]>([]), [scope,setScope] = useState<"official"|"story">("official");
  const [query,setQuery] = useState(""),[styleFilter,setStyleFilter] = useState("全部画风");
  const [files,setFiles] = useState<File[]>([]), [character,setCharacter] = useState(""),[style,setStyle] = useState("2D"),[view,setView] = useState("三视图");
  const [busy,setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { db.getItem<Asset[]>(storageKey).then(v => setAssets(v || [])).catch(() => message.error("本机素材读取失败")); },[storageKey]);
  const save = async () => {
    if (!character.trim() || !style.trim() || !files.length) return;
    setBusy(true);
    try { const next = [...files.map(file => ({ id:crypto.randomUUID(), name:file.name,character:character.trim(),style:style.trim(),view,scope,file,created:new Date().toISOString() })),...assets]; await db.setItem(storageKey,next); setAssets(next); setFiles([]); message.success("已保存到本机素材草稿，尚未发布给团队"); } catch { message.error("存储失败，请检查浏览器空间"); } finally { setBusy(false); }
  };
  const visible = assets.filter(a => a.scope===scope && (styleFilter==="全部画风" || a.style===styleFilter) && `${a.name} ${a.character} ${a.style} ${a.view}`.toLowerCase().includes(query.toLowerCase()));
  return <section className={s.page}><div className={s.pageHead}><div><span className={s.eyebrow}>ASSET LIBRARY</span><h1>每个角色，都有据可依。</h1><p>按角色、画风和视图整理素材，创作时直接引用。</p></div><Button type="primary" icon={<Upload size={15}/>} onClick={() => input.current?.click()}>上传素材</Button></div>
    <input ref={input} type="file" multiple accept="image/png,image/jpeg,image/webp" hidden onChange={e => { const chosen=Array.from(e.target.files || []); if(chosen.some(f => !["image/png","image/jpeg","image/webp"].includes(f.type) || f.size>20*1024*1024) || chosen.length>20) message.error("每次最多 20 张 PNG/JPEG/WebP，每张不超过 20 MB"); else setFiles(chosen); e.target.value=""; }}/>
    <div className={s.toolbar}><Button type={scope==="official"?"primary":"default"} onClick={() => setScope("official")}>官方素材</Button><Button type={scope==="story"?"primary":"default"} onClick={() => setScope("story")}>故事资产</Button><Input aria-label="搜索素材" placeholder="搜索贝瓦、三视图、场景……" value={query} onChange={e => setQuery(e.target.value)}/><Select aria-label="画风分类" value={styleFilter} onChange={setStyleFilter} options={["全部画风",...Array.from(new Set(["羊毛毡","2D","3D",...assets.map(a=>a.style)]))].map(value=>({value,label:value}))}/></div>
    <p className={s.note}>{scope==="official"?"官方库目前只有本机待发布草稿；正式版由管理员审核、发布并锁定版本。":`当前故事：${projectName}。素材按当前用户和项目保存在本机，团队共享尚未接入。`}</p>
    {visible.length ? <div className={s.assetGrid}>{visible.map(a=><article className={s.assetCard} key={a.id}><Thumbnail asset={a}/><div><Tag>{a.style}</Tag><Tag>{a.view}</Tag><h3>{a.character}</h3><small>{a.name}</small><p>本机草稿 · 未发布</p><Button block onClick={()=>onUse({id:a.id,name:a.character,text:`素材：${a.name}\n画风：${a.style}\n视图：${a.view}\n素材版本：${a.id}\n本机素材引用，尚未上传到服务器。`})}>引用到画布</Button><Button block type="text" danger onClick={()=>Modal.confirm({title:"删除本机素材？",content:"画布中已有的引用会保留文字记录。",onOk:async()=>{const next=assets.filter(v=>v.id!==a.id);await db.setItem(storageKey,next);setAssets(next);}})}>删除草稿</Button></div></article>)}</div>:<div className={s.empty}><ImageIcon size={40} strokeWidth={1}/><h2>从第一套角色设定开始</h2><p>例如：贝瓦 · 羊毛毡 · 三视图<br/>不同画风分别保存，避免在制作时混用。</p><Button onClick={()=>input.current?.click()}>上传图片并分类</Button></div>}
    <Modal title={`整理 ${files.length} 张素材`} open={files.length>0} onCancel={()=>setFiles([])} onOk={save} confirmLoading={busy} okText="保存本机素材" okButtonProps={{disabled:!character.trim()||!style.trim()}}><div className={s.form}><label>角色或场景名称<Input value={character} onChange={e=>setCharacter(e.target.value)} placeholder="贝瓦"/></label><label>画风<Select showSearch value={style} onChange={setStyle} options={["羊毛毡","2D","3D","水彩","写实"].map(value=>({value,label:value}))}/><Input aria-label="自定义画风" value={style} onChange={e=>setStyle(e.target.value)} placeholder="也可以输入自定义画风"/></label><label>视图<Select value={view} onChange={setView} options={["三视图","正面","侧面","背面","表情集","场景全景","道具"].map(value=>({value,label:value}))}/></label><label>归入<Select value={scope} onChange={setScope} options={[{value:"official",label:"官方素材（待发布草稿）"},{value:"story",label:"当前故事资产"}]}/></label><p className={s.muted}>图片保存在此浏览器，不会自动上传到生产服务器。</p></div></Modal>
  </section>;
}
