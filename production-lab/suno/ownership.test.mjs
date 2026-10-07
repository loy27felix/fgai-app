import test from 'node:test';import assert from 'node:assert/strict';import {CurrentSunoAPI} from './current-api.mjs';
const id='477ae8a4-d02b-47a6-9a0b-21a6df4c57c6';
test('company import rejects a foreign clip and an incomplete own clip',async()=>{
 const api=new CurrentSunoAPI({cookie:'unused'});api.token=async()=>'.'+Buffer.from(JSON.stringify({sub:'company-owner'})).toString('base64url')+'.';
 api.get=async()=>[{id,status:'complete',audio_url:'https://cdn1.suno.ai/'+id+'.mp3',user_id:'foreign'}];
 await assert.rejects(api.ownedClip(id),/SUNO_CLIP_NOT_OWNED/);
 api.get=async()=>[{id,status:'streaming',audio_url:'',user_id:'company-owner'}];
 await assert.rejects(api.ownedClip(id),/SUNO_RESULT_PENDING/);
 api.get=async()=>[{id,status:'complete',audio_url:'https://cdn1.suno.ai/'+id+'.mp3',user_id:'company-owner'}];
 assert.equal((await api.ownedClip(id)).id,id);
 await assert.rejects(api.ownedClip('../secret'),/SUNO_INVALID_INPUT/);
});
