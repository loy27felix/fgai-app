// Targeted, repeatable update: preserve credentials, enabled flags, routing and prices.
// Run in the existing FG gateway. Capture stdout to a private FG backup before use.
import fs from 'node:fs/promises';
import pg from 'pg';
import {isDeepStrictEqual} from 'node:util';
import {capabilities} from './fg-model-capabilities.mjs';
import {withNativeAdmin} from './native-admin.mjs';

const keys=['wan3.0-video','gpt-image-2','gpt-image-2.5-flare','gpt-image-2.5-sunburst'];
// Saving a capability increments priceVersion/updatedAt even with unchanged rates.
const priceContract=tiers=>(tiers||[]).map(t=>Object.fromEntries(['resolution','videoSeconds','providerModelKey','billingMode','unitPriceMicrocredits','inputTokenPriceMicrocredits','outputTokenPriceMicrocredits','cachedTokenPriceMicrocredits','priceConfigured','enabled','costPricing'].map(k=>[k,t[k]])));
// Native normalization adds optional defaults; do not rewrite an already matching profile.
const profileMatches=(expected,value)=>Object.entries(expected).every(([key,want])=>want&&typeof want==='object'&&!Array.isArray(want)?profileMatches(want,value?.[key]):isDeepStrictEqual(want,value?.[key]));
const specs=JSON.parse(await fs.readFile(new URL('./model-specs.json',import.meta.url),'utf8'));
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2});
try{
 await withNativeAdmin(pool,async api=>{
  const channels=(await api('/admin/channels?limit=100')).channels;
  const channel=channels.find(c=>c.name==='WeToken · FG 制作');
  if(!channel)throw new Error('Existing FG channel required; no channel will be created');
  const models=(await api('/admin/channels/'+channel.id+'/models')).models;
  const targets=keys.map(key=>{
   const model=models.find(m=>m.modelKey===key),spec=specs.find(s=>s.id===key);
   if(!model||!spec||model.protocol!==spec.protocol)throw new Error('Verified model contract required: '+key);
   return {model,profile:capabilities(spec)};
  });
  // API model objects contain no channel API key. This line is the rollback backup.
  console.log(JSON.stringify({kind:'before',channelId:channel.id,models:targets.map(t=>t.model)}));
  for(const {model,profile} of targets){
   if(profileMatches(profile,model.capabilityConfig))continue;
   await api('/admin/channels/'+channel.id+'/models/'+model.id,'PATCH',{...model,capabilityConfig:profile});
  }
  const updated=(await api('/admin/channels/'+channel.id+'/models')).models;
  for(const {model,profile} of targets){
   const actual=updated.find(m=>m.id===model.id);
   if(!actual||actual.enabled!==model.enabled||actual.protocol!==model.protocol||actual.providerModelKey!==model.providerModelKey||!isDeepStrictEqual(priceContract(actual.priceTiers),priceContract(model.priceTiers)))throw new Error('Model settings changed unexpectedly: '+model.modelKey);
   // Server normalization may add optional defaults, but every declared field must survive.
   if(!profileMatches(profile,actual.capabilityConfig))throw new Error('Capability verification failed: '+model.modelKey);
  }
  console.log(JSON.stringify({kind:'verified',models:updated.filter(m=>keys.includes(m.modelKey)).map(m=>({model:m.modelKey,version:m.capabilityVersion,capabilityConfig:m.capabilityConfig})),paidRequests:0}));
 });
}finally{await pool.end();}
