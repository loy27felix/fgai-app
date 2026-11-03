import {createHash,timingSafeEqual} from 'node:crypto';
import fs from 'node:fs/promises';
import {isIP} from 'node:net';
import {join} from 'node:path';
import {gatewayRuntimeVersion} from './runtime-version.mjs';
import {musicServiceURL} from './fg-music-provider.mjs';

const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const identifier=/^[A-Za-z0-9_.:-]{1,120}$/;
const iso=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const day=86400000;
const deadlineMs=6000;
const runtimeManifests={arcreel:['arcreel-runtimes.json',1241],opencreator:['creator-runtimes.json',8060]};
const localMode=gatewayRuntimeVersion.build.environment==='development';
const route=/^\/internal\/support\/(arcreel|opencreator|adcraft|meilin|suno)\/(evidence|version)$/;
const digest=value=>createHash('sha256').update(value).digest();
const readToken=()=>process.env.SUPPORT_BOT_NATIVE_READ_TOKEN||'';

export function nativeSupportToken(req){
 const expected=readToken(),given=req.headers.authorization;
 return expected.length>=32&&typeof given==='string'&&timingSafeEqual(digest(given),digest('Bearer '+expected));
}
export function nativeSupportFailure(res,status,code){
 res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
 res.end(JSON.stringify({error:{code}}));
}
class SupportRelayError extends Error {
 constructor(status,code){super(code);this.status=status;}
}
function fail(status,code){throw new SupportRelayError(status,code);}
async function withinDeadline(promise,signal){
 let onAbort;
 try{
  signal.throwIfAborted();
  return await Promise.race([promise,new Promise((_,reject)=>{onAbort=()=>reject(signal.reason);signal.addEventListener('abort',onAbort,{once:true});})]);
 }finally{if(onAbort)signal.removeEventListener('abort',onAbort);}
}
function queryScope(params,kind){
 const allowed=new Set(['actorId','taskId','requestId','projectId','traceId',...(kind==='evidence'?['start','end','limit']:[])]);
 for(const key of params.keys())if(!allowed.has(key)||params.getAll(key).length!==1)fail(400,'support_query_invalid');
 const actorId=params.get('actorId');
 if(!actorId)fail(400,kind==='version'?'instance_required':'support_actor_required');
 if(!uuid.test(actorId))fail(400,'support_actor_invalid');
 const result=new URLSearchParams({actorId:actorId.toLowerCase()});
 for(const key of ['taskId','requestId','projectId','traceId']){
  if(!params.has(key))continue;
  const value=params.get(key);
  if(!identifier.test(value))fail(400,'support_identifier_invalid');
  result.set(key,value);
 }
 if(kind==='version')return result;
 const end=params.get('end')??new Date().toISOString();
 const to=Date.parse(end);
 if(!iso.test(end)||!Number.isFinite(to))fail(400,'support_time_range_invalid');
 const start=params.get('start')??new Date(to-day).toISOString();
 const from=Date.parse(start);
 if(!iso.test(start)||!iso.test(end)||!Number.isFinite(from)||!Number.isFinite(to)||from>=to||to-from>7*day)fail(400,'support_time_range_invalid');
 const limit=params.get('limit')??'50';
 if(!/^\d{1,3}$/.test(limit)||Number(limit)<1||Number(limit)>50)fail(400,'support_limit_invalid');
 result.set('start',new Date(from).toISOString());result.set('end',new Date(to).toISOString());result.set('limit',String(Number(limit)));
 return result;
}
function checkedOrigin(configured){
 let target;
 try{target=new URL(configured);}catch{fail(503,'support_target_not_configured');}
 if(!['http:','https:'].includes(target.protocol)||target.username||target.password||target.pathname!=='/'||target.search||target.hash)fail(503,'support_target_not_configured');
 if(localMode){
  if(target.hostname==='localhost')target.hostname='127.0.0.1';
  const host=target.hostname.replace(/^\[|\]$/g,'');
  // Fail before network I/O; a mismatching payload environment would be too late.
  // 必须在网络读取之前拦截，不能等响应 environment 不匹配后再拒绝。
  if(host!=='::1'&&!(isIP(host)===4&&host.startsWith('127.')))fail(503,'support_target_environment_denied');
 }
 return target;
}
function scopedOrigin(service,configured){
 const localKey=service.replace(/-/g,'_').toUpperCase();
 return checkedOrigin(localMode?(process.env[`SUPPORT_BOT_NATIVE_LOCAL_${localKey}_URL`]||configured):configured);
}
async function destination(service,actorId,readFile,signal){
 if(!Object.hasOwn(runtimeManifests,service))return scopedOrigin(service,service==='adcraft'?'http://adcraft-api:8000':service==='meilin'?(process.env.MEILIN_URL||'http://meilin:5310'):musicServiceURL);
 const [filename,port]=runtimeManifests[service];
 const directory=localMode?(process.env.SUPPORT_BOT_NATIVE_LOCAL_MANIFEST_DIR||'/host-metrics'):'/host-metrics';
 let address;
 try{
  const content=await withinDeadline(readFile(join(directory,filename),'utf8'),signal);
  if(Buffer.byteLength(content)>1024*1024)fail(503,'support_instance_unavailable');
  const endpoints=JSON.parse(content);
  address=endpoints&&Object.hasOwn(endpoints,actorId)?endpoints[actorId]:undefined;
 }catch{signal.throwIfAborted();fail(503,'support_instance_unavailable');}
 // Local manifests may select isolated loopback ports; production remains IP-only with fixed ports.
 // 本地清单可选择隔离的 loopback 端口；生产仍只接受 IP 并使用固定端口。
 if(localMode&&typeof address==='string'&&/^https?:\/\//i.test(address))return checkedOrigin(address);
 if(typeof address!=='string'||isIP(address)!==4)fail(503,'support_instance_unavailable');
 if(localMode){
  if(!address.startsWith('127.'))fail(503,'support_target_environment_denied');
 }else if(!/^10\.(?:20[89]|21\d|22[0-3])\./.test(address))fail(503,'support_instance_unavailable');
 return new URL(`http://${address}:${port}`);
}
async function boundedJSON(response,maxBytes){
 if(!response.body||!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||''))fail(502,'support_upstream_invalid');
 if(Number(response.headers.get('content-length'))>maxBytes)fail(502,'support_response_too_large');
 const chunks=[];let size=0;
 for await(const chunk of response.body){
  size+=chunk.length;
  if(size>maxBytes)fail(502,'support_response_too_large');
  chunks.push(chunk);
 }
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(502,'support_upstream_invalid');}
}
function validatePayload(data,service,kind,actorId){
 if(!data||data.service!==service||!data.build||typeof data.build!=='object')fail(502,'support_upstream_invalid');
 if(data.build.environment!==gatewayRuntimeVersion.build.environment)fail(502,'support_environment_mismatch');
 if(kind==='evidence'){
  if(data.scope?.actorId!==actorId||!Array.isArray(data.records)||!Array.isArray(data.logs)||!data.coverage||typeof data.coverage!=='object'||typeof data.truncated!=='boolean')fail(502,'support_scope_mismatch');
 }else if(Object.hasOwn(runtimeManifests,service)&&(data.actorId??data.scope?.actorId)!==actorId)fail(502,'support_scope_mismatch');
}

const componentTargets={
 opencreator:[['web','opencreator-web','http://creator-web/.well-known/fg-runtime.json',false]],
 adcraft:[['web','adcraft-web','http://adcraft-web/.well-known/fg-runtime.json',false],['agent','adcraft-agent','http://adcraft-agent:8765/internal/support/version',true]],
};
async function aggregateVersions(data,service,fetcher,signal){
 if(!Object.hasOwn(componentTargets,service))return data;
 const components={[service==='opencreator'?'daemon':'api']:{service:data.service,build:data.build}};
 const coverage={};
 await Promise.all(componentTargets[service].map(async([key,expected,target,authenticated])=>{
  try{
   const headers={accept:'application/json',...(authenticated?{authorization:'Bearer '+readToken()}:{})};
   const componentSignal=AbortSignal.any([signal,AbortSignal.timeout(1500)]);
   const configured=new URL(target),componentTarget=scopedOrigin(expected,configured.origin);
   componentTarget.pathname=configured.pathname;
   const response=await withinDeadline(fetcher(componentTarget,{method:'GET',headers,redirect:'error',signal:componentSignal}),componentSignal);
   if(!response.ok){void response.body?.cancel().catch(()=>{});fail(502,'support_component_unavailable');}
   const component=await withinDeadline(boundedJSON(response,4096),componentSignal);
   validatePayload(component,expected,'version');
   components[key]={service:component.service,build:component.build};
   coverage[key]={available:true};
  }catch(error){
   if(error instanceof SupportRelayError&&error.message==='support_environment_mismatch')throw error;
   coverage[key]={available:false,reason:'support_component_unavailable'};
  }
 }));
 // Every image owns its build identity; never borrow daemon/API metadata for a UI or agent.
 // 每个镜像独立提供构建身份，禁止使用 daemon/API 版本代替 UI 或 agent。
 return {...data,components,incomplete:data.incomplete===true||Object.values(coverage).some(row=>!row.available),componentCoverage:coverage};
}

export async function nativeSupportRoute(req,res,{pool,path,fetcher=fetch,readFile=fs.readFile}){
 if(path.pathname!=='/internal/support'&&!path.pathname.startsWith('/internal/support/'))return false;
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),deadlineMs);
 const disconnected=()=>{if(!res.writableEnded)controller.abort();};
 res.once('close',disconnected);
 try{
  if(readToken().length<32)fail(503,'support_read_not_configured');
  if(!nativeSupportToken(req))fail(401,'support_read_unauthorized');
  if(req.method!=='GET')fail(405,'support_method_not_allowed');
  const match=route.exec(path.pathname);
  if(!match)fail(404,'support_route_not_found');
  const [,service,kind]=match,params=queryScope(path.searchParams,kind),actorId=params.get('actorId');
  const actor=(await withinDeadline(pool.query({text:"SELECT u.id FROM users u JOIN fg_accounts a ON a.user_id=u.id WHERE u.id=$1 AND u.status='active'",values:[actorId],query_timeout:1500}),controller.signal)).rows[0];
  if(!actor)fail(403,'support_actor_unavailable');
  const target=await destination(service,actor.id,readFile,controller.signal);
  target.pathname=`/internal/support/${kind}`;target.search=params.toString();
  const headers={authorization:'Bearer '+readToken(),accept:'application/json'};
  // Workspace scope must come from the FG database, never from support query input.
  // 广告工作区范围必须来自 FG 数据库，不接受 support 请求自行声明。
  if(service==='adcraft'){
   const workspaces=(await withinDeadline(pool.query({text:'SELECT id FROM fg_adcraft_workspaces WHERE owner_id=$1 AND purged_at IS NULL ORDER BY id LIMIT 101',values:[actor.id],query_timeout:1500}),controller.signal)).rows;
   if(workspaces.length>100)fail(503,'support_workspace_scope_too_large');
   if(!workspaces.length)fail(503,'support_instance_unavailable');
   if(!process.env.FG_ADCRAFT_SECRET)fail(503,'support_target_not_configured');
   headers['x-fg-internal']=process.env.FG_ADCRAFT_SECRET;
   headers['x-fg-support-actor']=actor.id;
   headers['x-fg-support-workspaces']=JSON.stringify(workspaces.map(row=>row.id));
  }
  const response=await withinDeadline(fetcher(target,{method:'GET',headers,redirect:'error',signal:controller.signal}),controller.signal);
  if(!response.ok){void response.body?.cancel().catch(()=>{});fail(response.status===401||response.status===403?503:response.status===404?503:502,'support_upstream_unavailable');}
  let data=await withinDeadline(boundedJSON(response,kind==='version'?16*1024:512*1024),controller.signal);
  validatePayload(data,service,kind,actor.id);
  if(kind==='version')data=await aggregateVersions(data,service,fetcher,controller.signal);
  const serialized=JSON.stringify(data);
  if(Buffer.byteLength(serialized)>(kind==='version'?16*1024:512*1024))fail(502,'support_response_too_large');
  res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(serialized);
 }catch(error){
  if(!res.headersSent&&!res.destroyed)nativeSupportFailure(res,error instanceof SupportRelayError?error.status:controller.signal.aborted?504:503,error instanceof SupportRelayError?error.message:controller.signal.aborted?'support_deadline_exceeded':'support_source_unavailable');
 }finally{clearTimeout(timer);res.off('close',disconnected);controller.abort();}
 return true;
}
