import {SpeechError,validateSpeechAudio} from './fg-speech-provider.mjs';
import {createHmac} from 'node:crypto';

export const musicModels=[{id:'suno-company-music',billingId:'suno-company-music',name:'Suno 音乐 · FG',capability:'audio',profile:{version:1}}];
const endpoint='http://suno:3050';
export const musicServiceSecret=()=>createHmac('sha256',process.env.FG_ADCRAFT_SECRET||'').update('fg-company-suno-service-v1').digest('hex');
const headers=()=>({authorization:'Bearer '+musicServiceSecret(),'content-type':'application/json'});
export async function musicStatus({fetcher=fetch}={}){
 try{const r=await fetcher(endpoint+'/status',{headers:headers(),signal:AbortSignal.timeout(3000),redirect:'error'});if(!r.ok)throw Error();const b=await r.json();return {available:true,configured:b.configured===true,enabled:b.enabled===true};}
 catch{return {available:false,configured:false,enabled:false};}
}
export async function synthesizeMusic(input,{requestId,fetcher=fetch}={}){
 if(input.model!=='suno-company-music'||!String(input.input||'').trim()||!['mp3',undefined].includes(input.response_format))throw new SpeechError('SPEECH_INVALID_INPUT',400);
 const r=await fetcher(endpoint+'/v1/audio/speech',{method:'POST',headers:{...headers(),'x-fg-operation-id':requestId},body:JSON.stringify(input),signal:AbortSignal.timeout(310000),redirect:'error'});
 if(!r.ok){const b=await r.json().catch(()=>({}));const messages={SUNO_NOT_CONFIGURED:'公司 Suno 音乐渠道等待管理员配置',SUNO_BUSY:'公司 Suno 正在制作音乐，请稍后提交新任务',SUNO_ALREADY_SUBMITTED:'音乐请求已经提交，请查看原任务；不会重复扣费生成',SUNO_RESULT_PENDING:'Suno 音乐仍在制作，请联系管理员查询原作品；不会重复提交'};const error=new SpeechError('SPEECH_UPSTREAM_FAILED',r.status);error.message=messages[b.error?.code]||'Suno 音乐请求未完成，请查看原任务';error.code='FG_SUNO_FAILED';throw error;}
 const chunks=[];let size=0;for await(const chunk of r.body){size+=chunk.length;if(size>(80<<20))throw new SpeechError('SPEECH_INVALID_RESULT');chunks.push(chunk);}
 return {bytes:validateSpeechAudio(Buffer.concat(chunks),'mp3'),format:'mp3',usage:{provider:'suno',characters:String(input.input).length,clipId:r.headers.get('x-fg-suno-clip-id')||null,costStatus:'pending_verification'}};
}
