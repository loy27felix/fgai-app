import {capabilities} from './fg-model-capabilities.mjs';
import {priceQuote} from './fg-quotes.mjs';
import {speechModels,speechUtilities} from './fg-speech-provider.mjs';

const companyAudio=[...speechModels,...speechUtilities,{id:'suno-company-music',capability:'audio',profile:{version:1}}];

export function modelPriceRows(prices,specs,evidence,fx){
 return prices.map(p=>{
  const spec=specs.find(s=>s.id===p.model);
  const audio=companyAudio.find(s=>s.id===p.model);
  const capability=spec?.capability||audio?.capability||'unknown';
  // Speech and music are configured outside the WeToken model-specs catalog.
  // Unknown entries stay visible without inventing video parameter support.
  const profile=spec?capabilities(spec):audio?.profile||{version:1};
  const options=profile.image?{size:profile.image.size.default,quality:profile.image.quality.default,count:1}
   :profile.video?{size:profile.video.defaultRatio,vquality:profile.video.defaultResolution,videoSeconds:Math.min(...profile.video.duration.values)}:{};
  const quote=priceQuote(p.model,p.snapshot,{capability,options,inputs:{}},fx);
  if(p.snapshot?.provider==='suno'){
   quote.discount=null;quote.estimateKind='unknown';
   quote.notes=['公司 Suno 订阅向用户开放；订阅额度与供应商费用单独确认，不套用 WeToken 费率。'];
  }
  if(!spec&&!audio){
   quote.discount=null;quote.estimatedCny=null;quote.estimateKind='unknown';
   quote.notes=['模型能力与费率尚未确认，请由管理员核对渠道配置。'];
  }
  return {model:p.model,capability,enabled:!!p.snapshot?.enabled&&(!!spec||!!audio),
   collectedAt:p.collected_at,profile,quote,
   evidence:evidence.filter(e=>e.model===p.model||e.model?.endsWith('::'+p.model))
    .map(e=>({operation:e.operation,status:e.status,error:e.error,updatedAt:e.updated_at}))};
 });
}
