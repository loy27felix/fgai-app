import {useEffect,useState} from 'react';
import {Tooltip} from 'antd';
import {CircleDollarSign} from 'lucide-react';
import {http} from '@/services/api/request';
import {modelOptionName,resolveModelChannel,type AiConfig,type ModelCapability} from '@/stores/use-config-store';
import {modelRequestOptions,resolveVideoOperationForModel,type ModelRequirements} from '@/lib/model-selection';
type Quote={model:string;estimatedCny:number|null;estimateKind?:'estimate'|'partial'|'lower_bound';discount:number|null;fx:number;lines:string[];notes:string[];collectedAt:string};
export function FGPricePreview({config,model,mode,requirements}:{config:AiConfig;model:string;mode?:ModelCapability;requirements?:ModelRequirements}){
 const channel=resolveModelChannel(config,model),input=requirements?.input;
 const enabled=channel.scope==='system'&&/^WeToken/.test(channel.name||'')&&['text','image','video'].includes(mode||'');
 const payload=enabled?{channelId:channel.id,modelKey:modelOptionName(model),referenceVideoSeconds:requirements?.referenceVideoSeconds,intent:{capability:mode,
  operation:mode==='video'&&input?resolveVideoOperationForModel(config,model,input,requirements?.videoOperation):mode==='image'?(input?.imageCount?'image_to_image':'text_to_image'):undefined,
  inputs:{image:(input?.imageCount||0)+(input?.characterCount||0),video:input?.videoCount||0,audio:input?.audioCount||0},
  options:{...modelRequestOptions(config,mode!),...requirements?.options,...(requirements?.imageSize?{size:requirements.imageSize}:{}),...(requirements?.videoSeconds?{videoSeconds:Number(requirements.videoSeconds)}:{})}}}:null;
 const key=JSON.stringify(payload),[state,setState]=useState<{key:string;quote?:Quote;error?:string}>({key:''});
 useEffect(()=>{
  if(key==='null')return;
  let active=true;const controller=new AbortController();
  const timer=setTimeout(()=>{void http.post<Quote>('/fg/models/quote',JSON.parse(key),{signal:controller.signal}).then(quote=>{if(active)setState({key,quote});}).catch(error=>{if(active)setState({key,error:error instanceof Error?error.message:'费率暂不可用'});});},250);
  return()=>{active=false;clearTimeout(timer);controller.abort();};
 },[key]);
 if(!enabled)return null;
 const quote=state.key===key?state.quote:undefined;
 const detail=quote?<div style={{maxWidth:420,lineHeight:1.8}}>{quote.lines.map((line,i)=><div key={'r'+i}>{line}</div>)}{quote.notes.map((note,i)=><div key={'n'+i}>{note}</div>)}<div>账户折扣 {((quote.discount||1)*100).toLocaleString()}% · 人民币换算系数 {quote.fx}</div><div>费率采集 {new Date(quote.collectedAt).toLocaleString('zh-CN')}</div></div>:state.key===key?state.error:'正在核对当前参数的费率';
 const prefix=quote?.estimateKind==='partial'?'图片输出部分':quote?.estimateKind==='lower_bound'?'公式部分（非最终金额）':'预计';
 return <div role="status" className="nodrag nopan" style={{padding:'7px 10px',fontSize:12,lineHeight:1.7,color:'var(--user-muted, inherit)',overflowWrap:'anywhere'}}>
  <Tooltip title={detail}><div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}><CircleDollarSign size={14}/><strong>{quote?(quote.estimatedCny===null?'按实际用量计费':`${prefix} ¥${quote.estimatedCny.toLocaleString('zh-CN',{maximumFractionDigits:4})}`):state.key===key&&state.error?'费率待核验':'核对费率中…'}</strong><span>WeToken · 实扣见费用对账</span></div></Tooltip>
  {quote?<details><summary style={{cursor:'pointer'}}>人民币费率与计费说明</summary>{detail}</details>:state.key===key&&state.error?<div>{state.error}</div>:null}
  {quote?.estimateKind&&quote.estimateKind!=='estimate'?<div>{quote.notes.find(note=>note.includes('另计')||note.includes('最低 Token'))}</div>:null}
 </div>;
}
