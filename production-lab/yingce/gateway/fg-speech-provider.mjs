import fs from 'node:fs/promises';
import {randomUUID, timingSafeEqual} from 'node:crypto';

const origin = 'https://openspeech.bytedance.com';
const maxAudioBytes = 80 << 20;
export const defaultSpeechVoice = 'zh_female_gaolengyujie_uranus_bigtts';
export const speechVoices=[
 ['zh_female_gaolengyujie_uranus_bigtts','高冷御姐'],['zh_female_vv_uranus_bigtts','Vivi'],['zh_female_xiaohe_uranus_bigtts','小何'],['zh_male_m191_uranus_bigtts','云舟'],['zh_male_taocheng_uranus_bigtts','小天'],['zh_male_liufei_uranus_bigtts','刘飞'],['zh_female_cancan_uranus_bigtts','灿灿'],
].map(([id,name])=>({id,name,language:'zh-CN',provider:'openai',kind:'builtin'}));
export const speechModels = [
 {id:'seed-audio-1.0',billingId:'seed-audio-1.0',name:'Seed Audio 1.0 · 火山引擎',capability:'audio',profile:{version:1}},
 {id:'seed-tts-2.0',billingId:'seed-tts-2.0',name:'豆包语音合成 2.0 · 火山引擎',capability:'audio',profile:{version:1},voices:speechVoices},
];
export const speechUtilities = [
 {id:'volc.seedasr.sauc.duration',name:'豆包流式语音识别 2.0',capability:'streaming'},
 {id:'volc.seedasr.auc',name:'豆包录音文件识别 2.0',capability:'transcription'},
 {id:'volc.speech.mt',name:'豆包机器翻译',capability:'translation'},
];
export class SpeechError extends Error {
 constructor(code,status=502){
  const messages={SPEECH_NOT_CONFIGURED:'公司语音渠道尚未配置',SPEECH_AUTH_FAILED:'火山语音鉴权或模型权限不足，请联系管理员',SPEECH_LIMIT:'火山语音额度或并发不足，请稍后查看任务状态',SPEECH_INVALID_INPUT:'语音输入、音色或格式不受支持',SPEECH_TIMEOUT:'语音请求结果尚未确认，请查看任务记录；不会自动重复提交',SPEECH_UPSTREAM_FAILED:'火山语音服务暂时不可用',SPEECH_INVALID_RESULT:'供应商未返回完整、可播放的音频'};
  super(messages[code]||messages.SPEECH_UPSTREAM_FAILED);this.code=code;this.status=status;
 }
}
export async function speechKey(){
 try {const key=(await fs.readFile('/run/fg-secrets/volc-speech.key','utf8')).trim();if(!key)throw Error();return key;}
 catch {throw new SpeechError('SPEECH_NOT_CONFIGURED',503);}
}
export function internalSpeechAuthorised(given){
 const expected=process.env.FG_ADCRAFT_SECRET||'';
 return !!expected&&typeof given==='string'&&given.length===expected.length&&timingSafeEqual(Buffer.from(given),Buffer.from(expected));
}
export function speechFailure(http,code){
 if(http===401||http===403||[45000000,45000001].includes(Number(code)))return new SpeechError('SPEECH_AUTH_FAILED',403);
 if(http===429)return new SpeechError('SPEECH_LIMIT',429);
 if(http===400||String(code).startsWith('45'))return new SpeechError('SPEECH_INVALID_INPUT',400);
 return new SpeechError('SPEECH_UPSTREAM_FAILED');
}
export function audioBytes(encoded){
 if(typeof encoded!=='string'||!/^[A-Za-z0-9+/=\s]+$/.test(encoded))throw new SpeechError('SPEECH_INVALID_RESULT');
 const bytes=Buffer.from(encoded,'base64');
 if(!bytes.length||bytes.length>maxAudioBytes)throw new SpeechError('SPEECH_INVALID_RESULT');
 return bytes;
}
export function validateSpeechAudio(bytes,format){
 const mp3=bytes.subarray(0,3).toString()==='ID3'||(bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0);
 const wav=bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WAVE';
 if(!(format==='mp3'?mp3:format==='wav'?wav:false)||bytes.length>maxAudioBytes)throw new SpeechError('SPEECH_INVALID_RESULT');
 return bytes;
}
export function speechPayload(input){
 if(!speechModels.some(m=>m.id===input.model))throw new SpeechError('SPEECH_INVALID_INPUT',400);
 const text=String(input.input||'').trim(),format=input.response_format||'mp3',speed=Number(input.speed??1);
 if(!text||text.length>12000||!['mp3','wav'].includes(format)||!Number.isFinite(speed)||speed<0.5||speed>2)throw new SpeechError('SPEECH_INVALID_INPUT',400);
 if(input.model==='seed-audio-1.0')return {path:'/api/v3/tts/create',resource:'',format,body:{model:input.model,text_prompt:[input.instructions,text].filter(Boolean).join('\n'),audio_config:{format,sample_rate:48000,pitch_rate:0,speech_rate:Math.round((speed-1)*100),loudness_rate:0},watermark:{}}};
 const voice=!input.voice||input.voice==='alloy'?defaultSpeechVoice:String(input.voice);
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(voice))throw new SpeechError('SPEECH_INVALID_INPUT',400);
 return {path:'/api/v3/tts/unidirectional',resource:'seed-tts-2.0',format,body:{user:{uid:'fg-company-speech'},req_params:{text,speaker:voice,audio_params:{format:format==='wav'?'pcm':format,sample_rate:24000,speech_rate:Math.round((speed-1)*100)},...(input.instructions?{additions:JSON.stringify({context_texts:[String(input.instructions).slice(0,2000)]})}:{})}}};
}
export function pcmWAV(bytes,sampleRate=24000){
 if(!bytes.length||bytes.length%2)throw new SpeechError('SPEECH_INVALID_RESULT');
 const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(bytes.length+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(sampleRate,24);header.writeUInt32LE(sampleRate*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(bytes.length,40);return Buffer.concat([header,bytes]);
}
export function decodeTTSChunks(raw){
 let completed=false,size=0,usage={},chunks=[];
 for(const line of raw.split(/\r?\n/).filter(x=>x.trim())){
  let item;try{item=JSON.parse(line);}catch{throw new SpeechError('SPEECH_INVALID_RESULT');}
  if(item.code===20000000){completed=true;usage=item.usage||{};continue;}
  if(Number(item.code)!==0)throw speechFailure(200,item.code);
  if(item.data){const bytes=audioBytes(item.data);size+=bytes.length;if(size>maxAudioBytes)throw new SpeechError('SPEECH_INVALID_RESULT');chunks.push(bytes);}
 }
 if(!completed||!chunks.length)throw new SpeechError('SPEECH_INVALID_RESULT');
 return {bytes:Buffer.concat(chunks),usage};
}
async function providerRequest(path,resource,payload,{key,requestId=randomUUID(),fetcher=fetch,timeout=300000}={}){
 const response=await fetcher(origin+path,{method:'POST',redirect:'error',headers:{'content-type':'application/json','X-Api-Key':key||await speechKey(),'X-Api-Request-Id':requestId,...(resource?{'X-Api-Resource-Id':resource}:{}),...(path==='/api/v3/tts/unidirectional'?{'X-Control-Require-Usage-Tokens-Return':'*'}:{}),'X-Api-Sequence':'-1'},body:JSON.stringify(payload),signal:AbortSignal.timeout(timeout)});
 if(!response.ok)throw speechFailure(response.status,response.headers.get('x-api-status-code'));
 // Provider diagnostics can echo credentials. Only stable FG codes leave this module.
 const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>(115<<20))throw new SpeechError('SPEECH_INVALID_RESULT');chunks.push(chunk);}
 return {raw:Buffer.concat(chunks).toString(),code:response.headers.get('x-api-status-code'),requestId};
}
export async function synthesizeSpeech(input,options={}){
 const spec=speechPayload(input);
 try{
  const result=await providerRequest(spec.path,spec.resource,spec.body,options);
  if(spec.resource){const output=decodeTTSChunks(result.raw);return {...output,bytes:validateSpeechAudio(spec.format==='wav'?pcmWAV(output.bytes):output.bytes,spec.format),format:spec.format,requestId:result.requestId};}
  let payload;try{payload=JSON.parse(result.raw);}catch{throw new SpeechError('SPEECH_INVALID_RESULT');}
  if(payload.code!==undefined&&Number(payload.code)!==0)throw speechFailure(200,payload.code);
  const data=payload.data||payload,encoded=data.audio||data.audio_base64||payload.audio;
  // Use the documented inline audio response; never follow an unvalidated result URL.
  const bytes=validateSpeechAudio(audioBytes(encoded),spec.format);
  return {bytes,format:spec.format,usage:{duration:data.duration??payload.duration},requestId:result.requestId};
 }catch(error){if(error instanceof SpeechError)throw error;throw new SpeechError(error.name==='TimeoutError'||error.name==='AbortError'?'SPEECH_TIMEOUT':'SPEECH_UPSTREAM_FAILED');}
}
export async function submitTranscription(url,requestId,options={}){
 const result=await providerRequest('/api/v3/auc/bigmodel/submit','volc.seedasr.auc',{user:{uid:'fg-company-asr'},audio:{url},request:{model_name:'bigmodel',enable_itn:true,enable_punc:true,enable_speaker_info:true,show_utterances:true}}, {...options,requestId,timeout:30000});
 if(result.code!=='20000000')throw speechFailure(200,result.code);return requestId;
}
export async function queryTranscription(requestId,options={}){
 const result=await providerRequest('/api/v3/auc/bigmodel/query','volc.seedasr.auc',{}, {...options,requestId,timeout:30000});
 if(['20000001','20000002'].includes(result.code))return {status:'running'};
 if(result.code!=='20000000')throw speechFailure(200,result.code);
 let data;try{data=JSON.parse(result.raw);}catch{throw new SpeechError('SPEECH_INVALID_RESULT');}
 return {status:'succeeded',text:data.result?.text||'',segments:(data.result?.utterances||[]).map((u,i)=>({id:i,start:Number(u.start_time)/1000,end:Number(u.end_time)/1000,text:u.text||'',speaker:u.additions?.speaker||u.speaker_id})),usage:data.audio_info||{}};
}
export function translationPayload(texts,source,target){
 if(!Array.isArray(texts)||!texts.length||texts.length>100||texts.some(t=>typeof t!=='string')||texts.join('').length>12000||!/^[-a-zA-Z]{2,16}$/.test(source)||!/^[-a-zA-Z]{2,16}$/.test(target))throw new SpeechError('SPEECH_INVALID_INPUT',400);
 return {text_list:texts,source_language:source,target_language:target};
}
export async function translateSpeech(texts,source,target,options={}){
 const result=await providerRequest('/api/v3/machine_translation/matx_translate','volc.speech.mt',translationPayload(texts,source,target),options);
 if(result.code&&result.code!=='20000000')throw speechFailure(200,result.code);
 let data;try{data=JSON.parse(result.raw);}catch{throw new SpeechError('SPEECH_INVALID_RESULT');}
 if(data.code!==undefined&&Number(data.code)!==0&&Number(data.code)!==20000000)throw speechFailure(200,data.code);
 const entries=data.translation_list||data.data?.translation_list||data.text_list;
 if(!Array.isArray(entries)||entries.length!==texts.length)throw new SpeechError('SPEECH_INVALID_RESULT');
 const translated=entries.map(entry=>typeof entry==='string'?entry:entry?.translation);
 if(translated.some(value=>typeof value!=='string'))throw new SpeechError('SPEECH_INVALID_RESULT');
 return {text:translated.join('\n'),translations:translated,usage:entries.map(entry=>entry?.usage||{}),requestId:result.requestId};
}
