import {test} from 'node:test';import assert from 'node:assert/strict';
import {musicStatus,synthesizeMusic} from './fg-music-provider.mjs';
test('music availability never reveals account or model credentials',async()=>{
 assert.deepEqual(await musicStatus({fetcher:async()=>({ok:true,json:async()=>({configured:true,enabled:false,cookie:'hidden',model:'private'})})}),{available:true,configured:true,enabled:false});
 assert.equal((await musicStatus({fetcher:async()=>{throw Error();}})).available,false);
});
test('validated music readiness exposes only permitted model names and the CAPTCHA state',async()=>{
 const state=await musicStatus({fetcher:async()=>({ok:true,json:async()=>({configured:true,enabled:false,accountReadable:true,captchaRequired:true,creditsLeft:9570,cookie:'secret',models:[{id:'chirp-hawk',name:'v6',token:'hidden'}]})})});
 assert.deepEqual(state,{available:true,configured:true,enabled:false,accountReadable:true,captchaRequired:true,models:[{id:'chirp-hawk',name:'v6'}]});
});
test('music submission is one bounded call and retains its operation id',async()=>{
 let count=0;const result=await synthesizeMusic({model:'suno-company-music',input:'钢琴',voice:'instrumental'},{requestId:'operation',fetcher:async(url,options)=>{count++;assert.equal(url,'http://suno:3050/v1/audio/speech');assert.equal(options.headers['x-fg-operation-id'],'operation');return new Response(Buffer.from('ID3music'),{headers:{'x-fg-suno-clip-id':'clip'}});}});
 assert.equal(count,1);assert.equal(result.usage.costStatus,'pending_verification');
 await assert.rejects(()=>synthesizeMusic({model:'suno-company-music',input:'a'},{fetcher:async()=>new Response(JSON.stringify({error:{code:'SUNO_ALREADY_SUBMITTED'}}),{status:409})}),/不会重复/);
});
