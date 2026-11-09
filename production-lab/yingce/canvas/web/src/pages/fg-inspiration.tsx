import {lazy,Suspense,useEffect,useRef,useState} from "react";
import {useTranslation} from "react-i18next";
import {Alert,Button,Input,Pagination,Popover,Select,Spin,Upload,message} from "antd";
import {ArrowUpRight,Check,Copy,Film,Heart,Image as ImageIcon,Info,Play,Search,Sparkles,FileText,Plus,Download,Upload as UploadIcon} from "lucide-react";
import {saveAs} from "file-saver";
import dayjs from "dayjs";
import {http} from "@/services/api/request";
import {AppModal} from "@/components/ui/product/app-modal";
import {WorkspaceState} from "@/components/layout/workspace-state";
import {FGInspirationEditor} from "./fg-inspiration-editor";
import {useUserStore} from "@/stores/use-user-store";
import "./fg-inspiration.css";
import {bundledInspirationCover} from "@/lib/inspiration-cover";
const InspirationSphere=lazy(()=>import("@/components/inspiration-sphere").then(module=>({default:module.InspirationSphere})));

type Entry={id:string;title:string;prompt?:string;promptZh?:string;license?:string;description:string;kind:"image"|"video"|"text";cover:string;media:{kind:"image"|"video";url:string}[];tags:string[];author:string;sourceName:string;sourceId:string;sourceUrl:string;model:string};
type Gallery={items:Entry[];total:number;page:number;pageSize:number;categories:{id:string;name:string;count:number}[];models:string[];favorites:string[];counts:{image:number;video:number;text:number;playableVideo:number};sources:{id:string;name:string;count:number;lastSuccess:string|null;error:string|null}[]};
function Preview({item,large=false}:{item:Entry;large?:boolean}){
 const [failed,setFailed]=useState(false);const video=item.media.find(m=>m.kind==="video");const cover=bundledInspirationCover(item.cover,import.meta.env.BASE_URL);
 useEffect(()=>setFailed(false),[item.id]);
 if(item.kind==="text")return <div className="fg-inspiration-text-preview"><FileText size={28}/><strong>{item.title}</strong><p>{item.description}</p></div>;
 return large&&video?<video controls playsInline preload="metadata" src={video.url} poster={cover} className="fg-inspiration-detail-media"/>:
  failed||!cover?<div className="fg-inspiration-unavailable"><ImageIcon size={30}/><span>预览暂不可用</span></div>:<img src={cover} alt={item.title} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>;
}
export default function FGInspirationPage({embedded=false,onUsePrompt}:{embedded?:boolean;onUsePrompt?:(mode:"image"|"video"|"text",prompt:string)=>void}={}){
 const {t}=useTranslation();
 const accountId=useUserStore(state=>state.user?.id);
 const [kind,setKind]=useState("image"),[source,setSource]=useState(""),[query,setQuery]=useState(""),[search,setSearch]=useState(""),[page,setPage]=useState(1),[gallery,setData]=useState<Gallery|null>(null),[dataAccount,setDataAccount]=useState<string|undefined>(),[busy,setBusy]=useState(true),[error,setError]=useState(""),[selection,setSelected]=useState<Entry|null>(null),[selectionAccount,setSelectionAccount]=useState<string|undefined>(),[detailBusy,setDetailBusy]=useState(false),[copied,setCopied]=useState(false);
 const data=dataAccount===accountId?gallery:null,selected=selectionAccount===accountId?selection:null;
 const activeAccount=useRef(accountId);activeAccount.current=accountId;
 const detailSequence=useRef(0);
 const [category,setCategory]=useState(""),[model,setModel]=useState("");
 const [sort,setSort]=useState("recommended");
 const [view,setView]=useState("grid");
 const [sphereExitSignal,setSphereExitSignal]=useState(0);
 const [sphereItems,setSphereItems]=useState<Entry[]>([]),[sphereBusy,setSphereBusy]=useState(false);
 const [collection,setCollection]=useState(""),[revision,setRevision]=useState(0),[editorOpen,setEditorOpen]=useState(false),[favoriteBusy,setFavoriteBusy]=useState<string[]>([]),[importing,setImporting]=useState(false),[exporting,setExporting]=useState(false),[promptLanguage,setPromptLanguage]=useState("original");
 const container=useRef<HTMLElement>(null);
 const [toast,toastContext]=message.useMessage();
 useEffect(()=>{detailSequence.current++;setSelected(null);setEditorOpen(false);setFavoriteBusy([]);setPage(1);},[accountId]);
 useEffect(()=>{container.current?.scrollTo({top:0,behavior:"instant"});},[kind,source,category,model,search,page]);
 useEffect(()=>{const timer=setTimeout(()=>{setSearch(query);setPage(1);},250);return()=>clearTimeout(timer);},[query]);
 useEffect(()=>{
  let alive=true;const controller=new AbortController();setBusy(true);setError("");
  const params=new URLSearchParams({kind,source,category,model,collection,q:search,sort,page:String(page)});
  void http.get<Gallery>("/fg/inspiration?"+params,{signal:controller.signal}).then(value=>{if(alive&&activeAccount.current===accountId){setData(value);setDataAccount(accountId);}}).catch(e=>{if(alive)setError(e.message||"灵感内容加载失败");}).finally(()=>{if(alive)setBusy(false);});
  return()=>{alive=false;controller.abort();};
 },[kind,source,category,model,collection,search,sort,page,revision,accountId]);
 useEffect(()=>{
  setSphereItems([]);
  if(view!=="sphere"||kind==="text")return;
  const controller=new AbortController();setSphereBusy(true);
  const params=new URLSearchParams({kind,source,category,model,collection,q:search,sort});
  void Promise.all([1,2,3,4,5,6,7,8,9,10,11,12].map(page=>http.get<Gallery>(`/fg/inspiration?${params}&page=${page}`,{signal:controller.signal}))).then(pages=>{
   if(!controller.signal.aborted&&activeAccount.current===accountId)setSphereItems([...new Map(pages.flatMap(p=>p.items).map(item=>[item.id,item])).values()]);
  }).catch(error=>{if(!controller.signal.aborted)setError(error.message||"星球作品读取失败");}).finally(()=>{if(!controller.signal.aborted)setSphereBusy(false);});
  return()=>controller.abort();
 },[view,kind,source,category,model,collection,search,sort,revision,accountId]);
 async function open(item:Entry){
  const sequence=++detailSequence.current;setSelectionAccount(accountId);setSelected(item);setCopied(false);setDetailBusy(true);setPromptLanguage("original");
  try{const value=await http.get<Entry>("/fg/inspiration/items/"+item.id);if(sequence===detailSequence.current&&activeAccount.current===accountId)setSelected(current=>current?.id===item.id?value:current);}
  catch(e){if(activeAccount.current===accountId)void toast.error(e instanceof Error?e.message:"提示词读取失败");}finally{if(sequence===detailSequence.current)setDetailBusy(false);}
 }
 const activePrompt=promptLanguage==="zh"?selected?.promptZh:selected?.prompt;
 async function copy(){try{await navigator.clipboard.writeText(activePrompt||"");setCopied(true);void toast.success("提示词已复制，可粘贴到任意工作台或画布");}catch{void toast.error("复制失败，请选择下方文本手动复制");}}
 async function favorite(id:string){
  if(favoriteBusy.includes(id))return;setFavoriteBusy(ids=>[...ids,id]);
  try{const result=await http.post<{favorites:string[]}>("/fg/inspiration/favorites",{id,favorite:!data?.favorites.includes(id)});if(activeAccount.current!==accountId)return;setData(current=>current?{...current,favorites:result.favorites}:current);if(collection==="favorites")setRevision(value=>value+1);}
  catch(error){void toast.error(error instanceof Error?error.message:"收藏失败");}finally{setFavoriteBusy(ids=>ids.filter(value=>value!==id));}
 }
 async function importFile(file:File){
  if(file.size>4*1024*1024){void toast.error("导入文件最多 4 MB");return false;}setImporting(true);
  try{const parsed=JSON.parse(await file.text());if(activeAccount.current!==accountId)return false;await http.post("/fg/inspiration/import",Array.isArray(parsed)?{entries:parsed}:parsed);if(activeAccount.current!==accountId)return false;setRevision(value=>value+1);void toast.success("灵感已导入到您的账号");}
  catch(error){void toast.error(error instanceof SyntaxError?"请选择有效的 JSON 灵感文件":error instanceof Error?error.message:"导入失败");}finally{setImporting(false);}return false;
 }
 async function exportFile(){setExporting(true);try{const result=await http.get("/fg/inspiration/export");if(activeAccount.current!==accountId)return;saveAs(new Blob([JSON.stringify(result,null,2)],{type:"application/json"}),`FG-我的灵感-${dayjs().format("YYYYMMDD")}.json`);}catch(error){void toast.error(error instanceof Error?error.message:"导出失败");}finally{setExporting(false);}}
 const successes=data?.sources.map(s=>s.lastSuccess).filter((v):v is string=>!!v).sort()||[];
 const sourceErrors=data?.sources.filter(s=>s.error)||[];
 const Container=embedded?"section":"main";
 return <Container ref={container} className={`fg-inspiration ${embedded?"is-embedded":""}`}>{toastContext}
  {!embedded?<header className="fg-inspiration-hero">
   <div className="fg-inspiration-kicker"><Sparkles size={14}/><span>FG INSPIRATION / 灵感档案</span><span className="fg-inspiration-live"><i/> 每 30 分钟更新</span></div>
   <div className="fg-inspiration-heading"><h1>下一帧，<br/><span>从这里开始。</span></h1><div><p>浏览出色的画面，拆解它的提示词。<br/>把一个灵感，带进你的下一次创作。</p><div className="fg-inspiration-totals"><strong>{data?.counts.image.toLocaleString()||"—"}<small>图片灵感</small></strong><strong>{data?.counts.video.toLocaleString()||"—"}<small>视频灵感</small></strong><strong>{data?.sources.length.toString().padStart(2,"0")||"—"}<small>精选来源</small></strong></div></div></div>
  </header>:<header className="creation-section-heading"><h2><Sparkles size={18}/>{t("fgWorkspace.inspirations")}</h2><span>浏览、收藏，将喜欢的画面带入创作</span></header>}
  <div className="fg-inspiration-library-bar"><div className="fg-inspiration-collections">{[["","全部灵感"],["favorites","我的收藏"],["mine","我的灵感"]].map(([id,label])=><Button key={id} type={collection===id?"primary":"text"} onClick={()=>{setCollection(id);setPage(1);}}>{label}</Button>)}</div><div className="fg-inspiration-library-actions"><Upload accept=".json,application/json" showUploadList={false} beforeUpload={importFile} disabled={importing}><Button icon={<UploadIcon size={14}/>} loading={importing}>导入</Button></Upload><Button icon={<Download size={14}/>} loading={exporting} onClick={()=>void exportFile()}>导出我的灵感</Button><Button type="primary" icon={<Plus size={15}/>} onClick={()=>setEditorOpen(true)}>新建灵感</Button></div></div>
  <section className="fg-inspiration-toolbar" aria-label="筛选灵感">
   <div className="fg-inspiration-tabs" role="tablist" aria-label="灵感类型">{[["image","图片",ImageIcon],["video","视频",Film],["text","文本",FileText]].map(([id,label,Icon])=>{const MediaIcon=Icon as typeof ImageIcon;return <button type="button" role="tab" aria-selected={kind===id} key={String(id)} className={kind===id?"is-active":""} onClick={()=>{setKind(String(id));setCategory("");setModel("");setSource("");setPage(1);}}><MediaIcon size={17}/>{String(label)}<span>{data?.counts[id as "image"|"video"|"text"]||0}</span></button>;})}</div>
   <div className="fg-inspiration-filters">
    {!collection&&!search?<Select aria-label={t("fgWorkspace.inspirations")} value={sort} onChange={value=>{setSort(value);setPage(1);}} options={[{value:"recommended",label:t("fgWorkspace.recommended")},{value:"newest",label:t("fgWorkspace.newest")}]}/>:null}
    <Select aria-label="灵感来源" value={source} onChange={value=>{setSource(value);setPage(1);}} options={[{value:"",label:"全部来源"},...(data?.sources.map(s=>({value:s.id,label:s.name}))||[])]} style={{width:240}}/>
    <Input aria-label="搜索灵感" prefix={<Search size={15}/>} placeholder="搜索风格、主题或提示词" allowClear value={query} onChange={e=>setQuery(e.target.value)}/>
   </div>
  </section>
  <section className="fg-inspiration-category-row" aria-label="灵感分类">
   <div className="fg-inspiration-categories"><button type="button" aria-pressed={!category} onClick={()=>{setCategory("");setPage(1);}}>全部用途</button>{data?.categories.filter(c=>c.count>0).map(c=><button key={c.id} type="button" aria-pressed={category===c.id} onClick={()=>{setCategory(c.id);setPage(1);}}>{c.name}<span>{c.count}</span></button>)}</div>
   <Select aria-label="灵感模型" value={model} onChange={value=>{setModel(value);setPage(1);}} options={[{value:"",label:"全部模型"},...(data?.models.map(m=>({value:m,label:m}))||[])]} style={{minWidth:170}}/>
  </section>
  {kind==="video"&&data&&<p className="fg-inspiration-video-note">{data.counts.video} 条视频灵感，其中 {data.counts.playableVideo} 条提供可播放示例；其余保留封面、完整提示词与原始出处。</p>}
  <div className="fg-inspiration-status"><span>{kind==="image"?"IMAGE COLLECTION":kind==="video"?"MOTION COLLECTION":"TEXT COLLECTION"} / {data?.total||0} 个灵感</span><span>{successes.length?`最近同步 ${dayjs(successes.at(-1)).format("MM/DD HH:mm")}`:"正在同步公开作品"} · 页面关闭后仍自动更新</span></div>
  {sourceErrors.length>0&&<div className="fg-inspiration-sync-note" role="status"><Info size={14}/><span>{sourceErrors.length} 个来源更新暂缓 · {sourceErrors.some(s=>s.count>0)?"已保留上次成功内容，可继续浏览":"其他来源仍可浏览"}</span><Popover trigger="click" placement="bottomRight" title="来源更新状态" content={<ul className="fg-inspiration-sync-details">{sourceErrors.map(s=><li key={s.id}><strong>{s.name}</strong><span>{s.lastSuccess?`上次成功 ${dayjs(s.lastSuccess).format("MM/DD HH:mm")} · 已保留 ${s.count} 条`:"尚未完成首次同步"}</span></li>)}</ul>}><Button type="text" size="small">查看详情</Button></Popover></div>}
  {error&&<Alert className="fg-inspiration-error" type="error" showIcon title={error}/>}
  <Spin spinning={busy}>
   <div style={{display:"flex",gap:8,marginBottom:16}} role="group" aria-label="灵感浏览方式"><Button aria-pressed={view==="grid"} type={view==="grid"?"primary":"default"} onClick={()=>setView("grid")}>作品网格</Button><Button disabled={kind==="text"} aria-pressed={view==="sphere"} type={view==="sphere"?"primary":"default"} onClick={()=>setView("sphere")}>星球漫游</Button></div>
   {view==="sphere"&&kind!=="text"&&data?<Suspense fallback={<Spin/>}><Spin spinning={sphereBusy}><InspirationSphere exitSignal={sphereExitSignal} collectionName={data.categories.find(c=>c.id===category)?.name || (kind==="video"?"视频灵感":"图片灵感")} toolbar={<><Select aria-label="星球素材类型" value={kind} style={{width:100}} getPopupContainer={trigger=>trigger.parentElement!} onChange={value=>{setKind(value);setCategory("");setModel("");setSource("");setPage(1);}} options={[{value:"image",label:"图片"},{value:"video",label:"视频"}]}/><Select aria-label="星球分类" value={category} style={{width:180}} getPopupContainer={trigger=>trigger.parentElement!} onChange={value=>{setCategory(value);setPage(1);}} showSearch optionFilterProp="label" options={[{value:"",label:"全部分类"},...data.categories.filter(c=>c.count>0).map(c=>({value:c.id,label:`${c.name} · ${c.count}`}))]}/></>} items={sphereItems.length?sphereItems:data.items} onSelect={item=>{const entry=[...sphereItems,...data.items].find(e=>e.id===item.id);if(entry)void open(entry);}}/></Spin></Suspense>:null}
   <section className="fg-inspiration-grid" style={view==="sphere"&&kind!=="text"?{display:"none"}:undefined} aria-label={kind==="image"?"图片灵感作品":"视频灵感作品"}>
    {data?.items.map((item,index)=><article className="fg-inspiration-card" key={item.id}><button type="button" className="fg-inspiration-card-preview" onClick={()=>void open(item)} aria-label={`查看 ${item.title} 的提示词`}><Preview item={item}/><span className="fg-inspiration-card-index">{String((page-1)*36+index+1).padStart(3,"0")}</span>{item.media.some(m=>m.kind==="video")&&<span className="fg-inspiration-play"><Play fill="currentColor" size={20}/></span>}<span className="fg-inspiration-card-action">查看提示词 <ArrowUpRight size={16}/></span></button><div className="fg-inspiration-card-caption"><button type="button" onClick={()=>void open(item)}>{item.title}</button><span>{item.model}</span></div><div className="fg-inspiration-card-source"><span>{item.sourceName}{item.kind==="video"&&!item.media.some(m=>m.kind==="video")?" · 封面参考":""}</span><Button type="text" size="small" aria-label={`${data.favorites.includes(item.id)?"取消收藏":"收藏"} ${item.title}`} aria-pressed={data.favorites.includes(item.id)} loading={favoriteBusy.includes(item.id)} icon={<Heart size={15} fill={data.favorites.includes(item.id)?"currentColor":"none"}/>} onClick={()=>void favorite(item.id)}/></div></article>)}
   </section>
   {!busy&&!data?.items.length&&!error&&<WorkspaceState title="这个分类暂时没有作品" description="试试其他来源或关键词"/>}
  </Spin>
  {(data?.total||0)>36&&<Pagination className="fg-inspiration-pagination" current={page} pageSize={36} total={data?.total} showSizeChanger={false} onChange={setPage}/>}
  <footer className="fg-inspiration-footer"><span>发现 · 拆解 · 创作</span><span>作品与提示词来自公开来源，原作者及出处保留在详情中。</span></footer>
  <FGInspirationEditor open={editorOpen} onClose={()=>setEditorOpen(false)} onSaved={()=>setRevision(value=>value+1)}/>
  <AppModal zIndex={1600} open={!!selected} onCancel={()=>setSelected(null)} footer={null} width={1180} title="灵感详情" className="fg-inspiration-modal" destroyOnHidden>
   {selected&&<div className="fg-inspiration-detail"><div className="fg-inspiration-detail-visual"><Preview item={selected} large/></div><div className="fg-inspiration-detail-copy"><span className="fg-inspiration-kicker">{selected.kind==="video"?"VIDEO":selected.kind==="text"?"TEXT":"IMAGE"} / {selected.model}</span><h2>{selected.title}</h2>{selected.description&&<p>{selected.description}</p>}<div className="fg-inspiration-tags">{selected.tags.map(tag=><span key={tag}>{tag}</span>)}</div><div className="fg-inspiration-prompt-heading"><h3>对应提示词</h3>{selected.promptZh&&<Select aria-label="提示词语言" value={promptLanguage} onChange={value=>{setPromptLanguage(value);setCopied(false);}} options={[{value:"original",label:"原文"},{value:"zh",label:"中文"}]} size="small"/>}<Button icon={copied?<Check size={15}/>:<Copy size={15}/>} disabled={!activePrompt||detailBusy} onClick={()=>void copy()}>{copied?"已复制":"复制提示词"}</Button></div><Spin spinning={detailBusy}><pre>{activePrompt||"正在读取提示词…"}</pre></Spin><div className="fg-inspiration-attribution"><span>{selected.author?`${selected.author} · `:""}{selected.sourceName}</span>{selected.license&&<span>{selected.license}</span>}<p>{selected.kind==="video"?"封面来自原案例；可在上游原页查看原视频。":"配图为原来源示例，不代表本平台生成结果。"}</p></div><div className="fg-inspiration-detail-actions">{onUsePrompt&&<Button type="primary" disabled={!activePrompt||detailBusy} onClick={()=>{setSphereExitSignal(value=>value+1);onUsePrompt(selected.kind,activePrompt||"");setSelected(null);}}>带入创作</Button>}{selected.sourceUrl&&<Button href={selected.sourceUrl} target="_blank" rel="noreferrer" icon={<ArrowUpRight size={15}/>}>{selected.kind==="video"?"查看原页 / 原视频":"查看上游原页"}</Button>}<Button icon={<Heart size={15} fill={data?.favorites.includes(selected.id)?"currentColor":"none"}/>} loading={favoriteBusy.includes(selected.id)} onClick={()=>void favorite(selected.id)}>{data?.favorites.includes(selected.id)?"已收藏":"收藏灵感"}</Button></div></div></div>}
  </AppModal>
 </Container>;
}
