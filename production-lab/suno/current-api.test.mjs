import test from 'node:test';import assert from 'node:assert/strict';
import {CurrentSunoAPI,selectSunoModel,currentMusicPayload} from './current-api.mjs';
const model={external_key:'chirp-hawk',can_use:true,is_default_model:true,max_lengths:{gpt_description_prompt:100}};
test('account catalogue determines permitted default; retired model is rejected',()=>{assert.equal(selectSunoModel({models:[{...model,can_use:false},{...model,external_key:'chirp-goose'}]}).external_key,'chirp-goose');assert.throws(()=>selectSunoModel({models:[model]},'chirp-v3-5'),/SUNO_MODEL_UNAVAILABLE/);});
test('current schema has v6 model, required null placeholders and stable transaction id',()=>{const p=currentMusicPayload({prompt:'悬疑配乐',instrumental:true},model,'operation');assert.equal(p.mv,'chirp-hawk');assert.equal(p.metadata.create_mode,'inspiration');assert.equal(p.transaction_uuid,'operation');assert.equal(p.cover_clip_id,null);assert.equal(p.token,null);assert.throws(()=>currentMusicPayload({prompt:'a'.repeat(101)},model,'id'),/TOO_LONG/);});
test('required CAPTCHA stops before a paid generation request',async()=>{const api=new CurrentSunoAPI({cookie:'__client=not-used'});let posted=false;api.account=async()=>({models:[model],total_credits_left:500});api.request=async(path)=>{if(path==='/api/c/check')return {required:true,captcha_version:2};posted=true;};await assert.rejects(()=>api.preflight({prompt:'music',instrumental:true},'auto','id'),/SUNO_CAPTCHA_REQUIRED/);assert.equal(posted,false);});
test('paid POST transport failure is never retried',async()=>{let count=0;const api=new CurrentSunoAPI({cookie:'__client=not-used'});api.token=async()=> 'not-secret';api.fetcher=async()=>{count++;throw Error('socket failed');};await assert.rejects(()=>api.generate({}),/socket failed/);assert.equal(count,1);});
test('current and legacy session identifiers refresh once; malformed identifiers never enter an auth URL',async()=>{
 for(const session of ['session_a123456','sess_ABC123']){
  const urls=[];const api=new CurrentSunoAPI({cookie:'__client=fixture-refresh',fetcher:async url=>{urls.push(url);return new Response(JSON.stringify(url.includes('/tokens')?{jwt:'fixture.access.token'}:{response:{last_active_session_id:session}}));}});
  assert.equal(await api.token(),'fixture.access.token');assert.equal(await api.token(),'fixture.access.token');assert.equal(urls.length,2);assert.equal(new URL(urls[1]).pathname,'/v1/client/sessions/'+session+'/tokens');
 }
 for(const session of ['session_a/../tokens','session_a?x=1','session_','session_'+'a'.repeat(129),'session_a\n']){
  let requests=0;const api=new CurrentSunoAPI({cookie:'__client=fixture-refresh',fetcher:async()=>{requests++;return new Response(JSON.stringify({response:{last_active_session_id:session}}));}});
  await assert.rejects(()=>api.token(),/SUNO_AUTH_OR_PERMISSION_FAILED/);assert.equal(requests,1);
 }
});
test('custom lyrics and styles stay separate and model names resolve only from the permitted live catalogue',()=>{
 const wild={...model,external_key:'chirp-hawk-wild',name:'v6-wild',max_lengths:{prompt:5000,tags:1000,title:100,negative_tags:1000}};
 assert.equal(selectSunoModel({models:[wild]},'v6-wild').external_key,'chirp-hawk-wild');
 const p=currentMusicPayload({mode:'custom',prompt:'task brief',lyrics:'[Verse]\n我们出发',styles:'温暖民谣',title:'启程',negativeStyles:'EDM',instrumental:false},wild,'operation');
 assert.equal(p.prompt,'[Verse]\n我们出发');assert.equal(p.tags,'温暖民谣');assert.equal(p.title,'启程');assert.equal(p.negative_tags,'EDM');assert.equal(p.metadata.create_mode,'custom');assert.equal(p.mv,'chirp-hawk-wild');assert.equal(p.make_instrumental,false);
 assert.throws(()=>currentMusicPayload({mode:'custom',lyrics:'a'.repeat(5001),styles:'folk'},wild,'id'),/SUNO_PROMPT_TOO_LONG/);
});
test('an unrecognised CAPTCHA response blocks submission rather than assuming access',async()=>{
 const api=new CurrentSunoAPI({cookie:'__client=fixture'});api.account=async()=>({models:[model],total_credits_left:500});api.request=async()=>({captcha_version:2});
 await assert.rejects(()=>api.preflight({prompt:'music',instrumental:true},'auto','id'),/SUNO_PROTOCOL_CHANGED/);
});
