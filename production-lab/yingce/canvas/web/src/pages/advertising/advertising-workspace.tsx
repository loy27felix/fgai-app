import {useEffect,useState} from 'react';
import {App,Button,InputNumber,Select,Spin} from 'antd';
import {ArrowLeft,ArrowUpRight,Library,Wallet} from 'lucide-react';
import {Link} from 'react-router';
import {WorkspacePage} from '@/components/layout/workspace-page';
import {AppModal} from '@/components/ui/product/app-modal';
import {advertisingQuote,importAdvertisingCompanyAsset,openAdvertisingProject,updateAdvertisingBudget,type AdvertisingProject} from '@/services/api/fg-advertising';
import {listCompanyAssets,type CompanyAsset} from '@/services/api/fg-company-assets';

const money=(value:number)=>'¥'+value.toLocaleString('zh-CN',{maximumFractionDigits:4});
export function AdvertisingWorkspace({project,onBack,onRefresh}:{project:AdvertisingProject;onBack:()=>void;onRefresh:()=>Promise<void>}){
 const {message}=App.useApp();const [url,setURL]=useState('');const [error,setError]=useState('');
 const [budgetOpen,setBudgetOpen]=useState(false);const [budget,setBudget]=useState(Number(project.budget_cny));
 const [assetsOpen,setAssetsOpen]=useState(false);const [assets,setAssets]=useState<CompanyAsset[]>([]);const [assetId,setAssetId]=useState<string>();const [busy,setBusy]=useState(false);
 const [prices,setPrices]=useState<string[]>([]);
 useEffect(()=>{let cancelled=false;void openAdvertisingProject(project.id).then(r=>{if(!cancelled)setURL(r.url);}).catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:'广告工程启动失败');});
  void Promise.all([advertisingQuote(project.id,'text'),advertisingQuote(project.id,'image',{size:'2048x2048'}),advertisingQuote(project.id,'video',{size:'16:9',vquality:'480P',videoSeconds:'5'})]).then(([text,image,video])=>{if(!cancelled)setPrices(['GPT 5.6 · '+(text.lines[0]||'价格暂不可用'),'Seedream Lite · '+(image.estimatedCny===null?'价格暂不可用':money(image.estimatedCny)+'/张'),'SD2-fast · '+(video.estimatedCny===null?'价格暂不可用':money(video.estimatedCny)+'/5秒 · 480P')]);}).catch(()=>{});
  return()=>{cancelled=true;};
 },[project.id]);
 return <WorkspacePage fluid scroll={false} className="fg-advertising-workbench"><div className="fg-advertising-frame-shell">
  <header className="fg-advertising-frame-header"><Button icon={<ArrowLeft size={15}/>} onClick={onBack}>广告项目</Button><div className="min-w-0 flex-1"><strong className="block truncate">{project.name}</strong><span className="text-xs opacity-60">{project.group_name||'个人项目'} · {project.owner_name} · 预算 {money(Number(project.budget_cny))}</span></div>
   <Button disabled={!url} icon={<Library size={15}/>} onClick={async()=>{try{const result=await listCompanyAssets({pageSize:120});setAssets(result.assets);setAssetId(undefined);setAssetsOpen(true);}catch(e){message.error(e instanceof Error?e.message:'公司素材读取失败');}}}>公司素材</Button>
   {project.can_manage?<Button icon={<Wallet size={15}/>} onClick={()=>{setBudget(Number(project.budget_cny));setBudgetOpen(true);}}>预算</Button>:null}<Link to="/fg-finance" className="shrink-0 text-xs">制作费用 <ArrowUpRight className="inline size-3.5"/></Link>
  </header>{prices.length?<div className="fg-advertising-prices">{prices.map(price=><span key={price}>{price}</span>)}</div>:null}
  {url?<iframe key={url} className="fg-advertising-frame" title={'广告制作 · '+project.name} src={url} allow="clipboard-read; clipboard-write; fullscreen" allowFullScreen/>:error?<p role="alert" className="p-6">{error}</p>:<Spin className="p-12"/>}
 </div>
 <AppModal title="项目制作预算" open={budgetOpen} onCancel={()=>setBudgetOpen(false)} confirmLoading={busy} okText="保存预算" onOk={async()=>{try{setBusy(true);await updateAdvertisingBudget(project.id,budget);await onRefresh();setBudgetOpen(false);}catch(e){message.error(e instanceof Error?e.message:'预算修改失败');}finally{setBusy(false);}}}><p className="mb-4 text-sm opacity-60">预算由项目负责人或超级管理员管理。</p><InputNumber min={0.01} max={1000000} precision={2} prefix="¥" value={budget} onChange={v=>setBudget(Number(v)||0)} style={{width:'100%'}}/></AppModal>
 <AppModal title="从公司素材库导入" open={assetsOpen} onCancel={()=>setAssetsOpen(false)} confirmLoading={busy} okText="导入项目素材" onOk={async()=>{if(!assetId){message.info('请选择素材');return;}try{setBusy(true);await importAdvertisingCompanyAsset(project.id,assetId);setAssetsOpen(false);message.success('已保存到广告项目素材库，可在素材侧栏刷新查看');}catch(e){message.error(e instanceof Error?e.message:'素材导入失败');}finally{setBusy(false);}}}><p className="mb-4 text-sm opacity-60">选择角色、场景、视频或声线，保留在本项目中使用。</p><Select showSearch optionFilterProp="label" placeholder={assets.length?'搜索素材、角色或风格':'公司素材库暂无素材'} value={assetId} onChange={setAssetId} options={assets.map(a=>({value:a.id,label:[a.title,a.brand,a.style,a.kind==='audio'?'音频':a.kind==='video'?'视频':'图片'].filter(Boolean).join(' · ')}))} style={{width:'100%'}}/></AppModal>
 </WorkspacePage>;
}
