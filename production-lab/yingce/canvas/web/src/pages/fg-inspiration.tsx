import {useEffect,useRef,useState} from "react";
import {Alert,Button,Input,Pagination,Select,Spin,message} from "antd";
import {ArrowUpRight,Check,Copy,Film,Image as ImageIcon,Play,Search,Sparkles} from "lucide-react";
import dayjs from "dayjs";
import {http} from "@/services/api/request";
import {AppModal} from "@/components/ui/product/app-modal";
import {WorkspaceState} from "@/components/layout/workspace-state";
import "./fg-inspiration.css";

type Entry={id:string;title:string;prompt?:string;description:string;kind:"image"|"video";cover:string;media:{kind:"image"|"video";url:string}[];tags:string[];author:string;sourceName:string;sourceId:string;sourceUrl:string;model:string};
type Gallery={items:Entry[];total:number;page:number;pageSize:number;categories:{id:string;name:string;count:number}[];models:string[];counts:{image:number;video:number;playableVideo:number};sources:{id:string;name:string;count:number;lastSuccess:string|null;error:string|null}[]};
function Preview({item,large=false}:{item:Entry;large?:boolean}){
 const [failed,setFailed]=useState(false);const video=item.media.find(m=>m.kind==="video");
 useEffect(()=>setFailed(false),[item.id]);
 return large&&video?<video controls playsInline preload="metadata" src={video.url} poster={item.cover} className="fg-inspiration-detail-media"/>:
  failed||!item.cover?<div className="fg-inspiration-unavailable"><ImageIcon size={30}/><span>预览暂不可用</span></div>:<img src={item.cover} alt={item.title} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>;
}
export default function FGInspirationPage(){
 const [kind,setKind]=useState("image"),[source,setSource]=useState(""),[query,setQuery]=useState(""),[search,setSearch]=useState(""),[page,setPage]=useState(1),[data,setData]=useState<Gallery|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState(""),[selected,setSelected]=useState<Entry|null>(null),[detailBusy,setDetailBusy]=useState(false),[copied,setCopied]=useState(false);
 const [category,setCategory]=useState(""),[model,setModel]=useState("");
 const container=useRef<HTMLElement>(null);
 const [toast,toastContext]=message.useMessage();
 useEffect(()=>{container.current?.scrollTo({top:0,behavior:"instant"});},[kind,source,category,model,search,page]);
 useEffect(()=>{const timer=setTimeout(()=>{setSearch(query);setPage(1);},250);return()=>clearTimeout(timer);},[query]);
 useEffect(()=>{
  let alive=true;const controller=new AbortController();setBusy(true);setError("");
  const params=new URLSearchParams({kind,source,category,model,q:search,page:String(page)});
  void http.get<Gallery>("/fg/inspiration?"+params,{signal:controller.signal}).then(value=>{if(alive)setData(value);}).catch(e=>{if(alive)setError(e.message||"灵感内容加载失败");}).finally(()=>{if(alive)setBusy(false);});
  return()=>{alive=false;controller.abort();};
 },[kind,source,category,model,search,page]);
 async function open(item:Entry){
  setSelected(item);setCopied(false);setDetailBusy(true);
  try{const value=await http.get<Entry>("/fg/inspiration/items/"+item.id);setSelected(current=>current?.id===item.id?value:current);}
  catch(e){void toast.error(e instanceof Error?e.message:"提示词读取失败");}finally{setDetailBusy(false);}
 }
 async function copy(){try{await navigator.clipboard.writeText(selected?.prompt||"");setCopied(true);void toast.success("提示词已复制，可粘贴到任意工作台或画布");}catch{void toast.error("复制失败，请选择下方文本手动复制");}}
 const successes=data?.sources.map(s=>s.lastSuccess).filter((v):v is string=>!!v).sort()||[];
 const sourceErrors=data?.sources.filter(s=>s.error)||[];
 return <main ref={container} className="fg-inspiration">{toastContext}
  <header className="fg-inspiration-hero">
   <div className="fg-inspiration-kicker"><Sparkles size={14}/><span>FG INSPIRATION / 灵感档案</span><span className="fg-inspiration-live"><i/> 每 30 分钟更新</span></div>
   <div className="fg-inspiration-heading"><h1>下一帧，<br/><span>从这里开始。</span></h1><div><p>浏览出色的画面，拆解它的提示词。<br/>把一个灵感，带进你的下一次创作。</p><div className="fg-inspiration-totals"><strong>{data?.counts.image.toLocaleString()||"—"}<small>图片灵感</small></strong><strong>{data?.counts.video.toLocaleString()||"—"}<small>视频灵感</small></strong><strong>{data?.sources.length.toString().padStart(2,"0")||"—"}<small>精选来源</small></strong></div></div></div>
  </header>
  <section className="fg-inspiration-toolbar" aria-label="筛选灵感">
   <div className="fg-inspiration-tabs" role="tablist" aria-label="灵感类型">{[["image","图片",ImageIcon],["video","视频",Film]].map(([id,label,Icon])=>{const MediaIcon=Icon as typeof ImageIcon;return <button type="button" role="tab" aria-selected={kind===id} key={String(id)} className={kind===id?"is-active":""} onClick={()=>{setKind(String(id));setCategory("");setModel("");setSource("");setPage(1);}}><MediaIcon size={17}/>{String(label)}<span>{data?.counts[id as "image"|"video"]||0}</span></button>;})}</div>
   <div className="fg-inspiration-filters"><Select aria-label="灵感来源" value={source} onChange={value=>{setSource(value);setPage(1);}} options={[{value:"",label:"全部来源"},...(data?.sources.map(s=>({value:s.id,label:s.name}))||[])]} style={{width:240}}/><Input aria-label="搜索灵感" prefix={<Search size={15}/>} placeholder="搜索风格、主题或提示词" allowClear value={query} onChange={e=>setQuery(e.target.value)}/></div>
  </section>
  <section className="fg-inspiration-category-row" aria-label="灵感分类">
   <div className="fg-inspiration-categories"><button type="button" aria-pressed={!category} onClick={()=>{setCategory("");setPage(1);}}>全部用途</button>{data?.categories.filter(c=>c.count>0).map(c=><button key={c.id} type="button" aria-pressed={category===c.id} onClick={()=>{setCategory(c.id);setPage(1);}}>{c.name}<span>{c.count}</span></button>)}</div>
   <Select aria-label="灵感模型" value={model} onChange={value=>{setModel(value);setPage(1);}} options={[{value:"",label:"全部模型"},...(data?.models.map(m=>({value:m,label:m}))||[])]} style={{minWidth:170}}/>
  </section>
  {kind==="video"&&data&&<p className="fg-inspiration-video-note">{data.counts.video} 条视频灵感，其中 {data.counts.playableVideo} 条提供可播放示例；其余保留封面、完整提示词与原始出处。</p>}
  <div className="fg-inspiration-status"><span>{kind==="image"?"IMAGE COLLECTION":"MOTION COLLECTION"} / {data?.total||0} 个灵感</span><span>{successes.length?`最近同步 ${dayjs(successes.at(-1)).format("MM/DD HH:mm")}`:"正在同步公开作品"} · 页面关闭后仍自动更新</span></div>
  {sourceErrors.length>0&&<Alert type="warning" showIcon title={`${sourceErrors.length} 个来源本次同步失败，保留上次成功内容`} description={sourceErrors.map(s=>s.name).join("、")}/>}
  {error&&<Alert type="error" showIcon title={error}/>}
  <Spin spinning={busy}>
   <section className="fg-inspiration-grid" aria-label={kind==="image"?"图片灵感作品":"视频灵感作品"}>
    {data?.items.map((item,index)=><article className="fg-inspiration-card" key={item.id}><button type="button" className="fg-inspiration-card-preview" onClick={()=>void open(item)} aria-label={`查看 ${item.title} 的提示词`}><Preview item={item}/><span className="fg-inspiration-card-index">{String((page-1)*36+index+1).padStart(3,"0")}</span>{item.media.some(m=>m.kind==="video")&&<span className="fg-inspiration-play"><Play fill="currentColor" size={20}/></span>}<span className="fg-inspiration-card-action">查看提示词 <ArrowUpRight size={16}/></span></button><div className="fg-inspiration-card-caption"><button type="button" onClick={()=>void open(item)}>{item.title}</button><span>{item.model}</span></div><div className="fg-inspiration-card-source">{item.sourceName}{item.kind==="video"&&!item.media.some(m=>m.kind==="video")?" · 封面参考":""}</div></article>)}
   </section>
   {!busy&&!data?.items.length&&!error&&<WorkspaceState title="这个分类暂时没有作品" description="试试其他来源或关键词"/>}
  </Spin>
  {(data?.total||0)>36&&<Pagination className="fg-inspiration-pagination" current={page} pageSize={36} total={data?.total} showSizeChanger={false} onChange={setPage}/>}
  <footer className="fg-inspiration-footer"><span>发现 · 拆解 · 创作</span><span>作品与提示词来自公开来源，原作者及出处保留在详情中。</span></footer>
  <AppModal open={!!selected} onCancel={()=>setSelected(null)} footer={null} width={1180} title="灵感详情" className="fg-inspiration-modal" destroyOnHidden>
   {selected&&<div className="fg-inspiration-detail"><div className="fg-inspiration-detail-visual"><Preview item={selected} large/></div><div className="fg-inspiration-detail-copy"><span className="fg-inspiration-kicker">{selected.kind==="video"?"VIDEO":"IMAGE"} / {selected.model}</span><h2>{selected.title}</h2>{selected.description&&<p>{selected.description}</p>}<div className="fg-inspiration-tags">{selected.tags.map(tag=><span key={tag}>{tag}</span>)}</div><div className="fg-inspiration-prompt-heading"><h3>对应提示词</h3><Button icon={copied?<Check size={15}/>:<Copy size={15}/>} disabled={!selected.prompt||detailBusy} onClick={()=>void copy()}>{copied?"已复制":"复制提示词"}</Button></div><Spin spinning={detailBusy}><pre>{selected.prompt||"正在读取提示词…"}</pre></Spin><a href={selected.sourceUrl} target="_blank" rel="noreferrer">{selected.author?`${selected.author} · `:""}{selected.sourceName}<ArrowUpRight size={14}/></a></div></div>}
  </AppModal>
 </main>;
}
