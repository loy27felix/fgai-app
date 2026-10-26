import {randomUUID} from 'node:crypto';
import {normalizeProjectLanguage,applyProjectLanguage,projectLanguageTemplateVariables,lockDialogueToOriginal,assertLockedEnglishPrompt} from '../shared/project-language.mjs';

const idPattern=/^[0-9a-f-]{32,36}$/i;
const key=id=>'project-language:'+id;
function failure(message,status=400){return Object.assign(Error(message),{status});}
function checkPolicy(fn){try{return fn();}catch(e){throw failure(e.message);}}
function send(res,data,status=200){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify({code:status===200?0:status,data:status===200?data:null,msg:status===200?'':data}));}
async function readBody(req,max){
 if(req.fgReplayBody){if(req.fgReplayBody.length>max)throw failure('请求内容过大',413);return req.fgReplayBody;}
 const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>max)throw failure('请求内容过大',413);chunks.push(chunk);}return Buffer.concat(chunks);
}
export function nativeProjectAccess({web,cookie,publicOrigin}){return async projectId=>{
 const r=await fetch(new URL('/api/projects/'+encodeURIComponent(projectId)+'/core',web),{headers:{cookie,origin:publicOrigin},signal:AbortSignal.timeout(20000)});
 const j=await r.json();if(!r.ok||j.code!==0)throw failure('无权访问此项目或项目不可用',r.status===403?403:404);
};}
async function load(pool,id){
 const row=(await pool.query('SELECT value_json FROM system_settings WHERE key=$1',[key(id)])).rows[0];
 if(!row)return {policy:normalizeProjectLanguage(),revision:null};
 const saved=JSON.parse(row.value_json);return {policy:normalizeProjectLanguage(saved.policy),revision:saved.revision};
}
// Reuses native project authorization and the existing settings store; no new schema or background job.
export async function projectLanguageRoute(req,res,{pool,actor,path,access}){
 const match=path.pathname.match(/^\/api\/fg\/project-language\/([^/]+)$/);if(!match)return false;
 try{
  let id=match[1];if(!idPattern.test(id))throw failure('项目编号无效');
  if(req.method==='GET'){
   const project=(await pool.query("SELECT id FROM projects WHERE id=$1 UNION ALL SELECT project_id id FROM canvas_projects WHERE id=$1 AND project_id<>'' LIMIT 1",[id])).rows[0];
   if(!project){send(res,{policy:normalizeProjectLanguage(),revision:null});return true;}
   id=project.id;
  }
  await access(id);
  if(req.method==='GET'){send(res,await load(pool,id));return true;}
  if(req.method!=='PUT')throw failure('不支持此操作',405);
  let body;try{body=JSON.parse((await readBody(req,8192)).toString('utf8'));}catch(e){throw e.status?e:failure('语言设置格式无效');}
  if(!body||Object.keys(body).some(k=>!['policy','expectedRevision'].includes(k))||!(body.expectedRevision===null||typeof body.expectedRevision==='string'))throw failure('语言设置格式无效');
  const policy=normalizeProjectLanguage(body.policy),client=await pool.connect();
  try{
   await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[key(id)]);
   const current=await load(client,id);if(current.revision!==body.expectedRevision)throw failure('语言设置已被修改，请刷新后重试',409);
   const saved={policy,revision:randomUUID()};
   await client.query('INSERT INTO system_settings(key,value_json,updated_by,created_at,updated_at) VALUES($1,$2,$3,now(),now()) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at',[key(id),JSON.stringify(saved),actor.id]);
   await client.query('COMMIT');send(res,saved);
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }catch(e){send(res,e.status?e.message:'项目语言设置未保存，请检查后重试',e.status||400);}
 return true;
}
export function applyLanguageToTask(body,saved){
 const policy=saved.policy,input=body.input&&typeof body.input==='object'?body.input:{},metadata=input.metadata||{};
 if(metadata.projectLanguagePolicy&&JSON.stringify(normalizeProjectLanguage(metadata.projectLanguagePolicy))!==JSON.stringify(policy))throw failure('项目语言设置已变化，请重新预览生成内容',409);
 const mode=input.mode||String(body.type||'').replace(/^canvas_/,'');
 const prompt=applyProjectLanguage(body.prompt,policy,mode);
 if(prompt===body.prompt&&!metadata.projectLanguagePolicy)return body;
 const variables=metadata.promptTemplateVariables;
 return {...body,prompt,input:{...input,...(typeof input.prompt==='string'?{prompt:applyProjectLanguage(input.prompt,policy,mode)}:{}),
  requirements:applyProjectLanguage(input.requirements||'',policy,mode),
  metadata:{...metadata,projectLanguagePolicy:policy,...(metadata.artifactMetadata&&typeof metadata.artifactMetadata==='object'?{artifactMetadata:{...metadata.artifactMetadata,actualPrompt:prompt,projectLanguagePolicy:policy}}:{}),...(variables&&typeof variables==='object'?{promptTemplateVariables:projectLanguageTemplateVariables(variables,policy,mode)}:{})}}};
}
export async function guardProjectLanguageTask(req,res,{pool,path,access}){
 if(path.pathname!=='/api/tasks'||req.method!=='POST')return true;
 try{
  req.fgReplayBody=await readBody(req,16*1024*1024);
  let body;try{body=JSON.parse(req.fgReplayBody.toString('utf8'));}catch{throw failure('任务格式无效');}
  if(!idPattern.test(String(body.projectId||'')))return true;
  // Resolve from the task's actual project, never a client-supplied metadata owner/domain ID.
  const row=(await pool.query("SELECT id FROM projects WHERE id=$1 UNION ALL SELECT project_id id FROM canvas_projects WHERE id=$1 AND project_id<>'' LIMIT 1",[body.projectId])).rows[0];
  if(!row)return true;
  const saved=await load(pool,row.id),m=body.input?.metadata||{};
  if(!m.projectLanguagePolicy&&saved.policy.spoken==='source'&&saved.policy.screenText==='source')return true;
  await access(row.id);
  const next=checkPolicy(()=>applyLanguageToTask(body,saved)),mode=next.input.mode||String(next.type||'').replace(/^canvas_/,'');
  if(mode==='video'&&saved.policy.spoken==='en-original'&&m.shotId){
   const shot=(await pool.query('SELECT s.current_revision_id,r.dialogue,u.source_text FROM shots s JOIN shot_revisions r ON r.id=s.current_revision_id JOIN project_units u ON u.id=s.unit_id WHERE s.project_id=$1 AND s.id=$2',[row.id,m.shotId])).rows[0];
   if(!shot||m.shotRevisionId!==shot.current_revision_id)throw failure('镜头版本已变化，请保存并重新预览',409);
   checkPolicy(()=>assertLockedEnglishPrompt(lockDialogueToOriginal(shot.dialogue,shot.source_text),body.prompt));
  }
  if(mode==='audio'&&saved.policy.spoken==='en-original'&&m.operation==='character_voice_sample'){
   const line=String(body.prompt).split('试音台词：')[1]?.split('【项目制作语言设置】')[0].trim();
   if(!line||/\p{Script=Han}/u.test(line))throw failure('本项目使用原英文台词，请粘贴角色的英文原句后试音');
  }
  req.fgReplayBody=Buffer.from(JSON.stringify(next));return true;
 }catch(e){send(res,e.status?e.message:'项目语言检查暂时不可用，请稍后重试',e.status||503);return false;}
}
