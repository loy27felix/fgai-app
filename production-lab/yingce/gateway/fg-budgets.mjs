import {randomUUID,timingSafeEqual} from 'node:crypto';
import {priceQuote} from './fg-quotes.mjs';
import {estimateCNY} from './fg-prices.mjs';
const microCny=value=>Math.ceil(Number(value)*1e6-1e-8);

export function admissionPrice(model,capability,payload,price,fx){
 if(!price?.enabled)return null;
 if(capability==='text'){
  // Reserve a conservative input bound and the declared output ceiling. No
  // cached-token discount is assumed before the provider returns usage.
  const input=Buffer.byteLength(JSON.stringify(payload));
  const output=Number(payload.max_tokens||payload.max_completion_tokens||payload.max_output_tokens||payload.generationConfig?.maxOutputTokens);
  // An unbounded response or multimodal tokenization cannot supply a spending
  // ceiling. Keep uncapped use available and fail closed when a cap is set.
  if(!Number.isFinite(output)||output<=0)return null;
  const hasMedia=value=>value&&typeof value==='object'&&(Array.isArray(value)?value.some(hasMedia):Object.entries(value).some(([k,v])=>['image_url','input_image','video_url','input_audio','inline_data','inlineData','file_data','fileData'].includes(k)||(['image','input_image','video','input_video','audio'].includes(String(v))&&k==='type')||hasMedia(v)));
  if(hasMedia(payload))return null;
  const tiers=price.tiered_pricing?.length?price.tiered_pricing:[{input_price_per_m:price.pricing_rules?.input_price,output_price_per_m:price.pricing_rules?.output_price,max_input_tokens:-1}];
  const tier=tiers.find(t=>t.max_input_tokens===-1||input<=t.max_input_tokens);
  if(!tier||!Number.isFinite(tier.input_price_per_m)||!Number.isFinite(tier.output_price_per_m)||!(output>0))return null;
  return (input*tier.input_price_per_m+output*tier.output_price_per_m)/1e6*price.discount*fx;
 }
 const content=payload.content||[],images=payload.image||payload.images||payload.input?.image_urls||[],videos=content.filter(c=>c.type==='video_url');
 const inputs={image:content.filter(c=>c.type==='image_url').length+(Array.isArray(images)?images.length:images?1:0),video:videos.length};
 const options={count:String(payload.n||1),size:payload.size||payload.ratio||'16:9',quality:payload.quality,vquality:payload.resolution||payload.parameters?.resolution,videoSeconds:payload.duration||payload.parameters?.duration||payload.video_length||5};
 const result=priceQuote(model,price,{capability,operation:inputs.video?'video_to_video':inputs.image?'image_to_video':'text_to_video',inputs,options},fx);
 if(result.estimateKind==='partial'||result.estimateKind==='lower_bound')return null;
 return result.estimatedCny;
}
export async function spendUsage(pool,{userId,projectId,since}={}){
 const prices=new Map((await pool.query('SELECT model,snapshot FROM fg_model_prices')).rows.map(r=>[r.model,r.snapshot]));
 const fx=Number((await pool.query("SELECT value FROM fg_company_settings WHERE key='usdCnyRate'")).rows[0].value);
 const calls=(await pool.query(`SELECT c.*,t.status task_status,COALESCE(NULLIF(cv.project_id,''),p.id,r.project_id) project_id, COALESCE(f.cny,0) actual_cny,f.matches
 FROM api_call_logs c LEFT JOIN tasks t ON t.id=c.task_id LEFT JOIN canvas_projects cv ON cv.id=t.project_id LEFT JOIN projects p ON p.id=t.project_id
 LEFT JOIN fg_budget_reservations r ON r.id::text=c.fg_budget_reservation_id
 LEFT JOIN LATERAL(SELECT sum(f.usd*f.fx) cny,count(*) matches FROM fg_fee_matches m JOIN fg_provider_fees f ON f.reference_id=m.reference_id WHERE m.call_id=c.id) f ON true
 WHERE c.billable AND c.channel_id IN(SELECT id FROM model_channels WHERE name LIKE 'WeToken%') AND($1::text IS NULL OR c.user_id=$1) AND($2::text IS NULL OR COALESCE(NULLIF(cv.project_id,''),p.id,r.project_id)=$2) AND($3::timestamptz IS NULL OR c.created_at>=$3)`,[userId||null,projectId||null,since||null])).rows;
 let actual=0,pending=0,unknown=0;
 const reservations=(await pool.query(`SELECT r.*,c.id call_id,c.error_code FROM fg_budget_reservations r LEFT JOIN api_call_logs c ON c.fg_budget_reservation_id=r.id::text AND c.billable WHERE ($1::text IS NULL OR r.user_id=$1) AND($2::text IS NULL OR r.project_id=$2) AND($3::timestamptz IS NULL OR r.created_at>=$3)`,[userId||null,projectId||null,since||null])).rows;
 const byId=new Map(reservations.map(r=>[r.id,r]));
 for(const c of calls){
  if(Number(c.matches)>0){actual+=Number(c.actual_cny);continue;}
  if(c.error_code==='request_not_sent')continue;
  const reserved=byId.get(c.fg_budget_reservation_id)?.reserved_cny;
  const amount=reserved===null||reserved===undefined?estimateCNY(c,prices.get(c.model),fx):Number(reserved);
   if(amount!==null&&Number.isFinite(amount))pending+=amount;else unknown++;
 }
 for(const r of reservations)if(!r.call_id){if(r.reserved_cny!==null)pending+=Number(r.reserved_cny);else unknown++;}
 return {actual,pending,unknown,used:actual+pending};
}
export function monthStart(){const now=new Date();const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'}).formatToParts(now);return `${parts.find(p=>p.type==='year').value}-${parts.find(p=>p.type==='month').value}-01T00:00:00+08:00`;}
export async function reserveBudget(pool,input){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const actor=(await client.query("SELECT id FROM users WHERE id=$1 AND status='active'",[input.userId])).rows[0];if(!actor)throw Error('预算检查身份无效');
  const task=input.taskId?(await client.query('SELECT project_id FROM tasks WHERE id=$1 AND user_id=$2',[input.taskId,input.userId])).rows[0]:null;
  const projectId=task?(await client.query("SELECT COALESCE((SELECT NULLIF(project_id,'') FROM canvas_projects WHERE id=$1),(SELECT id FROM projects WHERE id=$1)) id",[task.project_id])).rows[0]?.id:null;
  await client.query("SELECT pg_advisory_xact_lock(hashtext('fg-budget-user:'||$1))",[input.userId]);
  if(projectId)await client.query("SELECT pg_advisory_xact_lock(hashtext('fg-budget-project:'||$1))",[projectId]);
  const limit=Number((await client.query('SELECT monthly_cny FROM fg_user_budgets WHERE user_id=$1',[input.userId])).rows[0]?.monthly_cny||0);
  const budget=projectId?Number((await client.query('SELECT budget_cny FROM fg_story_projects WHERE native_project_id=$1 UNION ALL SELECT budget_cny FROM fg_adcraft_workspaces WHERE native_project_id=$1',[projectId])).rows[0]?.budget_cny||0):0;
  const snapshot=(await client.query('SELECT snapshot FROM fg_model_prices WHERE model=$1',[input.model])).rows[0]?.snapshot;
  const fx=Number((await client.query("SELECT value FROM fg_company_settings WHERE key='usdCnyRate'")).rows[0].value);
  const quoted=admissionPrice(input.model,input.capability,input.payload||{},snapshot,fx);
  const amount=quoted===null?null:microCny(quoted)/1e6;
  if((limit>0||budget>0)&&(!(amount>=0)||amount===null))throw Error('本模型规格暂不能确定费用上限，限额项目中暂停提交，请联系超级管理员');
  if(limit>0){const usage=await spendUsage(client,{userId:input.userId,since:monthStart()});if(usage.unknown||microCny(usage.used)+microCny(amount)>Math.round(limit*1e6))throw Error('本月费用额度不足或有金额待确认，请联系超级管理员调整限额');}
  if(budget>0){const usage=await spendUsage(client,{projectId});if(usage.unknown||microCny(usage.used)+microCny(amount)>Math.round(budget*1e6))throw Error('项目制作预算不足或有金额待确认，请联系超级管理员调整预算');}
  const id=randomUUID();await client.query('INSERT INTO fg_budget_reservations(id,user_id,project_id,task_id,model,reserved_cny) VALUES($1,$2,$3,$4,$5,$6)',[id,input.userId,projectId,input.taskId||null,input.model,amount]);
  await client.query('COMMIT');return {id,reservedCny:amount};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
export async function budgetInternalRoute(req,res,{pool,path}){
 if(path.pathname!=='/internal/fg/budget-admission')return false;
 const expected=process.env.FG_ADCRAFT_SECRET||'',given=String(req.headers['x-fg-budget-secret']||'');
 if(req.method!=='POST'||!expected||given.length!==expected.length||!timingSafeEqual(Buffer.from(given),Buffer.from(expected))){res.writeHead(403);res.end();return true;}
 try{let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>32<<20)throw Error('预算检查请求过大');chunks.push(chunk);}const data=await reserveBudget(pool,JSON.parse(Buffer.concat(chunks)));res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(data));}
 catch(e){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:String(e.message)}));}return true;
}
