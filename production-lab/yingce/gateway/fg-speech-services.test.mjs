import test from 'node:test';
import assert from 'node:assert/strict';
import {companySpeechServices} from './fg-speech.mjs';
import {speechJobRoute} from './fg-speech-jobs.mjs';
test('speech job routing leaves channel service discovery to its authenticated handler',async()=>{
 assert.equal(await speechJobRoute({method:'GET'},{},{path:new URL('https://fg.local/api/fg/speech/services')}),false);
});
test('system channels expose all three dedicated speech services with actual enablement and no secrets',async()=>{
 const rows=['volc.seedasr.sauc.duration','volc.seedasr.auc','volc.speech.mt'].map(model=>({model,snapshot:{provider:'volcengine',enabled:model!=='volc.speech.mt'}}));
 const pool={query:async()=>({rows})};
 const result=await companySpeechServices(pool,{checkKey:async()=>'test-secret-never-returned'});
 assert.equal(result.services.length,3);assert.deepEqual(result.services.map(s=>s.capability),['streaming','transcription','translation']);assert.deepEqual(result.services.map(s=>s.enabled),[true,true,false]);assert.ok(!JSON.stringify(result).includes('test-secret'));
 const missing=await companySpeechServices(pool,{checkKey:async()=>{throw Error('not configured');}});assert.ok(missing.services.every(s=>!s.enabled));
});
