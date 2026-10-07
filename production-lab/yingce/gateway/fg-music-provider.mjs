import {SpeechError,validateSpeechAudio} from './fg-speech-provider.mjs';
import {createHmac} from 'node:crypto';

export const musicModels=[{id:'suno-company-music',billingId:'suno-company-music',name:'Suno 音乐 · FG',capability:'audio',profile:{version:1}}];
const endpoint='http://suno:3050';
export const musicServiceSecret=()=>createHmac('sha256',process.env.FG_ADCRAFT_SECRET||'').update('fg-company-suno-service-v1').digest('hex');
const headers=()=>({authorization:'Bearer '+musicServiceSecret(),'content-type':'application/json'});
export async function downloadCompanyMusic(clipId,{fetcher=fetch}={}){
 if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(clipId||''))throw Error('作品 ID 格式无效');
 const r=await fetcher(endpoint+'/clips/'+clipId+'/download',{headers:headers(),signal:AbortSignal.timeout(90000),redirect:'error'});
 if(!r.ok){const body=await r.json().catch(()=>({}));const error=Error('作品尚未完成、并非公司账号作品或下载未获准；请核对原作品后重试归档');if(body.error?.code==='SUNO_CLIP_NOT_OWNED')error.code='SUNO_CLIP_NOT_OWNED';throw error;}
 let size=0;const chunks=[];for await(const c of r.body){size+=c.length;if(size>(80<<20))throw Error('音频文件过大');chunks.push(c);}
 return validateSpeechAudio(Buffer.concat(chunks),'mp3');
}
export async function musicStatus({fetcher=fetch}={}){
 try{const r=await fetcher(endpoint+'/status',{headers:headers(),signal:AbortSignal.timeout(15000),redirect:'error'});if(!r.ok)throw Error();const b=await r.json();return {available:true,configured:b.configured===true,enabled:b.enabled===true,...(b.accountReadable===true?{accountReadable:true,captchaRequired:b.captchaRequired===true,models:(Array.isArray(b.models)?b.models:[]).filter(m=>typeof m.id==='string'&&typeof m.name==='string').map(m=>({id:m.id,name:m.name}))}:{})};}
 catch{return {available:false,configured:false,enabled:false};}
}
export async function synthesizeMusic(input,{requestId,fetcher=fetch}={}){
 if(input.model!=='suno-company-music'||!String(input.input||'').trim()||!['mp3',undefined].includes(input.response_format))throw new SpeechError('SPEECH_INVALID_INPUT',400);
 const r=await fetcher(endpoint+'/v1/audio/speech',{method:'POST',headers:{...headers(),'x-fg-operation-id':requestId},body:JSON.stringify(input),signal:AbortSignal.timeout(310000),redirect:'error'});
 if(!r.ok){const b=await r.json().catch(()=>({}));const messages={SUNO_NOT_CONFIGURED:'公司 Suno 音乐渠道等待管理员配置',SUNO_BUSY:'公司 Suno 正在制作音乐，请稍后提交新任务',SUNO_ALREADY_SUBMITTED:'音乐请求已经提交，请查看原任务；不会重复扣费生成',SUNO_RESULT_PENDING:'Suno 音乐仍在制作，请联系管理员查询原作品；不会重复提交',SUNO_CAPTCHA_REQUIRED:'公司 Suno 账号需要完成验证码，请联系管理员在 Suno 官网处理',SUNO_MODEL_UNAVAILABLE:'配置的音乐模型不在公司账号可用列表，请联系管理员改为 auto',SUNO_AUTH_OR_PERMISSION_FAILED:'公司 Suno 登录已过期或权限不足，请联系管理员更新凭据',SUNO_DOWNLOAD_NOT_PERMITTED:'公司 Suno 账号未获作品下载权限，请联系管理员核对订阅',SUNO_PROTOCOL_CHANGED:'Suno 接口发生变化，请联系管理员检查适配器'};const error=new SpeechError('SPEECH_UPSTREAM_FAILED',r.status);error.message=messages[b.error?.code]||'Suno 音乐请求未完成，请查看原任务';error.code='FG_SUNO_FAILED';throw error;}
 const chunks=[];let size=0;for await(const chunk of r.body){size+=chunk.length;if(size>(80<<20))throw new SpeechError('SPEECH_INVALID_RESULT');chunks.push(chunk);}
 return {bytes:validateSpeechAudio(Buffer.concat(chunks),'mp3'),format:'mp3',usage:{provider:'suno',characters:String(input.input).length,clipId:r.headers.get('x-fg-suno-clip-id')||null,costStatus:'pending_verification'}};
}
