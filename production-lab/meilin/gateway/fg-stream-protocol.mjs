import {gzipSync,gunzipSync} from 'node:zlib';
import {SpeechError,speechFailure} from './fg-speech-provider.mjs';

// Volc ASR v3: 4-byte header, signed sequence, payload size, gzip payload.
export function streamFrame(payload,sequence,{audio=false,last=false}={}){
 if(!Number.isInteger(sequence)||sequence<1)throw new SpeechError('SPEECH_INVALID_INPUT',400);
 const body=gzipSync(audio?payload:Buffer.from(JSON.stringify(payload)));
 const prefix=Buffer.alloc(12);prefix[0]=0x11;prefix[1]=(audio?0x20:0x10)|(last?3:1);prefix[2]=audio?0x01:0x11;
 prefix.writeInt32BE(last?-sequence:sequence,4);prefix.writeUInt32BE(body.length,8);return Buffer.concat([prefix,body]);
}
export function streamResponse(input){
 const b=Buffer.from(input);if(b.length<8||b.length>(2<<20)||(b[0]>>4)!==1)throw new SpeechError('SPEECH_INVALID_RESULT');
 let at=(b[0]&15)*4;const type=b[1]>>4,flags=b[1]&15,serialization=b[2]>>4,compression=b[2]&15;
 const read=()=>{if(at+4>b.length)throw new SpeechError('SPEECH_INVALID_RESULT');const v=b.readInt32BE(at);at+=4;return v;};
 let sequence=0;if(flags&1)sequence=read();if(flags&4)read();
 if(type===15)throw speechFailure(200,read());
 if(type!==9)throw new SpeechError('SPEECH_INVALID_RESULT');
 const length=read();if(length<0||at+length!==b.length||serialization!==1||![0,1].includes(compression))throw new SpeechError('SPEECH_INVALID_RESULT');
 let raw=b.subarray(at);if(compression===1)raw=gunzipSync(raw,{maxOutputLength:2<<20});
 let payload;try{payload=JSON.parse(raw);}catch{throw new SpeechError('SPEECH_INVALID_RESULT');}
 if(payload.code!==undefined&&Number(payload.code)!==0)throw speechFailure(200,payload.code);
 const r=payload.result||{};return {last:!!(flags&2)||sequence<0,text:String(r.text||'').slice(0,60000),segments:(Array.isArray(r.utterances)?r.utterances:[]).slice(0,2000).map(u=>({start:Number(u.start_time||0)/1000,end:Number(u.end_time||0)/1000,text:String(u.text||'').slice(0,5000),final:!!u.definite})),duration:Number(payload.audio_info?.duration||0)/1000};
}
export const streamConfig={user:{uid:'fg-company-stream'},audio:{format:'pcm',codec:'raw',rate:16000,bits:16,channel:1},request:{model_name:'bigmodel',enable_itn:true,enable_punc:true,enable_ddc:true,show_utterances:true,enable_nonstream:true,result_type:'full'}};
