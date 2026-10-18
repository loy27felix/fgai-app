import http from 'node:http';
import {pipeline} from 'node:stream';
import {createHmac,createHash,timingSafeEqual} from 'node:crypto';
import {advertisingModels,selectedAdvertisingModel,companyModelChannel} from './fg-adcraft-models.mjs';
import {creatorGenerationConfig,creatorMediaOperation} from './fg-creator-config.mjs';
import {priceQuote} from './fg-quotes.mjs';
import {monthStart,spendUsage} from './fg-budgets.mjs';
import {estimateCNY} from './fg-prices.mjs';
import {responseHeaders} from './policy.mjs';

const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const secret=()=>process.env.MEILIN_INTERNAL_SECRET||'';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sign=(key,value)=>createHmac('sha256',key).update(value).digest('hex');
export function meilinHeaders(actor,method,path,key=secret()){
 if(!key||!uuid.test(actor?.id))throw Error('美林内部身份未配置');
 const encoded=Buffer.from(JSON.stringify(actor)).toString('base64url'),time=String(Date.now());
 return {'x-fg-meilin-actor':encoded,'x-fg-meilin-time':time,'x-fg-meilin-signature':sign(key,[encoded,time,method,path].join('\n'))};
}
function verify(req,path,owner){
 const encoded=req.headers['x-fg-meilin-actor'],time=req.headers['x-fg-meilin-time'],given=req.headers['x-fg-meilin-signature'];
 if(!secret()||typeof encoded!=='string'||!/^\d+$/.test(time||'')||Math.abs(Date.now()-Number(time))>60000||!/^[a-f0-9]{64}$/.test(given||''))throw Error('美林内部调用未授权');
 const expected=sign(secret(),[encoded,time,req.method,path].join('\n'));
 if(!timingSafeEqual(Buffer.from(given),Buffer.from(expected)))throw Error('美林内部调用未授权');
 const a=JSON.parse(Buffer.from(encoded,'base64url').toString());if(a.id!==owner)throw Error('账号不匹配');return a;
}
export const meilinEnabled=(flags,actor)=>(flags?.features||flags)?.meilinEnabled===true||actor?.reviewer===true;
const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));};
async function body(req){let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>36*1024*1024)throw Error('请求过大');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString()||'{}');}
export async function initializeMeilin(pool){await pool.query(`
 CREATE TABLE IF NOT EXISTS fg_meilin_projects(drama_id uuid NOT NULL,owner_id varchar(36) NOT NULL REFERENCES users(id),native_project_id varchar(36) NOT NULL UNIQUE REFERENCES projects(id),PRIMARY KEY(drama_id,owner_id));
 CREATE TABLE IF NOT EXISTS fg_meilin_calls(operation_id uuid PRIMARY KEY,drama_id uuid NOT NULL,actor_id varchar(36) NOT NULL REFERENCES users(id),request_hash text NOT NULL,task_id varchar(36),metadata jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
 CREATE INDEX IF NOT EXISTS fg_meilin_call_drama ON fg_meilin_calls(drama_id,created_at);
 `);}
export function meilinTaskInput(selected,channel,request,drama,refs){
 const mode=request.kind,p=request.payload||{},options=mode==='text'?{}:creatorGenerationConfig(selected,p,mode),operation=creatorMediaOperation(selected,p,mode);
 const prompt=mode==='text'?'美林导演文本任务':p.prompt;
 const maxTokens=Math.min(32768,Math.max(1,Number(p.max_tokens)||8000));
 return {type:'canvas_'+mode,model:selected.billingId,operation,prompt,input:{mode,prompt,
  config:{channelId:channel.id||channel.channel_id,model:selected.billingId,interfaceType:channel.protocol,apiFormat:channel.api_format||'openai',count:'1',...options},
  ...(mode==='text'?{agentRequests:{chatCompletion:{...p,model:selected.billingId,stream:true,max_tokens:maxTokens}},textOptions:{stream:true,maxOutputTokens:maxTokens}}:{referenceImages:refs.image||[],referenceVideos:refs.video||[],referenceAudios:refs.audio||[]}),
  metadata:{source:'fg-meilin',clientOperationId:'meilin-'+request.operationId,meilinDramaId:drama,...request.metadata}}};
}
async function ownerAPI(pool,id,ctx){
 const actor=(await pool.query("SELECT u.id,u.display_name name,a.email,a.platform_role FROM users u JOIN fg_accounts a ON a.user_id=u.id WHERE u.id=$1 AND u.status='active'",[id])).rows[0];
 if(!actor)throw Error('FG 账号不可用');
 const cookie=await ctx.canvasSession({...actor,reviewer:actor.platform_role==='superadmin',platformRole:actor.platform_role});
 const api=async(path,method='GET',data)=>{const r=await fetch(new URL('/api'+path,ctx.web),{method,headers:{cookie,origin:ctx.publicOrigin,'content-type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(120000)});const b=await r.json();if(!r.ok||b.code!==0){const e=Error(b.msg||'FG 制作服务暂不可用');e.status=r.status;throw e;}return b.data;};
 return {api,cookie,actor};
}
async function accessible(pool,drama,actor,write){
 const d=(await pool.query(`SELECT d.owner_id,m.role FROM fg_meilin_dramas d LEFT JOIN fg_meilin_members m ON m.drama_id=d.id AND m.user_id=$2 WHERE d.id=$1 AND d.deleted_at IS NULL AND (d.owner_id=$2 OR m.role IS NOT NULL)`,[drama,actor])).rows[0];
 if(!d||(write&&d.owner_id!==actor&&d.role!=='editor'))throw Error('剧目不存在或无权执行此操作');return d;
}
async function project(pool,drama,owner,api){
 const client=await pool.connect();try{await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('meilin-project:'||$1))",[drama]);
 let p=(await client.query('SELECT native_project_id FROM fg_meilin_projects WHERE drama_id=$1 AND owner_id=$2',[drama,owner])).rows[0];
 if(!p){
  // Recover project creation when its response or the mapping transaction was
  // lost; FG enforces a per-owner unique name for this stable drama UUID.
  const existing=(await client.query("SELECT id FROM projects WHERE user_id=$1 AND name=$2 AND type='creator' AND status='active'",[owner,'美林 · 超级导演 · '+drama.toLowerCase()])).rows[0];
  const data=existing?{project:existing}:await api('/meilin/billing-project','POST',{dramaId:drama});
  p={native_project_id:data.project.id};await client.query('INSERT INTO fg_meilin_projects(drama_id,owner_id,native_project_id) VALUES($1,$2,$3)',[drama,owner,p.native_project_id]);
 }
 await client.query('COMMIT');return p.native_project_id;
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
async function uploadReference(ref,owner,ctx,projectId,drama){
 let bytes,mime;
 if(ref.resourceId){
  const found=(await ctx.pool.query(`SELECT id FROM resources WHERE id=$1 AND user_id=$2`,[ref.resourceId,owner.actor.id])).rows[0];if(found)return {id:found.id,storageKey:'resource:'+found.id,name:ref.name||'参考',type:ref.mime};
  const source=(await ctx.pool.query('SELECT * FROM fg_meilin_calls WHERE drama_id=$1 AND task_id=$2',[drama,ref.sourceTaskId])).rows[0];if(!source)throw Error('引用素材不属于此剧');
  const view=await taskView(ctx.pool,source,ctx);if(view.result?.resourceId!==ref.resourceId)throw Error('素材与生成结果不匹配');
  const producer=await ownerAPI(ctx.pool,source.actor_id,ctx),access=await producer.api('/resources/access','POST',[{resourceId:ref.resourceId,purpose:'copy',variant:'original'}]),url=new URL(access.items?.[0]?.access?.url,ctx.web);
  const response=await fetch(new URL(url.pathname+url.search,ctx.web));if(!response.ok)throw Error('共享素材暂不可读');mime=response.headers.get('content-type')?.split(';')[0];bytes=Buffer.from(await response.arrayBuffer());
 }else{
  const m=/^data:([^;]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(ref.dataUrl||'');if(!m)throw Error('请上传合法参考素材，不读取任意外部 URL');mime=m[1];bytes=Buffer.from(m[2],'base64');
 }
 if(!mime?.startsWith(ref.kind+'/'))throw Error('参考素材类型不匹配');if(bytes.length>25*1024*1024)throw Error('参考文件过大');
 const form=new FormData();form.set('kind',ref.kind);form.set('projectId',projectId);form.set('file',new Blob([bytes],{type:mime}),String(ref.name||'reference').slice(0,120));
 const r=await fetch(new URL('/api/resources',ctx.web),{method:'POST',headers:{cookie:owner.cookie,origin:ctx.publicOrigin,'x-idempotency-key':'meilin-ref-'+digest([owner.actor.id,bytes.toString('base64')])},body:form,signal:AbortSignal.timeout(120000)});const b=await r.json();if(!r.ok||b.code!==0)throw Error(b.msg||'素材未保存到 NAS');
 return {id:b.data.resource.id,storageKey:'resource:'+b.data.resource.id,name:ref.name||'参考',type:mime,...(ref.role?{role:ref.role}:{})};
}
async function taskView(pool,link,ctx,after){
 const owner=await ownerAPI(pool,link.actor_id,ctx),data=await owner.api('/tasks/'+link.task_id),task=data.task||data;
 let result={};if(task.status==='succeeded'){
  const raw=JSON.parse(task.resultJson||'{}');result.text=raw.text;
  const output=[...(raw.images||[]),...(raw.videos||[]),raw.image,raw.video,raw].filter(Boolean).find(v=>v.resourceId||v.storageKey);
  let resourceId=output?.resourceId||String(output?.storageKey||'').replace(/^resource:/,'');
  if(!resourceId&&raw.assetId)resourceId=(await pool.query('SELECT r.resource_id FROM asset_representations r JOIN asset_versions v ON v.id=r.asset_version_id JOIN assets a ON a.primary_version_id=v.id WHERE a.id=$1 AND a.user_id=$2 ORDER BY r.created_at DESC LIMIT 1',[raw.assetId,link.actor_id])).rows[0]?.resource_id;
  if(resourceId)result={...result,resourceId,url:`/api/fg/meilin/dramas/${link.drama_id}/media/${link.task_id}`};
  if(!result.text&&!resourceId)return {taskId:link.task_id,status:'archiving',error:'生成已完成，等待 NAS 结果归档'};
 }
 const replay=after!==undefined&&task.type?.startsWith('canvas_text')?await owner.api('/tasks/'+link.task_id+'/text-deltas?after='+Math.max(0,Number(after)||0)):undefined;
 return {taskId:link.task_id,status:task.status,result,error:task.error||null,...(replay?{replay}:{})};
}
export async function meilinInternalRoute(req,res,ctx){
 const match=/^\/internal\/meilin\/([^/]+)\/([^/]+)\/(catalog|quote|submit|task|costs)$/.exec(ctx.path.pathname);if(!match)return false;
 try{
  const [,actorId,drama,action]=match;if(req.method!=='POST'||!uuid.test(actorId)||!uuid.test(drama))throw Error('美林内部请求无效');verify(req,ctx.path.pathname,actorId);
  const owner=await ownerAPI(ctx.pool,actorId,ctx),flags=await owner.api('/features');if(!meilinEnabled(flags,{reviewer:owner.actor.platform_role==='superadmin'}))throw Error('美林暂未开放');
  const input=await body(req),models=(await advertisingModels(ctx.pool)).filter(x=>['text','image','video'].includes(x.capability));
  if(action==='catalog'){const personal=await owner.api('/settings/personal-gpt').catch(()=>({configured:false}));json(res,200,{personalGPTConfigured:personal.configured===true,models:models.map(m=>({id:m.billingId,label:m.name,capability:m.capability,cap:m.profile})),budget:await budgetView(ctx.pool,actorId)});return true;}
  const access=await accessible(ctx.pool,drama,actorId,['submit','quote'].includes(action));
  if(action==='costs'){
   const rows=(await ctx.pool.query(`SELECT c.id,c.model,c.capability,c.status,c.input_tokens,c.output_tokens,c.cached_tokens,c.usage_available,c.media_count,c.video_seconds,c.request_body,c.response_body,c.cost_available,c.estimated_cost_micros,c.currency,c.fg_fee_reference_id,c.provider_request_id,m.metadata,m.task_id, COALESCE(f.settled_cny,CASE WHEN rd.call_id IS NOT NULL THEN 0 END) settled_cny FROM fg_meilin_calls m JOIN api_call_logs c ON c.task_id=m.task_id AND c.billable LEFT JOIN LATERAL(SELECT sum(p.usd*p.fx) settled_cny FROM fg_fee_matches fm JOIN fg_provider_fees p ON p.reference_id=fm.reference_id WHERE fm.call_id=c.id) f ON true LEFT JOIN fg_request_decisions rd ON rd.call_id=c.id WHERE m.drama_id=$1 ORDER BY m.created_at`,[drama])).rows;
   const prices=new Map((await ctx.pool.query('SELECT model,snapshot FROM fg_model_prices')).rows.map(x=>[x.model,x.snapshot]));const fx=await rate(ctx.pool);
   json(res,200,{calls:rows.map(c=>{const estimatedCny=estimateCNY(c,prices.get(c.model),fx);const {request_body,response_body,...safe}=c;return {...safe,estimatedCny,settledCny:c.settled_cny===null?null:Number(c.settled_cny)};}),budget:await budgetView(ctx.pool,actorId)});return true;
  }
  if(action==='task'){
   const link=(await ctx.pool.query('SELECT * FROM fg_meilin_calls WHERE drama_id=$1 AND task_id=$2',[drama,input.taskId])).rows[0];if(!link)throw Error('任务不属于此剧');json(res,200,await taskView(ctx.pool,link,ctx,input.after));return true;
  }
  // Resume an admitted operation before checking today's model catalog. A
  // disabled model blocks new admission, not recovery of already-created work.
  if(action==='submit'){
   if(!uuid.test(input.operationId))throw Error('缺少稳定的生成操作标识');
   const prior=(await ctx.pool.query('SELECT * FROM fg_meilin_calls WHERE operation_id=$1',[input.operationId])).rows[0];
   if(prior){
    if(prior.request_hash!==digest(input)||prior.drama_id!==drama||prior.actor_id!==actorId)throw Error('操作编号已用于不同请求，拒绝重复扣费');
    if(!prior.task_id){
     prior.task_id=(await ctx.pool.query("SELECT t.id FROM tasks t JOIN fg_meilin_projects p ON p.native_project_id=t.project_id WHERE t.user_id=$1 AND p.drama_id=$2 AND p.owner_id=$1 AND t.input_json::jsonb #>> '{metadata,clientOperationId}'=$3 LIMIT 1",[actorId,drama,'meilin-'+input.operationId])).rows[0]?.id;
     if(!prior.task_id)throw Error('原请求已登记，等待恢复，未重新提交');
     await ctx.pool.query('UPDATE fg_meilin_calls SET task_id=$2 WHERE operation_id=$1',[input.operationId,prior.task_id]);
    }
    json(res,200,{taskId:prior.task_id,status:'queued'});return true;
   }
  }
  const selected=await selectedAdvertisingModel(ctx.pool,input.kind,input.model),payload=input.payload||{},refs=input.references||[];
  const config=input.kind==='text'?{}:creatorGenerationConfig(selected,payload,input.kind);
  const refCount=kind=>refs.filter(r=>r.kind===kind).length;
  if(input.kind!=='text')for(const [kind,key] of [['image','maxImages'],['video','maxVideos'],['audio','maxAudios']])if(refCount(kind)>(selected.profile[input.kind].references[key]||0))throw Error('参考素材数量超过当前模型上限');
  const operation=input.kind==='video'?creatorMediaOperation(selected,{...payload,content:refs.map(r=>({type:r.kind+'_url',role:r.role}))},'video'):input.kind;
  const intent={capability:input.kind,operation,options:config,inputs:{text:1,image:refCount('image'),video:refCount('video'),audio:refCount('audio')}};
  const price=(await ctx.pool.query('SELECT snapshot FROM fg_model_prices WHERE model=$1',[selected.billingId])).rows[0]?.snapshot;
  const quote=priceQuote(selected.billingId,price,intent,await rate(ctx.pool));
  if(action==='quote'){json(res,200,{...quote,budget:await budgetView(ctx.pool,actorId)});return true;}
  if(!uuid.test(input.operationId))throw Error('缺少稳定的生成操作标识');
  // Native projects are owner-scoped. Each contributor gets a billing project,
  // while the stable drama metadata joins all costs without impersonating peers.
  const projectId=await project(ctx.pool,drama,actorId,owner.api);
  const hash=digest(input),client=await ctx.pool.connect();let link,fresh=false;
  try{await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('meilin-op:'||$1))",[input.operationId]);link=(await client.query('SELECT * FROM fg_meilin_calls WHERE operation_id=$1',[input.operationId])).rows[0];
   if(link&&(link.request_hash!==hash||link.drama_id!==drama||link.actor_id!==actorId))throw Error('操作编号已用于不同请求，拒绝重复扣费');
   if(!link){fresh=true;link={operation_id:input.operationId,actor_id:actorId,drama_id:drama};await client.query('INSERT INTO fg_meilin_calls(operation_id,drama_id,actor_id,request_hash,metadata) VALUES($1,$2,$3,$4,$5)',[input.operationId,drama,actorId,hash,input.metadata||{}]);}await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  if(!link.task_id&&!fresh){link.task_id=(await ctx.pool.query("SELECT id FROM tasks WHERE user_id=$1 AND project_id=$2 AND input_json::jsonb #>> '{metadata,clientOperationId}'=$3 LIMIT 1",[actorId,projectId,'meilin-'+input.operationId])).rows[0]?.id;if(!link.task_id)throw Error('原请求已登记，等待恢复，未重新提交');}
  if(!link.task_id){
   let sending=false;
   try{
   const references={image:[],video:[],audio:[]};for(const ref of refs)references[ref.kind].push(await uploadReference(ref,owner,ctx,projectId,drama));
   const channel=await companyModelChannel(ctx.pool,selected.billingId);if(!channel)throw Error('公司模型暂不可用');
   sending=true;const task=await owner.api('/tasks','POST',{projectId,...meilinTaskInput(selected,channel,{...input,payload:{...payload,operation}},drama,references)});link.task_id=task.id;
   }catch(error){if(!sending||(error.status>=400&&error.status<500))await ctx.pool.query('DELETE FROM fg_meilin_calls WHERE operation_id=$1 AND task_id IS NULL',[input.operationId]);throw error;}
  }
  await ctx.pool.query('UPDATE fg_meilin_calls SET task_id=$2 WHERE operation_id=$1',[input.operationId,link.task_id]);json(res,200,{taskId:link.task_id,status:'queued'});
 }catch(e){json(res,400,{error:e.message});}return true;
}
async function rate(pool){const n=Number((await pool.query("SELECT value FROM fg_company_settings WHERE key='usdCnyRate'")).rows[0]?.value);if(!(n>0))throw Error('公司汇率未配置');return n;}
async function budgetView(pool,id){const monthly=Number((await pool.query('SELECT monthly_cny FROM fg_user_budgets WHERE user_id=$1',[id])).rows[0]?.monthly_cny||0),usage=await spendUsage(pool,{userId:id,since:monthStart(),excludeCapExemptAudio:true});return {monthlyCny:monthly||null,usedCny:usage.used,unknown:usage.unknown,remainingCny:monthly?Math.max(0,monthly-usage.used):null};}
export async function meilinUserRoute(req,res,ctx){
 const {path,actor}=ctx;const isApp=path.pathname==='/meilin-app'||path.pathname.startsWith('/meilin-app/'),isAPI=path.pathname.startsWith('/api/fg/meilin/');if(!isApp&&!isAPI)return false;
 try{
  const owner=await ownerAPI(ctx.pool,actor.id,ctx),flags=await owner.api('/features');if(!meilinEnabled(flags,actor)){json(res,403,{error:'美林 · 超级导演暂未开放'});return true;}
  const media=/^\/api\/fg\/meilin\/dramas\/([^/]+)\/media\/([^/]+)$/.exec(path.pathname);
  if(media){await accessible(ctx.pool,media[1],actor.id,false);const link=(await ctx.pool.query('SELECT * FROM fg_meilin_calls WHERE drama_id=$1 AND task_id=$2',[media[1],media[2]])).rows[0];if(!link)throw Error('媒体不存在');const producer=await ownerAPI(ctx.pool,link.actor_id,ctx),view=await taskView(ctx.pool,link,ctx);if(!view.result?.resourceId)throw Error('结果尚未归档');const access=await producer.api('/resources/access','POST',[{resourceId:view.result.resourceId,purpose:'copy',variant:'original'}]);const url=new URL(access.items?.[0]?.access?.url,ctx.web);const response=await fetch(new URL(url.pathname+url.search,ctx.web),{headers:{...(req.headers.range?{range:req.headers.range}:{})}});res.writeHead(response.status,{'content-type':response.headers.get('content-type')||'application/octet-stream','cache-control':'no-store',...(response.headers.has('content-range')?{'content-range':response.headers.get('content-range')}:{})});for await(const chunk of response.body)res.write(chunk);res.end();return true;}
  const targetPath=isAPI?path.pathname.replace('/api/fg/meilin','/api')+path.search:(path.pathname.slice('/meilin-app'.length)||'/')+path.search;
  const headers={...meilinHeaders({id:actor.id,name:actor.name,reviewer:actor.reviewer},req.method,targetPath)};for(const k of ['content-type','content-length','accept','range','x-fg-operation-id'])if(req.headers[k])headers[k]=req.headers[k];
  const remote=http.request(new URL(targetPath,process.env.MEILIN_URL||'http://meilin:5310'),{method:req.method,headers},response=>{res.writeHead(response.statusCode||502,{...responseHeaders(response.headers),'cache-control':'no-store'});pipeline(response,res,()=>{});});
  remote.on('error',()=>{if(!res.headersSent)json(res,503,{error:'美林工作台正在准备，请稍后重试'});else res.destroy();});req.on('aborted',()=>remote.destroy());res.on('close',()=>{if(!res.writableEnded)remote.destroy();});pipeline(req,remote,()=>{});
 }catch(e){json(res,403,{error:e.message});}return true;
}
