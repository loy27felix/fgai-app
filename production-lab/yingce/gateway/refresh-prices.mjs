import pg from 'pg';import fs from 'node:fs/promises';
import {extendObservedSeedPrices} from './fg-observed-seed-prices.mjs';
const chunks=[];for await(const c of process.stdin)chunks.push(c);
const config=JSON.parse(Buffer.concat(chunks));const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2});
try{
 const [catalog,pricing]=await Promise.all([fetch(config.baseUrl.replace(/\/$/,'')+'/models',{headers:{authorization:'Bearer '+config.apiKey},signal:AbortSignal.timeout(30000)}),fetch('https://wetoken.ai/api/pricing',{signal:AbortSignal.timeout(30000)})]);
 if(!catalog.ok||!pricing.ok)throw new Error('Live pricing or key catalog unavailable; old snapshot preserved');
 const c=new Map((await catalog.json()).data.map(x=>[x.id,x])),p=new Map((await pricing.json()).data.map(x=>[x.model_name,x]));
 const specs=JSON.parse(await fs.readFile(new URL('./model-specs.json',import.meta.url)));
 const configured=new Map((await pool.query("SELECT m.model_key,m.enabled FROM channel_models m JOIN model_channels c ON c.id=m.channel_id WHERE c.name='WeToken · FG 制作'")).rows.map(x=>[x.model_key,x.enabled]));
 for(const spec of specs){
  if(!p.has(spec.id))throw new Error('Missing authoritative price '+spec.id);
  const snapshot={...p.get(spec.id),discount:c.get(spec.id)?.discount_ratio??null,keyCatalogListed:c.has(spec.id),enabled:c.has(spec.id)&&configured.get(spec.id)===true};
  if(spec.id.includes('seedance')){
   const observed=(await pool.query(`SELECT l.request_body,l.output_tokens,l.usage_available,f.usd,f.reference_id FROM api_call_logs l JOIN fg_provider_fees f ON f.model=l.model AND (l.fg_fee_reference_id=f.reference_id OR l.fg_fee_references_json::jsonb ? f.reference_id OR l.provider_request_id=f.reference_id) JOIN tasks t ON t.id=l.task_id WHERE l.model=$1 AND l.billable AND l.status='succeeded' AND t.status='succeeded' AND NOT EXISTS(SELECT 1 FROM api_call_logs other WHERE other.id<>l.id AND other.billable AND other.model=f.model AND (other.fg_fee_reference_id=f.reference_id OR other.fg_fee_references_json::jsonb ? f.reference_id OR other.provider_request_id=f.reference_id))`,[spec.id])).rows;
   extendObservedSeedPrices(snapshot,observed);
  }
  if(spec.id.startsWith('happyhorse-')){
   const rates=(await pool.query(`SELECT l.video_seconds,l.request_body,f.usd,f.reference_id FROM api_call_logs l JOIN fg_provider_fees f ON f.model=l.model AND (f.reference_id=l.provider_request_id OR l.fg_fee_references_json::jsonb ? f.reference_id) JOIN tasks t ON t.id=l.task_id WHERE l.model=$1 AND l.billable AND t.status='succeeded'`,[spec.id])).rows;
   const proof=rates.find(x=>{let b;try{b=JSON.parse(x.request_body);}catch{return false;}const row=snapshot.pricing_rules?.rules?.find(r=>r.resolution.toLowerCase()===String(b.parameters?.resolution).toLowerCase());return row&&Math.abs(Number(x.usd)-row.price*x.video_seconds*snapshot.discount)<0.000001;});
   if(proof){snapshot.verifiedBillingUnit='per_second';snapshot.billingUnitReceipt=proof.reference_id;}
  }
  if(spec.id==='wan2.7-image-pro'){
   const observed=(await pool.query(`SELECT f.usd,f.reference_id,l.request_body,t.result_json FROM api_call_logs l JOIN fg_provider_fees f ON f.model=l.model AND l.fg_fee_references_json::jsonb ? f.reference_id JOIN tasks t ON t.id=l.task_id WHERE l.model=$1 AND l.billable AND t.status='succeeded'`,[spec.id])).rows;
   snapshot.observedImagePrices=observed.flatMap(x=>{let b,r;try{b=JSON.parse(x.request_body);r=JSON.parse(x.result_json);}catch{return [];}
    const images=r.images;if(b.parameters?.n!==1||images?.length!==1||!images[0].width||!images[0].height||!snapshot.discount)return [];
    return [{size:images[0].width+'x'+images[0].height,usd:Number(x.usd),referenceId:x.reference_id}];
   });
   snapshot.priceConflict=snapshot.observedImagePrices.some(x=>Math.abs(x.usd-snapshot.model_price*snapshot.discount)>0.000001);
  }
  await pool.query('INSERT INTO fg_model_prices(model,snapshot,collected_at) VALUES($1,$2,now()) ON CONFLICT(model) DO UPDATE SET snapshot=excluded.snapshot,collected_at=now()',[spec.id,JSON.stringify(snapshot)]);
 }
 console.log(JSON.stringify({refreshedModels:specs.length,accountDiscountsLiveVerified:true}));
}finally{config.apiKey='';await pool.end();}
