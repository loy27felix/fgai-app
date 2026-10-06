import http from 'node:http';import {readFile,writeFile} from 'node:fs/promises';import {timingSafeEqual} from 'node:crypto';
import {join} from 'node:path';import {claim,save,musicInput,audioURL} from './contract.mjs';
import {CurrentSunoAPI,selectSunoModel} from './current-api.mjs';

// Private runtime configuration only. No account cookie reaches FG members.
try{for(const line of (await readFile('/run/fg-suno/account.env','utf8')).split(/\r?\n/)){if(!line||line.startsWith('#'))continue;const at=line.indexOf('=');const key=line.slice(0,at);if(['SUNO_COOKIE','TWOCAPTCHA_KEY','SUNO_MODEL','SUNO_ENABLED'].includes(key))process.env[key]=line.slice(at+1);}}catch{}
const configured=()=>!!process.env.SUNO_COOKIE?.includes('__client=');
const enabled=()=>configured()&&process.env.SUNO_ENABLED==='true';
const state='/state';let apiPromise:Promise<any>|undefined;let active=false;let verification:any;
async function api(){return apiPromise??=Promise.resolve(new CurrentSunoAPI({cookie:process.env.SUNO_COOKIE}));}
function json(res:any,status:number,data:any){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));}
http.createServer(async(req,res)=>{
 if(req.url==='/health/live'){json(res,200,{ok:true});return;}
 const supplied=String(req.headers.authorization||'').replace(/^Bearer /,'');const expected=process.env.SUNO_SERVICE_SECRET||'';
 const givenBytes=Buffer.from(supplied),expectedBytes=Buffer.from(expected);
 if(!expected||givenBytes.length!==expectedBytes.length||!timingSafeEqual(givenBytes,expectedBytes)){json(res,403,{error:{code:'SUNO_FORBIDDEN'}});return;}
 if(req.url==='/status'&&req.method==='GET'){json(res,200,{configured:configured(),enabled:enabled(),model:process.env.SUNO_MODEL||'auto',adapter:'fg-current-web-20261007',captchaMode:'company-manual',generationVerified:false,...verification});return;}
 const operation=/^\/operations\/([0-9a-f-]{36})$/.exec(req.url||'');
 if(operation&&req.method==='GET'){
  try{const record=JSON.parse(await readFile(join(state,operation[1]+'.json'),'utf8'));json(res,200,{id:record.id,status:record.status,clipIds:record.clipIds||[],primaryClipId:record.primaryClipId||null});}catch{json(res,404,{error:{code:'SUNO_OPERATION_NOT_FOUND'}});}return;
 }
 if(req.url==='/validate'&&req.method==='POST'){
  if(!configured()){json(res,503,{error:{code:'SUNO_NOT_CONFIGURED'}});return;}
  try{const account=await api();const billing=await account.account();const model=selectSunoModel(billing,process.env.SUNO_MODEL||'auto');const captchaRequired=await account.captchaRequired();verification={accountReadable:true,checkedAt:new Date().toISOString(),captchaRequired,models:billing.models.filter((m:any)=>m.can_use===true).map((m:any)=>({id:m.external_key,name:m.name}))};json(res,200,{...verification,creditsLeft:billing.total_credits_left,model:model.external_key,generationVerified:false});}
  catch(error){verification={accountReadable:false,models:[]};const code=error instanceof Error&&/^SUNO_[A-Z_]+$/.test(error.message)?error.message:'SUNO_AUTH_OR_PROTOCOL_FAILED';json(res,502,{error:{code}});}return;
 }
 if(req.url!=='/v1/audio/speech'||req.method!=='POST'){json(res,404,{error:{code:'SUNO_ROUTE_NOT_FOUND'}});return;}
 if(!enabled()){json(res,503,{error:{code:'SUNO_NOT_CONFIGURED'}});return;}
 let record:any;let ownsActive=false;let submitted=false;
 try{
  let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>65536)throw Error('SUNO_INVALID_INPUT');chunks.push(chunk);}
  const input=musicInput(JSON.parse(Buffer.concat(chunks).toString()));
  const id=String(req.headers['x-fg-operation-id']||'');
  if(active){json(res,429,{error:{code:'SUNO_BUSY'}});return;}
  active=true;ownsActive=true;
  record=await claim(state,id,{...input,model:process.env.SUNO_MODEL||'auto'});
  if(!record.created){
   if(record.status==='succeeded'){const bytes=await readFile(join(state,id+'.mp3'));res.writeHead(200,{'content-type':'audio/mpeg'});res.end(bytes);return;}
   json(res,409,{error:{code:'SUNO_ALREADY_SUBMITTED'}});return;
  }
  const account=await api();const prepared=await account.preflight(input,process.env.SUNO_MODEL||'auto',id);await save(record,{status:'sending',actualModel:prepared.model.external_key});submitted=true;const clips=await account.generate(prepared.payload);
  const ids=clips.map((clip:any)=>clip.id);if(!ids.length||ids.some((v:any)=>!/^[0-9a-f-]{36}$/.test(v)))throw Error('SUNO_INVALID_RESULT');
  await save(record,{status:'submitted',clipIds:ids});
  let complete:any;const until=Date.now()+270000;
  while(Date.now()<until){const current=await account.get(ids);complete=current.find((clip:any)=>clip.status==='complete'&&clip.audio_url);if(complete)break;if(current.every((clip:any)=>clip.status==='error'))throw Error('SUNO_GENERATION_FAILED');await new Promise(r=>setTimeout(r,4000));}
  if(!complete)throw Error('SUNO_RESULT_PENDING');
  const response=await fetch(audioURL(await account.downloadURL(complete.id)),{redirect:'error',signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('SUNO_INVALID_RESULT');
  const bytes=[];let length=0;for await(const chunk of response.body!){length+=chunk.length;if(length>(80<<20))throw Error('SUNO_INVALID_RESULT');bytes.push(chunk);}
  const audio=Buffer.concat(bytes);if(!(audio.subarray(0,3).toString()==='ID3'||(audio[0]===255&&(audio[1]&224)===224)))throw Error('SUNO_INVALID_RESULT');
  await writeFile(join(state,id+'.mp3'),audio,{mode:0o600});await save(record,{status:'succeeded',clipIds:ids,primaryClipId:complete.id});
  res.writeHead(200,{'content-type':'audio/mpeg','content-length':audio.length,'x-fg-suno-clip-id':complete.id});res.end(audio);
 }catch(error){
  if(record?.created)await save(record,{status:submitted?'uncertain':'rejected'}).catch(()=>{});
  const code=error instanceof Error&&/^SUNO_[A-Z_]+$/.test(error.message)?error.message:'SUNO_UPSTREAM_FAILED';json(res,502,{error:{code}});
 }finally{if(ownsActive)active=false;}
}).listen(3050,'0.0.0.0');
