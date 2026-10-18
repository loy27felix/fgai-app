import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {bridge,context,runContext} from './fg-context.mjs';
import {byId} from './models.mjs';
import {operationDigest,validateMedia,validateRelativeFile} from './fg-contract.mjs';
import {FILES_DIR} from './files.mjs';

const externalPrefix='/api/fg/meilin';
export function publicURL(url){return typeof url==='string'&&url.startsWith('/files/')?externalPrefix+url:url;}
export function documentView(value){
 if(Array.isArray(value))return value.map(documentView);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['_revision','_ownerId','_role','request','pending'].includes(k)).map(([k,v])=>[k,documentView(v)]));
 return publicURL(value);
}
function fileURL(url){return String(url).replace(/^\/fg-six/,'').replace(/^\/api\/fg\/meilin/,'');}
async function reference(d,ref,resolveBytes=false){
 const url=fileURL(ref.url),m=/^\/files\/([^/]+)$/.exec(url);
 if(m){const file=validateRelativeFile(m[1]),up=d.uploads.find(u=>u.url===url);if(!up?.mime?.startsWith('image/'))throw Error('引用图片不属于此剧');return {kind:'image',name:ref.name||up.name,...(resolveBytes?{dataUrl:`data:${up.mime};base64,${(await readFile(join(FILES_DIR,file))).toString('base64')}`}:{url})};}
 const generated=/^\/api\/fg\/meilin\/dramas\/([^/]+)\/media\/([^/]+)$/.exec(url);
 if(generated&&generated[1]===d.id){const t=await bridge('task',{taskId:generated[2]});if(!t.result?.resourceId)throw Error('引用图尚未归档');return {kind:'image',name:ref.name,resourceId:t.result.resourceId,sourceTaskId:generated[2]};}
 throw Error('请使用本剧已保存的参考图片');
}
export async function prepare(d,pending){
 d.production ||= [];
 for(const p of pending||[]){
  const operationId=p.operationId||randomUUID(),kind=p.type,params=p.params||{},model=byId(p.model);
  const references=[];for(const ref of p.references||[])references.push(await reference(d,ref));
  validateMedia(model,{kind,params,references});
  const payload=kind==='image'?{prompt:p.prompt,size:params.size,quality:params.quality}:{prompt:p.prompt,duration:params.duration,ratio:params.ratio,resolution:params.resolution,generate_audio:params.generateAudio,operation:references.length?'reference_to_video':'text_to_video'};
  const request={operationId,kind,model:p.model,payload,references,metadata:{episodeId:p.episodeId||context().episodeId||null,segmentId:p.segmentId||null,assetCode:p.code||null,assetId:p.assetId||null,assetVersion:p.version||null}};
  const quote=await bridge('quote',request);
  if(quote.estimatedCny===null&&!quote.lines?.length)throw Error(quote.notes?.[0]||'当前模型规格无法报价');
  d.production.push({id:operationId,kind,label:p.code||`视频段落`,model:p.model,params:payload,referenceNames:references.map(r=>r.name),referencePreviews:(p.references||[]).map(r=>({name:r.name,url:r.url})),target:{code:p.code,assetId:p.assetId,version:p.version,episodeId:p.episodeId,segmentId:p.segmentId,artifactId:p.artifactId,itemKey:p.itemKey,artifactVersion:p.artifactVersion},request,digest:operationDigest(request),quote,quotedAt:Date.now(),status:'awaiting_confirmation',actorId:context().actor.id});
 }
}
export async function confirm(d,ids,digests){
 const selected=d.production?.filter(p=>ids.includes(p.id))||[];if(selected.length!==ids.length||!selected.length)throw Error('待确认任务不存在');
 for(const p of selected){
  if(p.status!=='awaiting_confirmation')continue;
  if(p.actorId!==context().actor.id)throw Error('请由创建此报价的成员确认，费用计入其月度额度');
  if(digests[p.id]!==p.digest||operationDigest(p.request)!==p.digest)throw Error('请求内容已经变化，请重新核对');
  if(Date.now()-p.quotedAt>5*60*1000)throw Error('报价已过期，请刷新报价后重新确认');
 }
 for(const p of selected)if(p.status==='awaiting_confirmation'){p.status='confirmed';p.confirmedAt=new Date().toISOString();}
}
export async function requote(d,ids){for(const p of d.production||[])if(ids.includes(p.id)&&p.status==='awaiting_confirmation'){p.quote=await bridge('quote',p.request);p.quotedAt=Date.now();}}
function target(d,p){const a=d.assets.items.find(a=>p.target.assetId?a.id===p.target.assetId:a.code===p.target.code),v=a?.versions.find(v=>v.id===p.target.version),e=d.episodes.find(e=>e.id===p.target.episodeId),s=e?.segments.find(s=>s.id===p.target.segmentId),j=e?.jobs.find(j=>j.id===p.id);return {a,v,e,s,j};}
export function cancel(d,ids){for(const p of d.production||[])if(ids.includes(p.id)&&p.status==='awaiting_confirmation'){p.status='cancelled';const {a,v,j}=target(d,p);if(j)j.status='cancelled';if(v)v.error='已取消提交';if(a){a.realPending=false;a.status='draft';}}}
export async function refresh(d){
 for(const p of d.production||[]){
  if(!['confirmed','submitted','queued','running','archiving','recovering'].includes(p.status))continue;
  const {a,v,s,j}=target(d,p);
  try{
   if(!p.taskId){
    const request=structuredClone(p.request);
    request.references=await Promise.all(request.references.map(ref=>ref.url?reference(d,ref,true):ref));
    const submitted=await runContext({...context(),actor:{id:p.actorId}},()=>bridge('submit',request));p.taskId=submitted.taskId;p.status='submitted';
   }
   const task=await bridge('task',{taskId:p.taskId});p.status=task.status;p.error=task.error||null;
   if(v)v.taskId=p.taskId;if(j){j.taskId=p.taskId;j.status=task.status==='succeeded'?'done':task.status;}
   if(task.status==='succeeded'){
    p.result=task.result;
    if(v){v.url=task.result.url;v.simulated=false;v.status='ready';}
    if(a&&a.current===p.target.version){a.realPending=false;a.status='ready';}
    if(s&&!s.takes?.some(t=>t.id===p.id))s.takes=[...(s.takes||[]),{id:p.id,url:task.result.url,taskId:p.taskId,res:p.request.payload.resolution,model:p.request.model,at:new Date().toISOString(),simulated:false}];
   }
   if(['failed','cancelled'].includes(task.status)){if(v)v.error=p.error;if(a&&a.current===p.target.version){a.realPending=false;a.status='draft';}}
  }catch(error){p.status='recovering';p.error=error.message;if(j)j.status='recovering';}
 }
}
