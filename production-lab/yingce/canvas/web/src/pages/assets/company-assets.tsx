import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { App, AutoComplete, Button, Form, Input, Pagination, Popconfirm, Select, Skeleton } from "antd";
import { AudioLines, Film, Image, Library, PencilLine, Plus, Search, Upload, X } from "lucide-react";
import { WorkspacePage, PageHeader } from "@/components/layout/workspace-page";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { useUserStore } from "@/stores/use-user-store";
import { getResourceAccess, resolveResourceAccessURL, uploadResourceFile } from "@/services/api/resources";
import { loadAssetsForUse } from "@/services/user-data-sync";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { readImageMeta } from "@/lib/image-utils";
import { probeMediaDurationMs } from "@/lib/media-metadata";
import { captureVideoPoster } from "@/lib/video-poster";
import { listCompanyAssets, publishCompanyAsset, updateCompanyAsset, useCompanyAsset, type CompanyAsset, type CompanyAssetInput } from "@/services/api/fg-company-assets";
import "./company-assets.css";

const categories=[{value:"character",label:"角色形象"},{value:"environment",label:"场景"},{value:"prop",label:"道具"},{value:"voice",label:"角色声线"},{value:"music",label:"音乐音效"},{value:"material",label:"参考素材"}];
const kinds=[{value:"image",label:"图片"},{value:"video",label:"视频"},{value:"audio",label:"音频"}];
function CompanyMedia({item,large=false}:{item:CompanyAsset;large?:boolean}) {
 const [url,setUrl]=useState("");const [error,setError]=useState("");
 useEffect(()=>{if(item.kind==="image")return;let stopped=false;getResourceAccess(`resource:${item.resourceId}`,"display").then(access=>{if(!stopped)setUrl(resolveResourceAccessURL(access.url))}).catch(()=>{if(!stopped)setError("文件读取失败，请刷新重试")});return()=>{stopped=true}},[item.resourceId,item.kind]);
 if(item.kind==="image")return <CachedResourceImage storageKey={`resource:${item.resourceId}`} alt={item.title} className={large?"fg-company-preview":"fg-company-image"} fallback={<Image aria-label="图片加载中"/>}/>;
 if(error)return <span role="alert">{error}</span>;
 if(item.kind==="video")return url?<video src={url} controls playsInline preload="metadata" className={large?"fg-company-preview":"fg-company-image"}/>:<Film/>;
 return <div className="fg-company-audio"><AudioLines/><span>{item.character||item.title}</span>{url?<audio src={url} controls preload="none"/>:<span>正在读取音频…</span>}</div>;
}

export function CompanyAssetsPage() {
 const {message}=App.useApp();const user=useUserStore(s=>s.user);const admin=user?.role==="admin";
 const [keyword,setKeyword]=useState("");const query=useDebouncedValue(keyword.trim(),250);
 const [kind,setKind]=useState<string>();const [category,setCategory]=useState<string>();const [brand,setBrand]=useState<string>();const [style,setStyle]=useState<string>();const [status,setStatus]=useState("active");const [page,setPage]=useState(1);
 const [editor,setEditor]=useState<CompanyAsset|"new"|null>(null);const [preview,setPreview]=useState<CompanyAsset|null>(null);const [file,setFile]=useState<File|null>(null);const [saving,setSaving]=useState(false);const [progress,setProgress]=useState(0);const [using,setUsing]=useState("");const input=useRef<HTMLInputElement>(null);const [form]=Form.useForm<CompanyAssetInput>();
 const upload=useRef<{file:File;key:string;resourceId?:string}|null>(null);
 const library=useQuery({queryKey:["fg-company-assets",user?.id,page,query,kind,category,brand,style,status],queryFn:({signal})=>listCompanyAssets({page,pageSize:24,query,kind,category,brand,style,status},signal),enabled:!!user?.id});
 useEffect(()=>{setPage(1)},[query,kind,category,brand,style,status]);
 const edit=(item:CompanyAsset|"new")=>{setEditor(item);setFile(null);upload.current=null;setProgress(0);form.resetFields();form.setFieldsValue(item==="new"?{category:"character",brand:"",character:"",style:"",view:"",note:""}:item)};
 const save=async()=>{
  const values=await form.validateFields().catch(()=>null);if(!values||!editor)return;
  if(editor==="new"&&!file){message.error("请选择需要上传的图片、视频或音频");return}
  setSaving(true);
  try {
   if(editor==="new"&&file){
    const mediaKind=file.type.startsWith("image/")?"image":file.type.startsWith("video/")?"video":file.type.startsWith("audio/")?"audio":null;
    if(!mediaKind)throw new Error("请选择图片、视频或音频文件");
    if(!upload.current||upload.current.file!==file)upload.current={file,key:crypto.randomUUID()};
    if(!upload.current.resourceId){
     let meta:{width?:number;height?:number;durationMs?:number}={};
     if(mediaKind==="image"){const temp=URL.createObjectURL(file);try{meta=await readImageMeta(temp)}finally{URL.revokeObjectURL(temp)}}
     else if(mediaKind==="audio")meta={durationMs:await probeMediaDurationMs(file)};
     else {const temp=URL.createObjectURL(file);try{const captured=await captureVideoPoster(temp);meta={width:captured.width,height:captured.height,durationMs:captured.durationMs}}catch{meta={durationMs:await probeMediaDurationMs(file)}}finally{URL.revokeObjectURL(temp)}}
     const resource=await uploadResourceFile(file,mediaKind,{...meta,fileName:file.name,idempotencyKey:upload.current.key},(bytes,total)=>setProgress(Math.round(bytes/Math.max(total,1)*100)));
     if(resource.status!=="ready"||resource.provider!=="local")throw new Error("文件尚未保存到 NAS，请稍后重试");
     upload.current.resourceId=resource.id;
    }
    await publishCompanyAsset({...values,resourceId:upload.current.resourceId});
   }else if(editor!=="new")await updateCompanyAsset(editor,values);
   setEditor(null);setFile(null);await library.refetch();message.success("公司素材已保存，全员可引用");
  }catch(error){message.error(error instanceof Error?error.message:"素材保存失败")}finally{setSaving(false)}
 };
 const use=async(item:CompanyAsset)=>{setUsing(item.id);try{const result=await useCompanyAsset(item.id);await loadAssetsForUse([result.asset.id]);message.success("已加入我的素材，生成时可从参考内容中选用")}catch(error){message.error(error instanceof Error?error.message:"引用失败")}finally{setUsing("")}};
 const changeStatus=async(item:CompanyAsset)=>{try{await updateCompanyAsset(item,{...item,status:item.status==="active"?"archived":"active"});await library.refetch();message.success(item.status==="active"?"已下架，已引用的文件继续保留":"素材已重新上架")}catch(error){message.error(error instanceof Error?error.message:"保存失败")}};
 const facets=library.data?.facets||{};const options=(field:string)=>Object.entries(facets[field]||{}).map(([value,count])=>({value,label:`${value} · ${count}`}));
 return <WorkspacePage className="fg-company-page">
  <PageHeader title="公司素材库" description="统一角色与声线，让每一位创作者从同一套资产开始。" actions={admin?<Button type="primary" icon={<Plus size={16}/>} onClick={()=>edit("new")}>上传公司素材</Button>:undefined}/>
  <section className="fg-company-hero"><div className="fg-company-emblem"><Library/></div><div><span className="fg-company-eyebrow">FG · SHARED ASSETS</span><h2>团队共用，一处沉淀。</h2><p>角色三视图、风格套图、场景与声线。按品牌、角色和风格查找，一键加入创作。</p></div><div className="fg-company-summary">{library.data?.total??"—"}<small>个{status==="active"?"可用":"已下架"}素材</small></div></section>
  <div className="fg-company-filters"><Input prefix={<Search size={16}/>} placeholder="搜索贝瓦、角色、风格或素材说明" value={keyword} onChange={e=>setKeyword(e.target.value)} allowClear/>
   <Select aria-label="素材类型" placeholder="全部类型" value={kind} onChange={setKind} allowClear options={kinds}/><Select aria-label="素材分类" placeholder="全部分类" value={category} onChange={setCategory} allowClear options={categories}/>
   <Select aria-label="品牌" placeholder="全部品牌" value={brand} onChange={setBrand} allowClear showSearch options={options("brand")}/><Select aria-label="视觉风格" placeholder="全部风格" value={style} onChange={setStyle} allowClear showSearch options={options("style")}/>
   {admin?<Select aria-label="上架状态" value={status} onChange={setStatus} options={[{value:"active",label:"已上架"},{value:"archived",label:"已下架"}]}/>:null}
  </div>
  {library.isPending?<Skeleton active/>:library.isError?<div className="fg-company-empty" role="alert"><p>公司素材加载失败，请重试。</p><Button onClick={()=>void library.refetch()}>重试</Button></div>:!library.data?.assets.length?<div className="fg-company-empty"><Library/><h3>{query||kind||category||brand||style?"没有符合条件的素材":"一起建立团队的第一套素材"}</h3><p>{admin?"上传贝瓦角色图片或声线音频，分类后全员即可使用。":"超级管理员上传公司素材后，会显示在这里。"}</p>{admin?<Button onClick={()=>edit("new")} icon={<Upload size={16}/>}>上传素材</Button>:null}</div>:<div className="fg-company-grid">{library.data.assets.map(item=><article className="fg-company-card" key={item.id}>
   <div className="fg-company-media"><CompanyMedia item={item}/></div><div className="fg-company-card-body"><div className="fg-company-card-heading"><h3>{item.title}</h3><span className="fg-company-chip">{categories.find(c=>c.value===item.category)?.label}</span></div><p className="fg-company-meta">{[item.brand,item.character,item.view].filter(Boolean).join(" · ")||"公司共享素材"}</p>{item.style?<span className="fg-company-style">{item.style}</span>:null}<p className="fg-company-note">{item.note||"点击详情预览素材，加入我的素材后可在画布中引用。"}</p>
    <div className="fg-company-card-actions"><Button onClick={()=>setPreview(item)}>详情</Button>{item.status==="active"?<Button type="primary" loading={using===item.id} onClick={()=>void use(item)}>加入我的素材</Button>:null}{admin?<><Button type="text" aria-label={`编辑 ${item.title}`} icon={<PencilLine size={15}/>} onClick={()=>edit(item)}/><Popconfirm title={item.status==="active"?"下架此素材？已引用的文件会继续保留。":"重新上架此素材？"} onConfirm={()=>changeStatus(item)} okText="确认" cancelText="取消"><Button type="text">{item.status==="active"?"下架":"上架"}</Button></Popconfirm></>:null}</div>
   </div></article>)}</div>}
  {library.data&&library.data.total>24?<Pagination current={page} pageSize={24} total={library.data.total} onChange={setPage} showSizeChanger={false}/>:null}
  <AppModal open={!!editor} title={editor==="new"?"上传公司素材":"编辑公司素材"} onCancel={()=>{if(!saving)setEditor(null)}} onOk={()=>void save()} confirmLoading={saving} okText={saving?`正在保存 ${progress}%`:"保存并共享"} cancelText="取消" width={640} maskClosable={!saving} closable={!saving}>
   <Form form={form} layout="vertical"><Form.Item name="title" label="素材名称" rules={[{required:true,message:"请输入素材名称"},{max:160}]}><Input placeholder="例如：贝瓦 · 羊毛毡风 · 三视图"/></Form.Item>
    {editor==="new"?<div className="fg-company-upload"><input ref={input} type="file" accept="image/*,video/*,audio/*" hidden onChange={e=>{const selected=e.target.files?.[0];if(selected){setFile(selected);if(!form.getFieldValue("title"))form.setFieldValue("title",selected.name.replace(/\.[^.]+$/,""));if(selected.type.startsWith("audio/"))form.setFieldValue("category","voice")}}}/><Button icon={<Upload size={16}/>} onClick={()=>input.current?.click()} disabled={saving}>选择文件</Button><span>{file?.name||"图片 / 视频 / 音频，保存到 NAS"}</span>{file?<Button type="text" aria-label="移除待上传文件" icon={<X size={14}/>} onClick={()=>setFile(null)} disabled={saving}/>:null}</div>:null}
    <div className="fg-company-form-grid"><Form.Item name="category" label="用途分类" rules={[{required:true}]}><Select options={categories}/></Form.Item><Form.Item name="brand" label="品牌 / 系列"><AutoComplete options={[...options("brand"),{value:"贝瓦"}]} placeholder="贝瓦、Grimmverse 或自定义"/></Form.Item><Form.Item name="character" label="角色"><Input placeholder="例如：贝瓦、贝拉"/></Form.Item><Form.Item name="style" label="视觉风格"><AutoComplete options={[{value:"羊毛毡"},{value:"2D"},{value:"3D"},{value:"真人"},...options("style")]} placeholder="选择或输入风格"/></Form.Item><Form.Item name="view" label="视图 / 声线特征"><Input placeholder="三视图、正面、童声、温暖女声…"/></Form.Item></div>
    <Form.Item name="note" label="素材说明"><Input.TextArea rows={3} maxLength={4000} placeholder="角色设定、用途、声音特征和使用注意事项"/></Form.Item>
   </Form>
  </AppModal>
  <AppModal open={!!preview} title={preview?.title} width={860} onCancel={()=>setPreview(null)} footer={preview?.status==="active"?<Button type="primary" loading={using===preview.id} onClick={()=>void use(preview)}>加入我的素材</Button>:null}>{preview?<><div className="fg-company-preview-wrap"><CompanyMedia item={preview} large/></div><p>{[preview.brand,preview.character,preview.style,preview.view].filter(Boolean).join(" · ")}</p><p className="whitespace-pre-wrap">{preview.note}</p></>:null}</AppModal>
 </WorkspacePage>;
}
