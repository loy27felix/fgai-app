import {createHash,randomUUID} from 'node:crypto';
import {reserveBudget} from './fg-budgets.mjs';
import {queryTranscription,submitTranscription,translateSpeech,translationPayload,SpeechError,speechUtilities} from './fg-speech-provider.mjs';

export async function initializeSpeechJobs(pool){
 await pool.query(`CREATE TABLE IF NOT EXISTS fg_speech_jobs(
 id uuid PRIMARY KEY,owner_id varchar(36) NOT NULL REFERENCES users(id),
 operation_id uuid NOT NULL,kind varchar(24) NOT NULL,input_hash varchar(64) NOT NULL,
 resource_id varchar(36),reservation_id uuid REFERENCES fg_budget_reservations(id),
 status varchar(16) NOT NULL DEFAULT 'reserved',result jsonb,error_code varchar(60),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,operation_id));`);
}
export function publicSpeechJob(job){
 return {id:job.id,kind:job.kind,status:job.status,result:job.result,error:job.error_code?new SpeechError(job.error_code).message:undefined,createdAt:job.created_at};
}
export function publicSpeechSourceURL(raw,resourceId,base=process.env.CANVAS_PUBLIC_BASE_URL){
 if(typeof raw!=='string'||!raw.startsWith('/api/public/resources/'+resourceId+'/file?'))throw new SpeechError('SPEECH_INVALID_INPUT',400);
 let origin;try{origin=new URL(base);}catch{throw new SpeechError('SPEECH_NOT_CONFIGURED',503);}
 if(origin.protocol!=='https:'||origin.username||origin.password)throw new SpeechError('SPEECH_NOT_CONFIGURED',503);
 return new URL(raw,origin).href;
}
export async function refreshTranscription(pool,job){
 if(job.kind!=='transcription'||!['submitted','sending'].includes(job.status))return job;
 const lease=await pool.query("UPDATE fg_speech_jobs SET updated_at=now() WHERE id=$1 AND status IN ('submitted','sending') AND updated_at < now()-interval '20 seconds' RETURNING id",[job.id]);
 if(!lease.rowCount)return job;
 try{
  const result=await queryTranscription(job.id);
  if(result.status==='succeeded'){
   await pool.query("UPDATE fg_speech_jobs SET status='succeeded',result=$2,updated_at=now() WHERE id=$1",[job.id,JSON.stringify(result)]);
   job={...job,status:'succeeded',result};
  }
 }catch(error){
  // Transient query failure must not cause a second paid submission.
  if(error instanceof SpeechError&&['SPEECH_AUTH_FAILED','SPEECH_INVALID_INPUT'].includes(error.code)){
   await pool.query("UPDATE fg_speech_jobs SET status='failed',error_code=$2,updated_at=now() WHERE id=$1",[job.id,error.code]);job={...job,status:'failed',error_code:error.code};
  }
 }
 return job;
}
export async function createSpeechJob(pool,actor,input,api){
 if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(input.operationId||'')||!['transcription','translation'].includes(input.kind))throw new SpeechError('SPEECH_INVALID_INPUT',400);
 if(input.kind==='translation')translationPayload(input.texts,input.source,input.target);
 const clean={...(input.kind==='transcription'?{kind:input.kind,resourceId:input.resourceId}:{kind:input.kind,texts:input.texts,source:input.source,target:input.target}),...(input.fgAdWorkspaceId?{fgAdWorkspaceId:input.fgAdWorkspaceId}:{})};
 const hash=createHash('sha256').update(JSON.stringify(clean)).digest('hex');
 let job=(await pool.query('SELECT * FROM fg_speech_jobs WHERE owner_id=$1 AND operation_id=$2',[actor.id,input.operationId])).rows[0];
 if(job){if(job.input_hash!==hash)throw new SpeechError('SPEECH_INVALID_INPUT',409);return refreshTranscription(pool,job);}
 let sourceURL;
 if(input.kind==='transcription'){
  if(!/^(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/.test(input.resourceId||''))throw new SpeechError('SPEECH_INVALID_INPUT',400);
  const {resource}=await api('/resources/'+input.resourceId);
  if(resource?.kind!=='audio'||resource.status!=='ready'||resource.size>(50<<20))throw new SpeechError('SPEECH_INVALID_INPUT',400);
  // Ownership and signed original access are enforced by the native resource API.
  const access=await api('/resources/access','POST',[{resourceId:input.resourceId,purpose:'copy',variant:'original'}]);
  sourceURL=publicSpeechSourceURL(access.items?.[0]?.access?.url,input.resourceId);
 }
 const model=speechUtilities.find(m=>m.capability===input.kind).id;
 job={id:randomUUID(),owner_id:actor.id,operation_id:input.operationId,kind:input.kind,input_hash:hash,status:'reserved',created_at:new Date()};
 const inserted=await pool.query('INSERT INTO fg_speech_jobs(id,owner_id,operation_id,kind,input_hash,resource_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[job.id,actor.id,input.operationId,input.kind,hash,input.resourceId||null]);
 if(!inserted.rowCount)return createSpeechJob(pool,actor,input,api);
 let submitted=false;
 try{
  const budget=await reserveBudget(pool,{userId:actor.id,model,capability:input.kind,payload:clean,advertisingWorkspaceId:input.fgAdWorkspaceId});
  await pool.query("UPDATE fg_speech_jobs SET reservation_id=$2,status='sending',updated_at=now() WHERE id=$1",[job.id,budget.id]);
  submitted=true;
  if(input.kind==='transcription'){
   await submitTranscription(sourceURL,job.id);
   await pool.query("UPDATE fg_speech_jobs SET status='submitted',updated_at=now() WHERE id=$1",[job.id]);
   job.status='submitted';
  }else{
   const result=await translateSpeech(input.texts,input.source,input.target,{requestId:job.id});
   await pool.query("UPDATE fg_speech_jobs SET status='succeeded',result=$2,updated_at=now() WHERE id=$1",[job.id,JSON.stringify(result)]);job={...job,status:'succeeded',result};
  }
  return job;
 }catch(error){
  if(!submitted){await pool.query('DELETE FROM fg_speech_jobs WHERE id=$1 AND reservation_id IS NULL',[job.id]);throw error;}
  // A network timeout may still have submitted an ASR job. Query its original ID.
  if(input.kind==='transcription'&&!(error instanceof SpeechError&&['SPEECH_AUTH_FAILED','SPEECH_INVALID_INPUT'].includes(error.code)))return {...job,status:'sending'};
  const code=error instanceof SpeechError?error.code:'SPEECH_UPSTREAM_FAILED';
  await pool.query("UPDATE fg_speech_jobs SET status='failed',error_code=$2,updated_at=now() WHERE id=$1",[job.id,code]);throw error;
 }
}
export async function speechJobRoute(req,res,{pool,actor,path,api}){
 if(!path.pathname.startsWith('/api/fg/speech/'))return false;
 const send=(data,status=200)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify({code:status===200?0:status,data:status===200?data:null,msg:status===200?'':data.message,reason:data.code}));};
 try{
  if(req.method==='GET'&&path.pathname==='/api/fg/speech/jobs'){
   const jobs=(await pool.query('SELECT * FROM fg_speech_jobs WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 30',[actor.id])).rows;
   const pending=jobs.filter(j=>j.kind==='transcription'&&['submitted','sending'].includes(j.status)).sort((a,b)=>new Date(a.updated_at)-new Date(b.updated_at)).slice(0,4);
   const refreshed=await Promise.all(pending.map(job=>refreshTranscription(pool,job)));
   const updates=new Map(refreshed.map(job=>[job.id,job]));send({jobs:jobs.map(job=>publicSpeechJob(updates.get(job.id)||job))});return true;
  }
  if(req.method==='POST'&&path.pathname==='/api/fg/speech/jobs'){
   let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>65536)throw new SpeechError('SPEECH_INVALID_INPUT',400);chunks.push(c);}
   const input=JSON.parse(Buffer.concat(chunks));send(publicSpeechJob(await createSpeechJob(pool,actor,input,api)));return true;
  }
  send({message:'不支持的音频操作'},404);
 }catch(error){send({message:error instanceof SpeechError?error.message:error.message||'语音请求失败',code:error.code||'FG_SPEECH_FAILED'},error.status||400);}return true;
}
