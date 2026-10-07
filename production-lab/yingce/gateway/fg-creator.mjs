import http from 'node:http';
import {pipeline} from 'node:stream';
import {createHash,createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import {advertisingModels,selectedAdvertisingModel} from './fg-adcraft-models.mjs';
import {creatorConversation,creatorResponse,creatorStreamEvents} from './fg-creator-protocol.mjs';
import {anthropicConversation,anthropicResponse,anthropicStreamEvents} from './fg-anthropic.mjs';
import {creatorGenerationConfig,creatorMediaOperation} from './fg-creator-config.mjs';
import {responseHeaders} from './policy.mjs';
import fs from 'node:fs/promises';
import {priceQuote} from './fg-quotes.mjs';
import {estimateCNY} from './fg-prices.mjs';
import {createSpeechJob,refreshTranscription} from './fg-speech-jobs.mjs';
import {advertisingAccess} from './fg-adcraft.mjs';
import {speechVoices} from './fg-speech-provider.mjs';

const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export const creatorCapability=id=>createHmac('sha256',process.env.FG_ADCRAFT_SECRET||'').update('fg-creator-v1:'+id).digest('hex');
export function creatorAuthorised(id,given){const expected=creatorCapability(id);return uuid.test(id)&&!!process.env.FG_ADCRAFT_SECRET&&typeof given==='string'&&given.length===expected.length&&timingSafeEqual(Buffer.from(given),Buffer.from(expected));}
export async function initializeCreator(pool){
 await pool.query(`CREATE TABLE IF NOT EXISTS fg_creator_workspaces(owner_id varchar(36) PRIMARY KEY REFERENCES users(id),native_project_id varchar(36) UNIQUE NOT NULL REFERENCES projects(id),created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS fg_creator_jobs(id uuid PRIMARY KEY,owner_id varchar(36) NOT NULL REFERENCES users(id),logical_key varchar(64) NOT NULL,task_id varchar(36) REFERENCES tasks(id),status varchar(16) NOT NULL DEFAULT 'reserved',created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(owner_id,logical_key));`);
 await pool.query(`CREATE TABLE IF NOT EXISTS fg_arcreel_workspaces(owner_id varchar(36) PRIMARY KEY REFERENCES users(id),native_project_id varchar(36) UNIQUE NOT NULL REFERENCES projects(id),created_at timestamptz NOT NULL DEFAULT now());`);
}
function json(res,data,status=200){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));}
async function body(req,max=32<<20){let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>max)throw Error('资料过大');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString());}
async function nativeAPI(web,cookie,origin,path,method='GET',payload){const r=await fetch(new URL('/api'+path,web),{method,headers:{cookie,origin,'content-type':'application/json'},body:payload===undefined?undefined:JSON.stringify(payload),signal:AbortSignal.timeout(120000)});const b=await r.json();if(!r.ok||b.code!==0){const error=Error(b.msg||'FG 制作服务暂不可用');error.status=r.status;throw error;}return b.data;}
export async function creatorInternalRoute(req,res,{pool,web,publicOrigin,canvasSession,path}){
 const arc=path.pathname.startsWith('/internal/arcreel/');
 const routePath=arc?path.pathname.replace('/internal/arcreel/','/internal/creator/'):path.pathname;
 const capability=String(req.headers.authorization||'').replace(/^Bearer /,'')||String(req.headers['x-api-key']||'');
 const costing=/^\/internal\/arcreel\/([^/]+)\/cost$/.exec(path.pathname);
 if(costing){
  if(req.method!=='POST'||!creatorAuthorised(costing[1],capability)){json(res,{error:{message:'导演报价未授权'}},403);return true;}
  try{
   const active=(await pool.query("SELECT id FROM users WHERE id=$1 AND status='active'",[costing[1]])).rows[0];if(!active)throw Error('FG 账号不可用');
   const input=await body(req,8192),models=await advertisingModels(pool);
   const selected=models.find(m=>m.billingId===input.model||m.billingId.replace(/-filter-off$/,'').replace(/seedance-2-0/,'seedance-2.0')===input.model);if(!selected)throw Error('当前模型未启用');
   const price=(await pool.query('SELECT snapshot FROM fg_model_prices WHERE model=$1',[selected.billingId])).rows[0]?.snapshot;
   const fx=Number((await pool.query("SELECT value FROM fg_company_settings WHERE key='usdCnyRate'")).rows[0]?.value);
   if(input.estimate){json(res,priceQuote(selected.billingId,price,{capability:selected.capability,operation:input.operation||'text_to_video',options:input.options||{},inputs:input.inputs||{}},fx));}
   else{
    if(!uuid.test(input.taskId||''))throw Error('尚未取得 FG 制作任务；不能凭缺失用量计算费用');
    const owner=(await pool.query('SELECT j.task_id FROM fg_creator_jobs j JOIN fg_arcreel_workspaces w ON w.owner_id=j.owner_id JOIN tasks t ON t.id=j.task_id AND t.project_id=w.native_project_id WHERE j.owner_id=$1 AND j.task_id=$2',[active.id,input.taskId])).rows[0];if(!owner)throw Error('制作任务不属于此工作区');
    const calls=(await pool.query('SELECT * FROM api_call_logs WHERE task_id=$1 AND user_id=$2 AND billable',[input.taskId,active.id])).rows;
    const amounts=calls.map(call=>estimateCNY({...call,input_tokens:Number(call.input_tokens),output_tokens:Number(call.output_tokens),cached_tokens:Number(call.cached_tokens||0),model:selected.billingId,capability:selected.capability},price,fx));
    const amount=amounts.length&&amounts.every(n=>Number.isFinite(n))?amounts.reduce((a,b)=>a+b,0):null;
    json(res,{estimatedCny:amount,estimateKind:'usage_estimate',notes:['读取 FG 原始请求及用量估算；实际支出以 FG 匹配的 WeToken 账单为准。']});
   }
  }catch(e){json(res,{error:{message:e.message}},400);}return true;
 }
 const catalog=/^\/internal\/creator\/([^/]+)\/models$/.exec(routePath);
 if(catalog){
  if(req.method!=='GET'||!creatorAuthorised(catalog[1],capability)){json(res,{error:{message:'创作者服务未授权'}},403);return true;}
  const active=(await pool.query("SELECT id FROM users WHERE id=$1 AND status='active'",[catalog[1]])).rows[0];if(!active){json(res,{error:{message:'FG 账号不可用'}},403);return true;}
  const all=await advertisingModels(pool);json(res,{models:arc?all:all.filter(m=>m.capability==='text').map(m=>({id:m.billingId,name:m.name})),allModels:all});return true;
 }
 const match=/^\/internal\/creator\/([^/]+)\/v1\/(responses|messages|messages\/count_tokens|chat\/completions|audio\/speech|audio\/transcriptions|images\/generations|images\/edits|contents\/generations\/tasks(?:\/[^/]+)?|media\/[^/]+)$/.exec(routePath);if(!match)return false;
 let keepAlive;
 try{
  if(!creatorAuthorised(match[1],capability)){json(res,{error:{message:'创作者服务未授权'}},403);return true;}
  const actor=(await pool.query(`SELECT u.id,u.display_name name,a.email,a.platform_role FROM users u JOIN fg_accounts a ON a.user_id=u.id WHERE u.id=$1 AND u.status='active'`,[match[1]])).rows[0];if(!actor)throw Error('FG 账号不可用');
  const cookie=await canvasSession({...actor,reviewer:actor.platform_role==='superadmin',platformRole:actor.platform_role});const api=(p,m,b)=>nativeAPI(web,cookie,publicOrigin,p,m,b);
  if(req.method==='POST'&&match[2]==='audio/transcriptions'){
   const payload=await creatorMultipart(req);
   if(payload.model!=='volc.seedasr.auc'||!payload.file)throw Error('请上传录音文件并选择公司语音识别模型');
   const reference=await creatorReference(payload.file,'audio',api,{web,cookie,publicOrigin});
   const token=createHash('sha256').update(actor.id+payload.file).digest('hex');
   const stableId=`${token.slice(0,8)}-${token.slice(8,12)}-4${token.slice(13,16)}-a${token.slice(17,20)}-${token.slice(20,32)}`;
   const operation=String(req.headers['x-fg-operation-id']||'');
   let job=await createSpeechJob(pool,actor,{kind:'transcription',resourceId:reference.id,operationId:uuid.test(operation)?operation:stableId},api);
   res.setHeader('x-fg-speech-job-id',job.id);
   for(let i=0;i<900&&['submitted','sending'].includes(job.status);i++){await new Promise(r=>setTimeout(r,2000));job=await refreshTranscription(pool,job);}
   if(job.status!=='succeeded')throw Error('录音识别仍在处理或失败，请从音频工具查看原任务；不会重复提交');
   json(res,{text:job.result.text,segments:job.result.segments,duration:Number(job.result.usage?.duration)/1000||undefined});return true;
  }
  if(req.method==='GET'&&match[2].startsWith('contents/generations/tasks/')){
   const id=match[2].split('/').pop();
   const valid=(await pool.query('SELECT j.task_id FROM fg_creator_jobs j JOIN tasks t ON t.id=j.task_id AND t.user_id=j.owner_id WHERE j.owner_id=$1 AND j.task_id=$2 AND t.project_id IN (SELECT native_project_id FROM fg_arcreel_workspaces WHERE owner_id=$1 UNION SELECT native_project_id FROM fg_creator_workspaces WHERE owner_id=$1)',[actor.id,id])).rows[0];if(!valid)throw Error('视频任务不存在');
   const data=await api('/tasks/'+id),task=data.task||data;let content;
   if(task.status==='succeeded')content={video_url:`http://fg-gateway:3010/internal/${arc?'arcreel':'creator'}/${actor.id}/v1/media/${id}`};
   res.setHeader('x-fg-task-id',id);json(res,{id,status:task.status,content,error:task.error?{message:task.error}:undefined});return true;
  }
  if(req.method==='GET'&&match[2].startsWith('media/')){
   const id=match[2].split('/').pop();
   if(!uuid.test(id)||(await pool.query('SELECT 1 FROM fg_creator_jobs WHERE owner_id=$1 AND task_id=$2',[actor.id,id])).rowCount!==1)throw Error('结果不属于此工作区');
   const data=await api('/tasks/'+id),task=data.task||data;if(task.status!=='succeeded')throw Error('结果尚未就绪');
   const signed=new URL(await creatorResourceURL(pool,api,JSON.parse(task.resultJson||'{}')),web);
   const output=await fetch(new URL(signed.pathname+signed.search,web));if(!output.ok)throw Error('NAS 结果暂不可读');
   res.writeHead(200,{'content-type':output.headers.get('content-type')||'video/mp4','cache-control':'no-store'});
   for await(const chunk of output.body)res.write(chunk);res.end();return true;
  }
  if(req.method!=='POST')throw Error('不支持的制作操作');
  const payload=match[2]==='images/edits'?await creatorMultipart(req):await body(req,50<<20);
  if(match[2]==='messages/count_tokens'){json(res,{error:{type:'not_supported_error',message:'公司渠道不提供精确的预请求 Token 计数；实际用量见 FG 账单'}},501);return true;}
  const operationId=String(req.headers['x-fg-operation-id']||'');
  if(arc&&!uuid.test(operationId))throw Error('导演制作请求缺少操作标识；未提交模型任务');
  const mode=match[2].startsWith('images/')?'image':match[2]==='contents/generations/tasks'?'video':match[2]==='audio/speech'?'audio':'text';
  let requested=payload.model||(mode==='image'?'gpt-image-2':mode==='video'?'doubao-seedance-2-0-fast-filter-off':'claude-sonnet-5-5-t3a');
  if(arc&&mode==='video'){const alias=(await advertisingModels(pool)).find(m=>m.capability==='video'&&m.billingId.replace(/-filter-off$/,'').replace(/seedance-2-0/,'seedance-2.0')===requested);if(alias)requested=alias.billingId;}
  const selected=await selectedAdvertisingModel(pool,mode,requested),model=selected.billingId;
  const adWorkspace=payload.fgAdWorkspaceId?await advertisingAccess(pool,{...actor,reviewer:actor.platform_role==='superadmin'},payload.fgAdWorkspaceId):null;
  if(payload.fgAdWorkspaceId&&(!adWorkspace||mode!=='audio'))throw Error('广告音频项目不存在或无权使用');
  const generationConfig=creatorGenerationConfig(selected,payload,mode,{standardImageQuality:true});
  const mediaOperation=creatorMediaOperation(selected,payload,mode);
  if(payload.stream&&!['responses','messages'].includes(match[2]))throw Error('此创作工具接口暂支持非流式请求');
  const conversation=mode!=='text'?null:match[2]==='messages'?anthropicConversation(payload):match[2]==='responses'?creatorConversation(payload):{canonical:{messages:payload.messages,tools:payload.tools||[],toolChoice:payload.tool_choice||'auto'},custom:new Set()};
  if(mode==='image'&&(!payload.prompt||Number(payload.n||1)!==1||false))throw Error('当前图片中转每次支持单张生成');
  const references={image:[],video:[],audio:[]};
  if(mode==='image'&&[payload.image||[]].flat().filter(Boolean).length>selected.profile.image.references.maxImages)throw Error('参考图片数量超过当前模型上限');
  if(mode==='video')for(const kind of ['image','video','audio'])if((payload.content||[]).filter(x=>x.type===kind+'_url').length>(selected.profile.video.references[{image:'maxImages',video:'maxVideos',audio:'maxAudios'}[kind]]||0))throw Error('参考素材数量超过当前模型上限');
  if(mode!=='text'){
   if(mode==='image')for(const value of [payload.image||[]].flat())if(value)references.image.push(await creatorReference(value,'image',api,{web,cookie,publicOrigin}));
   if(mode==='video')for(const part of payload.content||[])for(const kind of Object.keys(references))if(part.type===kind+'_url'){const ref=await creatorReference(part[kind+'_url']?.url,kind,api,{web,cookie,publicOrigin});if(part.role)ref.role=part.role;references[kind].push(ref);}
  }
  const channel=(await pool.query(`SELECT cm.channel_id,cm.protocol,c.api_format FROM channel_models cm JOIN model_channels c ON c.id=cm.channel_id WHERE (c.name LIKE 'WeToken%' OR c.name IN ('火山语音 · FG','Suno 音乐 · FG')) AND cm.model_key=$1 AND cm.enabled AND c.enabled AND cm.deleted_at IS NULL AND c.deleted_at IS NULL LIMIT 1`,[model])).rows[0];if(!channel)throw Error('公司模型暂不可用');
  // PostgreSQL serialises initial project mapping and duplicate transport retries.
  const client=await pool.connect();let workspace,job,newJob=false;
  const logical=createHash('sha256').update(JSON.stringify([arc?'arcreel':'creator',operationId||req.headers['session_id']||req.headers['x-codex-session-id']||'',payload])).digest('hex');
  const workspaceTable=arc?'fg_arcreel_workspaces':'fg_creator_workspaces';
  try{
   await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('fg-creator:'||$1))",[actor.id]);
   workspace=adWorkspace||(await client.query('SELECT * FROM '+workspaceTable+' WHERE owner_id=$1',[actor.id])).rows[0];
   if(!workspace){const {project}=await api('/projects','POST',{name:(arc?'ArcReel 导演工作台':'创作者工作台')+' · '+actor.name,type:'creator',aspectRatio:'16:9',sourceType:'text',description:'公司统一渠道；每位成员的原生工程单独保存。'});workspace={native_project_id:project.id};await client.query('INSERT INTO '+workspaceTable+'(owner_id,native_project_id) VALUES($1,$2)',[actor.id,project.id]);}
   job=(await client.query('SELECT * FROM fg_creator_jobs WHERE owner_id=$1 AND logical_key=$2',[actor.id,logical])).rows[0];
   if(!job){job={id:randomUUID()};newJob=true;await client.query('INSERT INTO fg_creator_jobs(id,owner_id,logical_key) VALUES($1,$2,$3)',[job.id,actor.id,logical]);}
   await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  if(!job.task_id&&!newJob){const recovered=(await pool.query("SELECT id FROM tasks WHERE user_id=$1 AND project_id=$2 AND input_json::jsonb #>> '{metadata,clientOperationId}'=$3 LIMIT 1",[actor.id,workspace.native_project_id,'creator-'+job.id])).rows[0];if(!recovered)throw Error('请求已登记，正在恢复；不会重复提交付费任务');job.task_id=recovered.id;}
  if(!job.task_id){
   const config={channelId:channel.channel_id,model,interfaceType:channel.protocol,apiFormat:channel.api_format||'openai',count:'1',...generationConfig};
   const prompt=mode==='audio'?payload.input:mode==='image'?payload.prompt:mode==='video'?(payload.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n'):'创作者工作台 Agent';
   if(!prompt)throw Error('请填写制作内容');
   const agentRequests=match[2]==='chat/completions'?{chatCompletion:{...payload,stream:false}}:{canonical:conversation?.canonical};
   const input={mode,prompt,config,...(mode!=='text'?{referenceImages:references.image,referenceVideos:references.video,referenceAudios:references.audio}:{}),...(mode==='text'?{agentRequests,textOptions:{stream:false,maxOutputTokens:Math.min(32768,Math.max(1,Number(payload.max_output_tokens||payload.max_tokens||payload.max_completion_tokens)||8192))}}:{}),metadata:{clientOperationId:'creator-'+job.id,source:adWorkspace?'fg-adcraft':arc?'fg-arcreel':'fg-opencreator',...(mode==='video'?{videoEditOperation:mediaOperation}:{}),...(adWorkspace?{adcraftWorkspaceId:adWorkspace.id}:{}),creatorSession:String(req.headers['session_id']||'').slice(0,160)}};
   try{const task=await api('/tasks','POST',{projectId:workspace.native_project_id,type:'canvas_'+mode,operation:mediaOperation,model,prompt:input.prompt,input});job.task_id=task.id;}
   catch(error){
    // A definite admission rejection (such as exhausted monthly allowance) has
    // created no provider task. Permit retry after the administrator fixes it.
    // Timeouts and uncertain server failures retain the idempotency reservation.
    if(error.status>=400&&error.status<500)await pool.query('DELETE FROM fg_creator_jobs WHERE id=$1 AND task_id IS NULL',[job.id]);
    throw error;
   }
  }
  await pool.query("UPDATE fg_creator_jobs SET task_id=$2,status='submitted' WHERE id=$1",[job.id,job.task_id]);
  res.setHeader('x-fg-task-id',job.task_id);
  if(mode==='video'){json(res,{id:job.task_id,status:'queued'});return true;}
  if(payload.stream){res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store','connection':'keep-alive','x-accel-buffering':'no'});res.write(': FG task accepted\n\n');keepAlive=setInterval(()=>{if(!res.destroyed)res.write(': waiting\n\n');},10000);}
  let task;for(let i=0;i<1800;i++){const data=await api('/tasks/'+job.task_id);task=data.task||data;if(['succeeded','failed','cancelled'].includes(task.status))break;await new Promise(r=>setTimeout(r,1000));}
  if(task.status!=='succeeded')throw Error(task.error||'任务仍在运行，请从创作历史查看；未重复提交');
  const nativeResult=JSON.parse(task.resultJson||'{}');
  if(mode==='audio'){
   const signed=new URL(await creatorResourceURL(pool,api,nativeResult),web);
   const output=await fetch(new URL(signed.pathname+signed.search,web));if(!output.ok)throw Error('音频已生成，等待 NAS 归档');
   res.writeHead(200,{'content-type':output.headers.get('content-type')||'audio/mpeg','cache-control':'no-store','x-fg-task-id':job.task_id});
   for await(const chunk of output.body)res.write(chunk);res.end();return true;
  }
  if(mode==='image'){
   const output=[...(nativeResult.images||[]),nativeResult.image,nativeResult].filter(Boolean).find(v=>v.resourceId||v.storageKey);let id=output?.resourceId||String(output?.storageKey||'').replace(/^resource:/,'');
   if(!id&&nativeResult.assetId)id=(await pool.query('SELECT r.resource_id FROM asset_representations r JOIN asset_versions v ON v.id=r.asset_version_id JOIN assets a ON a.primary_version_id=v.id WHERE a.id=$1 AND a.user_id=$2 ORDER BY r.created_at DESC LIMIT 1',[nativeResult.assetId,actor.id])).rows[0]?.resource_id;
   if(!id)throw Error('图片已生成，等待 NAS 归档，请从创作历史恢复');
   const access=await api('/resources/access','POST',[{resourceId:id,purpose:'copy',variant:'original'}]);const url=new URL(access.items?.[0]?.access?.url,web);const image=await fetch(new URL(url.pathname+url.search,web));if(!image.ok)throw Error('图片归档暂不可读');
   json(res,{created:Math.floor(Date.now()/1000),data:[{b64_json:Buffer.from(await image.arrayBuffer()).toString('base64')}]});return true;
  }
  if(match[2]==='messages'){
   const observed=(await pool.query('SELECT sum(input_tokens) input,sum(output_tokens) output FROM api_call_logs WHERE task_id=$1 AND usage_available=true',[job.task_id])).rows[0];
   const usage=observed?.input==null?undefined:{input_tokens:Number(observed.input),output_tokens:Number(observed.output)};
   const result=anthropicResponse(nativeResult,{id:'msg_'+job.id,model,usage});
   if(payload.stream){for(const event of anthropicStreamEvents(result))res.write('event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n');res.end();}else json(res,result);return true;
  }
  if(match[2]==='chat/completions'){json(res,{id:'chatcmpl-'+job.id,object:'chat.completion',model,choices:[{index:0,message:{role:'assistant',content:nativeResult.text||null,...(nativeResult.toolCalls?.length?{tool_calls:nativeResult.toolCalls}:{})},finish_reason:nativeResult.toolCalls?.length?'tool_calls':'stop'}]});return true;}
  const result=creatorResponse(nativeResult,{id:'resp_'+job.id,model,custom:conversation.custom});
  if(payload.stream){for(const event of creatorStreamEvents(result))res.write('event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n');res.end();}else json(res,result);
 }catch(e){if(!res.headersSent)json(res,{error:{message:e.message,type:'fg_creator_error'}},400);else if(!res.destroyed){res.write('event: error\ndata: '+JSON.stringify({type:'error',error:{message:e.message,code:'fg_creator_error'}})+'\n\n');res.end();}}
 finally{if(keepAlive)clearInterval(keepAlive);}return true;
}
async function creatorMultipart(req){
 let length=0;const chunks=[];for await(const chunk of req){length+=chunk.length;if(length>(50<<20))throw Error('参考素材上限 50 MB');chunks.push(chunk);}
 const form=await new Request('http://fg-internal/',{method:'POST',headers:{'content-type':req.headers['content-type']},body:Buffer.concat(chunks)}).formData();
 const payload={image:[]};for(const [key,value] of form){if(typeof value==='string')payload[key]=value;else if(key==='file'&&(value.type.startsWith('audio/')||/\.(mp3|wav|m4a|ogg|flac)$/i.test(value.name))){const mime=value.type.startsWith('audio/')?value.type:({mp3:'audio/mpeg',wav:'audio/wav',m4a:'audio/mp4',ogg:'audio/ogg',flac:'audio/flac'}[value.name.split('.').pop().toLowerCase()]);payload.file='data:'+mime+';base64,'+Buffer.from(await value.arrayBuffer()).toString('base64');}else if(/^image(?:\[\])?$/.test(key))payload.image.push('data:'+value.type+';base64,'+Buffer.from(await value.arrayBuffer()).toString('base64'));else throw Error('不支持的参考文件字段');}return payload;
}
async function creatorReference(value,kind,api,{web,cookie,publicOrigin}){
 const match=typeof value==='string'&&/^data:([^;]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(value);if(!match||!match[1].startsWith(kind+'/'))throw Error('请先上传导演参考素材；不读取任意外部链接');
 const bytes=Buffer.from(match[2],'base64');if(bytes.length>(50<<20))throw Error('参考素材上限 50 MB');
 const form=new FormData();form.set('kind',kind);form.set('file',new Blob([bytes],{type:match[1]}),kind+'.'+(kind==='image'?'png':kind==='video'?'mp4':'wav'));
 const r=await fetch(new URL('/api/resources',web),{method:'POST',headers:{cookie,origin:publicOrigin,'x-idempotency-key':'arc-ref-'+createHash('sha256').update(bytes).digest('hex')},body:form,signal:AbortSignal.timeout(120000)}),result=await r.json();if(!r.ok||result.code!==0)throw Error(result.msg||'参考素材未保存到 NAS');
 return {id:result.data.resource.id,storageKey:'resource:'+result.data.resource.id,name:'导演参考素材',type:match[1]};
}
async function creatorResourceURL(pool,api,result){
 const output=[...(result.videos||[]),...(result.images||[]),...(result.audios||[]),result.video,result.image,result.audio,result].filter(Boolean).find(x=>x.resourceId||x.storageKey);let id=output?.resourceId||String(output?.storageKey||'').replace(/^resource:/,'');
 if(!id&&result.assetId)id=(await pool.query('SELECT r.resource_id FROM asset_representations r JOIN asset_versions v ON v.id=r.asset_version_id JOIN assets a ON a.primary_version_id=v.id WHERE a.id=$1 ORDER BY r.created_at DESC LIMIT 1',[result.assetId])).rows[0]?.resource_id;
 if(!id)throw Error('结果等待 NAS 归档，请从创作历史恢复');
 const access=await api('/resources/access','POST',[{resourceId:id,purpose:'copy',variant:'original'}]);const url=access.items?.[0]?.access?.url;if(!url)throw Error('结果暂不可读');return url;
}
export async function creatorUserRoute(req,res,{pool,actor,path}){
 if(path.pathname==='/.opencreator/runtime-config'){json(res,{baseUrl:'/.opencreator/runtime'});return true;}
 const isRuntime=path.pathname.startsWith('/.opencreator/runtime/');
 const isStatic=path.pathname==='/creator-app'||path.pathname.startsWith('/creator-static/')||path.pathname.startsWith('/creator-presets/')||path.pathname.startsWith('/fonts/opencreator/')||/^\/(?:dashboard|platforms|site-icons|skill-market|auth)\/.+\.(?:png|jpe?g|webp|svg|mp4)$/.test(path.pathname);
 if(!isRuntime&&!isStatic)return false;
 if(isRuntime&&path.pathname==='/.opencreator/runtime/codex/models'){
  const models=(await advertisingModels(pool)).filter(m=>m.capability==='text').map(m=>({id:m.billingId,model:m.billingId,displayName:m.name,description:'公司 WeToken 渠道 · 纳入 FG 人民币账单和月额度',supportedReasoningEfforts:[],defaultReasoningEffort:null,inputModalities:['text','image'],isDefault:m.billingId==='claude-sonnet-5-5-t3a'}));json(res,{models});return true;
 }
 const inner=isRuntime?path.pathname.slice('/.opencreator/runtime'.length):'';
 if(isRuntime&&((/^\/codex\/(?:provider|login|logout)/.test(inner)&&!['GET','HEAD'].includes(req.method))||(/^\/(?:settings\/storage|creator-services\/config|config)/.test(inner)&&!['GET','HEAD'].includes(req.method)))){json(res,{error:{code:'FG_MANAGED_PROVIDER',message:'模型与存储由公司统一管理，无需个人 Codex 账号'}},403);return true;}
 let runtimeIP;
 if(isRuntime){
  const endpoints=JSON.parse(await fs.readFile('/host-metrics/creator-runtimes.json','utf8'));
  runtimeIP=endpoints[actor.id];
  if(!/^10\.(?:20[89]|21[0-9]|22[0-3])\.(?:\d{1,3})\.(?:\d{1,3})$/.test(runtimeIP||'')){
   json(res,{error:{message:'创作者工作区正在启动，请稍后重新连接'}},503);return true;
  }
 }
 if(isRuntime&&inner==='/creator-services/tts/voices'&&req.method==='GET'&&path.searchParams.get('provider')==='openai'&&['seed-tts-2.0','seed-audio-1.0','suno-company-music'].includes(path.searchParams.get('model'))){
  const model=path.searchParams.get('model');json(res,{provider:'openai',model,voices:model==='seed-tts-2.0'?speechVoices:model==='suno-company-music'?[{id:'instrumental',name:'纯音乐',language:'multi',provider:'openai',kind:'builtin'},{id:'song',name:'带人声歌曲',language:'multi',provider:'openai',kind:'builtin'}]:[{id:'prompt',name:'由提示词描述声音',language:'multi',provider:'openai',kind:'builtin'}]});return true;
 }
 if(isRuntime&&['/fg-models','/fg-model-selection'].includes(inner)){
  try{
   const models=await advertisingModels(pool),runtime='http://'+runtimeIP+':8060',headers={'x-fg-runtime':creatorCapability(actor.id)};
   const response=await fetch(runtime+'/creator-services/config',{headers});if(!response.ok)throw Error('个人工作区尚未就绪');
   const current=await response.json(),config=current.config;
   if(inner==='/fg-model-selection'){
    if(req.method!=='POST')throw Error('不支持的模型设置操作');
    const input=await body(req,4096);await selectedAdvertisingModel(pool,input.capability,input.model);
    if(!['text','image','video','audio'].includes(input.capability))throw Error('不支持的能力');
    if(input.capability==='text')config.llm.model=input.model;
    if(input.capability==='image')config.image.openai.model=input.model;
    if(input.capability==='video')config.video.seedance.model=input.model;
    if(input.capability==='audio')config.tts.openai.model=input.model;
    // Public configuration redacts credentials. Restore only this actor's
    // internal capability, never a supplier account key, before native save.
    for(const service of [config.llm,config.image.openai,config.video.seedance,config.tts.openai,config.transcription.openai]){service.apiKey=creatorCapability(actor.id);service.baseUrl=`http://fg-gateway:3010/internal/creator/${actor.id}/v1`;}
    const saved=await fetch(runtime+'/creator-services/config',{method:'PATCH',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(config)});if(!saved.ok)throw Error('模型设置未保存');
   }else if(req.method!=='GET')throw Error('只支持读取模型目录');
   json(res,{models,defaults:{text:config.llm.model,image:config.image.openai.model,video:config.video.seedance.model,audio:config.tts.openai.model}});
  }catch(e){json(res,{error:{message:e.message}},400);}return true;
 }
 // Docker Desktop can forward unresolved internal names through a VPN's fake
 // DNS. The host supplies only this user's managed private bridge address.
 const destination=isRuntime?'http://'+runtimeIP+':8060':'http://creator-web';
 const target=new URL(isRuntime?inner+path.search:path.pathname==='/creator-app'?'/index.html':path.pathname.replace(/^\/creator-static/,''),destination);
 const headers=isRuntime?{'x-fg-runtime':creatorCapability(actor.id)}:{};
 for(const key of ['content-type','content-length','accept','range','last-event-id'])if(req.headers[key])headers[key]=req.headers[key];
 const upstream=http.request(target,{method:req.method,headers},remote=>{

  res.writeHead(remote.statusCode||502,{...responseHeaders(remote.headers),'cache-control':'no-store'});pipeline(remote,res,()=>{});
 });
 upstream.on('error',()=>{if(!res.headersSent)json(res,{error:{code:'CREATOR_STARTING',message:'个人创作者运行环境正在启动，请稍后重试'}},503);else res.destroy();});
 req.on('aborted',()=>upstream.destroy());res.on('close',()=>{if(!res.writableEnded)upstream.destroy();});pipeline(req,upstream,()=>{});return true;
}
