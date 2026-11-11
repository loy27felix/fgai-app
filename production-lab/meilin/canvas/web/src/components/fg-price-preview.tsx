import {useEffect,useState} from 'react';
import './fg-controls.css';
import {http} from '@/services/api/request';
import {modelOptionName,resolveModelChannel,type AiConfig,type ModelCapability} from '@/stores/use-config-store';
import {modelRequestOptions,resolveVideoOperationForModel,type ModelRequirements} from '@/lib/model-selection';
export type Quote={model:string;estimatedCny:number|null;estimateKind?:'estimate'|'partial'|'lower_bound';discount:number|null;fx:number;lines:string[];notes:string[];collectedAt:string};
export function fgQuotePriceLabel(quote: Pick<Quote,'estimatedCny'|'estimateKind'|'lines'>, mode?:ModelCapability){
 const amount=quote.estimatedCny;
 if(amount!==null&&amount!==undefined)return `${quote.estimateKind==='lower_bound'?'≥':'≈'}¥${amount.toLocaleString('zh-CN',{maximumFractionDigits:4})}${quote.estimateKind==='partial'?'起':''}`;
 const rates=quote.lines.filter(line=>/百万\s*Tokens?/i.test(line)).flatMap(line=>[...line.matchAll(/¥([\d,.]+)/g)].map(m=>Number(m[1].replaceAll(',','')))).filter(Number.isFinite);
 return (mode==='text'||mode==='image')&&rates.length?`¥${Math.min(...rates).toLocaleString('zh-CN',{maximumFractionDigits:4})}–${Math.max(...rates).toLocaleString('zh-CN',{maximumFractionDigits:4})}/百万Token`:'按用量';
}
export function fgModelQuoteRequest(config:AiConfig,model:string,mode?:ModelCapability,requirements?:ModelRequirements){
 const channel=resolveModelChannel(config,model),input=requirements?.input;
 const enabled=channel.scope==='system'&&['text','image','video'].includes(mode||'');
 return enabled?{channelId:channel.id,modelKey:modelOptionName(model),referenceVideoSeconds:requirements?.referenceVideoSeconds,intent:{capability:mode,
  operation:mode==='video'&&input?resolveVideoOperationForModel(config,model,input,requirements?.videoOperation):mode==='image'?(input?.imageCount?'image_to_image':'text_to_image'):undefined,
  inputs:{image:(input?.imageCount||0)+(input?.characterCount||0),video:input?.videoCount||0,audio:input?.audioCount||0},
  options:{...modelRequestOptions(config,mode!),...requirements?.options,...(requirements?.imageSize?{size:requirements.imageSize}:{}),...(requirements?.videoSeconds?{videoSeconds:Number(requirements.videoSeconds)}:{})}}}:null;
}
export function FGPricePreview({config,model,mode,requirements,onQuote}:{config:AiConfig;model:string;mode?:ModelCapability;requirements?:ModelRequirements;onQuote?:(quote?:Quote)=>void}){
 const payload=fgModelQuoteRequest(config,model,mode,requirements),enabled=Boolean(payload);
 const key=JSON.stringify(payload),[state,setState]=useState<{key:string;quote?:Quote;error?:string}>({key:''});
 useEffect(()=>{
  if(key==='null')return;
  onQuote?.(undefined);
  let active=true;const controller=new AbortController();
  const timer=setTimeout(()=>{void http.post<Quote>('/fg/models/quote',JSON.parse(key),{signal:controller.signal}).then(quote=>{if(active){setState({key,quote});onQuote?.(quote);}}).catch(error=>{if(active)setState({key,error:error instanceof Error?error.message:'费率暂不可用'});});},250);
  return()=>{active=false;clearTimeout(timer);controller.abort();};
 },[key]);
 if(!enabled)return null;
 const quote=state.key===key?state.quote:undefined;
 const label=quote?fgQuotePriceLabel(quote,mode):state.key===key&&state.error?'价格待确认':'…';
 return <span role="status" aria-label={`人民币价格 ${label}`} title={quote?[...quote.lines,...quote.notes].join('\n'):undefined} className="fg-price-chip nodrag nopan">{label}</span>;
}
