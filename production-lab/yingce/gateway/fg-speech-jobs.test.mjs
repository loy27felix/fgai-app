import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSpeechJob,refreshTranscription,publicSpeechSourceURL} from './fg-speech-jobs.mjs';
const operationId='70f9ee5d-510d-4bfd-a46e-6eec2a23a2b8';
test('ASR publishes only the authorised resource signature at the configured media origin',()=>{
 const id='abafe6e5b9cb653d97aaab2808311fd6',path='/api/public/resources/'+id+'/file?signature=signed';
 assert.equal(publicSpeechSourceURL(path,id,'https://media.example.com'), 'https://media.example.com'+path);
 for(const url of ['https://evil.example/file','//evil.example/file','/api/public/resources/foreign/file?signature=x'])assert.throws(()=>publicSpeechSourceURL(url,id,'https://media.example.com'));
 assert.throws(()=>publicSpeechSourceURL(path,id,'http://media.example.com'));
});
test('invalid translation and foreign or nonaudio resources are rejected before admission',async()=>{
 const pool={query:async(sql)=>{assert.match(sql,/SELECT \* FROM fg_speech_jobs/);return {rows:[]};}};
 await assert.rejects(()=>createSpeechJob(pool,{id:operationId},{operationId,kind:'translation',texts:[],source:'zh',target:'en'},()=>{throw Error('must not access resources');}),e=>e.code==='SPEECH_INVALID_INPUT');
 await assert.rejects(()=>createSpeechJob(pool,{id:operationId},{operationId,kind:'transcription',resourceId:operationId},async()=>({resource:{kind:'image',status:'ready'}})),e=>e.code==='SPEECH_INVALID_INPUT');
});
test('concurrent ASR history polls cannot requery or resubmit without a lease',async()=>{
 const job={id:operationId,kind:'transcription',status:'submitted'};
 const pool={query:async(sql)=>{assert.match(sql,/updated_at < now\(\)-interval '20 seconds'/);return {rows:[],rowCount:0};}};
 assert.equal(await refreshTranscription(pool,job),job);
});
