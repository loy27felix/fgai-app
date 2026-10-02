import {useEffect,useState} from 'react';
import './fg-controls.css';
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
 const amount=quote?.estimatedCny;
 const rates=quote?.lines.flatMap(line=>[...line.matchAll(/¥([\d,.]+)/g)].slice(0,2).map(m=>Number(m[1].replaceAll(',',''))))||[];
 const rate=mode==='text'&&rates.length?`¥${Math.min(...rates).toLocaleString('zh-CN',{maximumFractionDigits:4})}–${Math.max(...rates).toLocaleString('zh-CN',{maximumFractionDigits:4})}/百万Token`:null;
 const label=quote?(amount!==null&&amount!==undefined?`${quote.estimateKind==='lower_bound'?'≥':'≈'}¥${amount.toLocaleString('zh-CN',{maximumFractionDigits:4})}${quote.estimateKind==='partial'?'起':''}`:rate||'按用量'):state.key===key&&state.error?'价格待确认':'…';
 return <span role="status" aria-label={`人民币价格 ${label}`} className="fg-price-chip nodrag nopan">{label}</span>;
}
