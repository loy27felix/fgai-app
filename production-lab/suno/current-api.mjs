import {randomUUID} from 'node:crypto';

// Current web-account transport. No automatic paid POST replay or CAPTCHA solver.
// Model permission and limits come from the logged-in account, never a version guess.
const origin='https://studio-api-prod.suno.com',authOrigin='https://auth.suno.com';
const clerkQuery='?__clerk_api_version=2025-11-10&_clerk_js_version=5.117.0';
export function selectSunoModel(billing,preferred='auto'){
 const available=(Array.isArray(billing.models)?billing.models:[]).filter(m=>m.can_use===true&&typeof m.external_key==='string');
 const model=preferred&&preferred!=='auto'?available.find(m=>m.external_key===preferred):available.find(m=>m.is_default_model)||available[0];
 if(!model)throw Error('SUNO_MODEL_UNAVAILABLE');return model;
}
export function currentMusicPayload(input,model,operationId){
 const limit=Number(model.max_lengths?.gpt_description_prompt||3000);if(input.prompt.length>limit)throw Error('SUNO_PROMPT_TOO_LONG');
 return {token:null,generation_type:'TEXT',title:'',tags:'',negative_tags:'',mv:model.external_key,prompt:input.prompt,make_instrumental:input.instrumental,
  user_uploaded_images_b64:null,metadata:{web_client_pathname:'/create',is_max_mode:false,is_mumble:false,create_mode:'inspiration',user_tier:'',create_session_token:randomUUID(),disable_volume_normalization:false},
  override_fields:[],cover_clip_id:null,cover_start_s:null,cover_end_s:null,persona_id:null,artist_clip_id:null,artist_start_s:null,artist_end_s:null,continue_clip_id:null,continued_aligned_prompt:null,continue_at:null,transaction_uuid:operationId};
}
export class CurrentSunoAPI{
 constructor({cookie,fetcher=fetch}){this.cookie=cookie;this.fetcher=fetcher;this.jwt=null;this.expires=0;}
 async requestURL(url,{method='GET',body,headers={}}={}){
  const response=await this.fetcher(url,{method,redirect:'error',headers:{...headers,...(body!==undefined?{'content-type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(response.status===401||response.status===403?'SUNO_AUTH_OR_PERMISSION_FAILED':response.status===429?'SUNO_RATE_LIMITED':'SUNO_UPSTREAM_FAILED');
  const raw=await response.text();if(raw.length>(4<<20))throw Error('SUNO_INVALID_RESULT');try{return raw?JSON.parse(raw):{};}catch{throw Error('SUNO_PROTOCOL_CHANGED');}
 }
 async token(){
  if(this.jwt&&this.expires>Date.now())return this.jwt;
  const client=String(this.cookie||'').match(/(?:^|;\s*)__client=([^;]+)/)?.[1];if(!client||/[\r\n]/.test(client))throw Error('SUNO_NOT_CONFIGURED');
  const headers={authorization:client,cookie:'__client='+client,origin:'https://suno.com',referer:'https://suno.com/'};
  const info=await this.requestURL(authOrigin+'/v1/client'+clerkQuery,{headers});
  const session=info.response?.last_active_session_id||info.response?.sessions?.find(s=>s.status==='active')?.id;
  if(!/^sess_[a-zA-Z0-9]+$/.test(session||''))throw Error('SUNO_AUTH_OR_PERMISSION_FAILED');
  const token=await this.requestURL(authOrigin+'/v1/client/sessions/'+session+'/tokens'+clerkQuery,{method:'POST',headers});
  if(typeof token.jwt!=='string'||!token.jwt.includes('.'))throw Error('SUNO_AUTH_OR_PERMISSION_FAILED');
  this.jwt=token.jwt;this.expires=Date.now()+25000;return this.jwt;
 }
 async request(path,options={}){
  const device=String(this.cookie||'').match(/(?:^|;\s*)ajs_anonymous_id=([^;]+)/)?.[1]?.replaceAll('"','')||'00000000-0000-0000-0000-000000000000';
  return this.requestURL(origin+path,{...options,headers:{authorization:'Bearer '+await this.token(),'device-id':device,'browser-token':JSON.stringify({token:Buffer.from(JSON.stringify({timestamp:Date.now()})).toString('base64')}),origin:'https://suno.com',referer:'https://suno.com/'}});
 }
 async account(){const b=await this.request('/api/billing/info/');if(!Array.isArray(b.models)||!Number.isFinite(Number(b.total_credits_left)))throw Error('SUNO_PROTOCOL_CHANGED');return b;}
 async preflight(input,preferred,operationId){
  const b=await this.account(),model=selectSunoModel(b,preferred);if(Number(b.total_credits_left)<=0)throw Error('SUNO_CREDITS_EXHAUSTED');
  const payload=currentMusicPayload(input,model,operationId),captcha=await this.request('/api/c/check',{method:'POST',body:{ctype:'generation'}});
  if(captcha.required)throw Error('SUNO_CAPTCHA_REQUIRED');
  return {payload,model};
 }
 async generate(payload){
  const output=await this.request('/api/generate/v2-web/',{method:'POST',body:payload});
  if(output.status==='error'||!Array.isArray(output.clips)||!output.clips.length)throw Error('SUNO_SUBMISSION_UNCERTAIN');return output.clips;
 }
 async get(ids){
  const data=await this.request('/api/feed/?ids='+encodeURIComponent(ids.join(',')));if(!Array.isArray(data))throw Error('SUNO_PROTOCOL_CHANGED');return data;
 }
 async downloadURL(id){
  const until=Date.now()+45000;while(Date.now()<until){const result=await this.request('/api/download/clip/'+id+'?format=mp3');
   if(result.ok&&result.status==='ready'&&result.download_url)return result.download_url;
   if(!['processing','rate_limited'].includes(result.status))throw Error('SUNO_DOWNLOAD_NOT_PERMITTED');await new Promise(r=>setTimeout(r,2000));
  }throw Error('SUNO_RESULT_PENDING');
 }
}
