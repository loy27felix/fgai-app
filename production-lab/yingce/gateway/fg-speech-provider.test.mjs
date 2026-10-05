import {test} from 'node:test';
import assert from 'node:assert/strict';
import {speechPayload,decodeTTSChunks,validateSpeechAudio,synthesizeSpeech,translateSpeech,translationPayload,speechFailure,queryTranscription,pcmWAV} from './fg-speech-provider.mjs';
const mp3=Buffer.from('ID3-valid-audio-fixture');
const respond=(body,headers={})=>new Response(typeof body==='string'?body:JSON.stringify(body),{headers});

test('TTS PCM is wrapped in a valid mono 24 kHz WAV without changing samples',()=>{
 const pcm=Buffer.from([0,0,1,0,255,127]);const wave=pcmWAV(pcm);
 assert.equal(wave.readUInt32LE(24),24000);assert.equal(wave.readUInt16LE(22),1);
 assert.equal(wave.readUInt32LE(40),pcm.length);assert.deepEqual(wave.subarray(44),pcm);
 assert.equal(validateSpeechAudio(wave,'wav'),wave);
 assert.equal(speechPayload({model:'seed-tts-2.0',input:'台词',response_format:'wav'}).body.req_params.audio_params.format,'pcm');
 assert.throws(()=>pcmWAV(Buffer.from([1])));
});
test('TTS 2 requires a completed stream and rejects provider failures even at HTTP 200',()=>{
 const chunks=JSON.stringify({code:0,data:mp3.toString('base64')})+'\n'+JSON.stringify({code:20000000,usage:{text_words:10}});
 assert.deepEqual(decodeTTSChunks(chunks).bytes,mp3);
 assert.throws(()=>decodeTTSChunks(chunks.split('\n')[0]),/完整/);
 assert.throws(()=>decodeTTSChunks(JSON.stringify({code:45000000,message:'secret-never-returned'})),e=>e.code==='SPEECH_AUTH_FAILED'&&!e.message.includes('secret'));
 assert.throws(()=>validateSpeechAudio(Buffer.from('<html>error'), 'mp3'));
});
test('only company models and supported audio parameters are submitted',()=>{
 assert.equal(speechPayload({model:'seed-tts-2.0',input:'台词'}).resource,'seed-tts-2.0');
 assert.equal(speechPayload({model:'seed-audio-1.0',input:'纯音乐'}).body.model,'seed-audio-1.0');
 for(const invalid of [{model:'foreign',input:'a'},{model:'seed-audio-1.0',input:''},{model:'seed-tts-2.0',input:'a',voice:'https://external'},{model:'seed-tts-2.0',input:'a',response_format:'pcm'}])assert.throws(()=>speechPayload(invalid));
 assert.equal(speechFailure(403).code,'SPEECH_AUTH_FAILED');
});
test('provider key travels only to the fixed official host with redirects rejected',async()=>{
 let request;
 const output=await synthesizeSpeech({model:'seed-audio-1.0',input:'提示音'}, {key:'test-key',fetcher:async(url,config)=>{request={url,config};return respond({audio:mp3.toString('base64'),duration:1});}});
 assert.deepEqual(output.bytes,mp3);assert.equal(request.url,'https://openspeech.bytedance.com/api/v3/tts/create');
 assert.equal(request.config.redirect,'error');assert.equal(request.config.headers['X-Api-Key'],'test-key');
 const bad=()=>synthesizeSpeech({model:'seed-audio-1.0',input:'提示音'}, {key:'test-key',fetcher:async()=>respond({url:'http://127.0.0.1/private'})});
 await assert.rejects(bad,e=>e.code==='SPEECH_INVALID_RESULT');
});
test('translation validates before charging and extracts official translation objects',async()=>{
 assert.throws(()=>translationPayload([], 'zh','en'));assert.throws(()=>translationPayload(['a'],'../../private','en'));
 const result=await translateSpeech(['你好'],'zh','en',{key:'test-key',fetcher:async()=>respond({code:20000000,data:{translation_list:[{translation:'Hello',usage:{total_tokens:27}}]}},{'x-api-status-code':'20000000'})});
 assert.equal(result.text,'Hello');assert.equal(result.usage[0].total_tokens,27);
});
test('ASR keeps pending state and converts milliseconds to subtitle seconds',async()=>{
 const pending=await queryTranscription('id',{key:'test-key',fetcher:async()=>respond({}, {'x-api-status-code':'20000001'})});assert.equal(pending.status,'running');
 const done=await queryTranscription('id',{key:'test-key',fetcher:async()=>respond({result:{text:'你好',utterances:[{start_time:100,end_time:2200,text:'你好'}]}},{'x-api-status-code':'20000000'})});
 assert.deepEqual(done.segments[0],{id:0,start:0.1,end:2.2,text:'你好',speaker:undefined});
});
