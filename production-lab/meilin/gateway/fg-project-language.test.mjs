import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import './check-language-contract.mjs';
import {projectLanguageRoute,guardProjectLanguageTask,applyLanguageToTask} from './fg-project-language.mjs';
import {originalEnglishDialogue,lockDialogueToOriginal,assertOriginalEnglishRows,assertLockedEnglishPrompt,applyProjectLanguage,normalizeProjectLanguage} from './shared/project-language.mjs';
const source='<p>迪伦（压低声音）：别碰那根弦。</p><p>Dylan (quietly): Don\'t touch that string.</p><p>艾娃：我没有。</p><p>Ava: I didn’t.</p>';
test('bilingual source is paired without translating or changing original English',()=>{
 const lines=originalEnglishDialogue(source);assert.equal(lines.length,2);assert.equal(lines[0].text,"Don't touch that string.");
 assert.equal(lockDialogueToOriginal('迪伦：别碰那根弦。\n艾娃：我没有。',source),"Dylan：Don't touch that string.\nAva：I didn’t.");
 assert.throws(()=>lockDialogueToOriginal('Dylan: Please avoid touching the string.',source),/原稿英文/);
});
test('storyboards preserve original words, speaker, order and line coverage',()=>{
 const lines=originalEnglishDialogue(source);
 assert.doesNotThrow(()=>assertOriginalEnglishRows([{dialogue:"Dylan: Don't touch that string.\nAva: I didn’t."}],lines));
 for(const dialogue of ["Dylan: Don't touch that string.","Dylan: Do not touch that string.\nAva: I didn’t.","Ava: Don't touch that string.\nDylan: I didn’t.","Dylan: 别碰那根弦。\nAva: 我没有。"])
  assert.throws(()=>assertOriginalEnglishRows([{dialogue}],lines));
});
test('English prompt lock checks performed speech and tolerates Chinese production notes',()=>{
 const dialogue="Dylan: Don't touch that string.";
 assert.doesNotThrow(()=>assertLockedEnglishPrompt(dialogue,"【声音设计】\n声线：成年男性，低声。\n对白：\n0—3秒 Dylan：Don't touch that string.\n【负面约束】无字幕。"));
 assert.throws(()=>assertLockedEnglishPrompt(dialogue,'【声音设计】\n对白：\nDylan：别碰那根弦。'));
});

test('manual Markdown editing preserves locked dialogue with sound effect labels',()=>{
 const dialogue='Ethan: Leave it alone.';
 assert.doesNotThrow(()=>assertLockedEnglishPrompt(dialogue,'## 【声音设计】\n**背景音乐：** 低音量配乐。\n**音效SFX：** 衣料摩擦。\n**对白：**\n**Ethan（压低声音）：** Leave it alone.\n## 【负面约束】\n无字幕。'));
 assert.doesNotThrow(()=>assertLockedEnglishPrompt(dialogue,'【声音设计】\n背景音乐：低音量配乐。\n环境音效：脚步声。\n音效SFX：衣料摩擦。\nEthan: Leave it alone.'));
});

test('manual editing errors distinguish missing, Chinese and changed original dialogue',()=>{
 const dialogue='Ethan: Leave it alone.';
 assert.throws(()=>assertLockedEnglishPrompt(dialogue,'【声音设计】\n对白：无。'),/缺少.*原英文/);
 assert.throws(()=>assertLockedEnglishPrompt(dialogue,'【声音设计】\n对白：\nEthan：愤怒地提高音量。'),/中文或制作说明/);
 assert.throws(()=>assertLockedEnglishPrompt(dialogue,'【声音设计】\n对白：\nEthan: Please leave it.'),/第1句.*原英文/);
 assert.throws(()=>assertLockedEnglishPrompt(dialogue,'【声音设计】\n对白：\nEthan: Leave it alone.\nOther: An invented line.'),/额外/);
 assert.throws(()=>assertLockedEnglishPrompt('','【声音设计】\n**对白：**\nOther: An invented line.'));
});
test('project policy is opt in, explicit, bounded, and appended once',()=>{
 assert.equal(applyProjectLanguage('既有项目',undefined),'既有项目');
 const policy={version:1,spoken:'en-original',screenText:'no-zh'};
 const prompt=applyProjectLanguage('制作说明',policy,'video');assert.match(prompt,/不重新翻译/);assert.match(prompt,/画面禁止出现中文/);
 assert.equal(applyProjectLanguage(prompt,policy,'video'),prompt);
 assert.throws(()=>normalizeProjectLanguage({...policy,ownerId:'other'}));
 assert.throws(()=>normalizeProjectLanguage({...policy,spoken:'translate-freely'}));
});
const policy={version:1,spoken:'en-original',screenText:'no-zh'},id='a'.repeat(32),other='b'.repeat(32);
function response(){return {writeHead(status){this.status=status;},end(body){this.body=JSON.parse(body);}};}
const request=body=>Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]),{method:'POST'});
test('settings require native project permission before reading policy or writing anything',async()=>{
 const req={method:'GET'},res=response();let settingsReads=0;
 const pool={query:async sql=>{if(sql.includes('FROM projects'))return {rows:[{id}]};settingsReads++;return {rows:[]};}};
 await projectLanguageRoute(req,res,{pool,actor:{id:'member'},path:new URL('http://test/api/fg/project-language/'+id),access:async()=>{throw Object.assign(Error('denied'),{status:403});}});
 assert.equal(res.status,403);assert.equal(settingsReads,0);
});
test('settings save is scoped, versioned and rejects a stale editor',async()=>{
 let saved,writeKeys=[],rolledBack=false;const pool={release(){},connect:async()=>pool,query:async(sql,args)=>{
  if(sql.includes('SELECT value_json'))return {rows:saved?[{value_json:JSON.stringify(saved)}]:[]};
  if(sql.startsWith('INSERT')){writeKeys.push(args[0]);saved=JSON.parse(args[1]);}
  if(sql==='ROLLBACK')rolledBack=true;return {rows:[]};
 }};
 const context={pool,actor:{id:'member'},path:new URL('http://test/api/fg/project-language/'+id),access:async target=>assert.equal(target,id)};
 const res=response();await projectLanguageRoute(Object.assign(request({policy,expectedRevision:null}),{method:'PUT'}),res,context);
 assert.equal(res.status,200);assert.deepEqual(writeKeys,['project-language:'+id]);assert.ok(res.body.data.revision);
 const stale=response();await projectLanguageRoute(Object.assign(request({policy,expectedRevision:null}),{method:'PUT'}),stale,context);
 assert.equal(stale.status,409);assert.equal(writeKeys.length,1);assert.equal(rolledBack,true);
});
test('shot video uses the submitted prompt and still validates real project and saved revision',async()=>{
 let accesses=[];const pool={query:async(sql,args)=>{
  if(sql.includes('FROM projects')){assert.deepEqual(args,[id]);return {rows:[{id}]};}
  if(sql.includes('system_settings')){assert.equal(args[0],'project-language:'+id);return {rows:[{value_json:JSON.stringify({policy,revision:'r1'})}]};}
  if(sql.includes('FROM shots')){assert.deepEqual(args,[id,'shot']);return {rows:[{current_revision_id:'revision',dialogue:'迪伦：别碰那根弦。',source_text:source}]};}
  throw Error('unexpected query');
 }};
 const context={pool,path:new URL('http://test/api/tasks'),access:async target=>accesses.push(target)};
 const body={projectId:id,type:'canvas_video',prompt:'【声音设计】\n对白：\nDylan：别碰那根弦。',input:{mode:'video',metadata:{domainProjectId:other,shotId:'shot',shotRevisionId:'revision'}}};
 for(const prompt of [body.prompt,'只拍人物走向楼梯，全程无对白。','【声音设计】\n对白：\nDylan: This is my manually edited line.']){
  body.prompt=prompt;const accepted=request(body);assert.equal(await guardProjectLanguageTask(accepted,response(),context),true);
  assert.equal(JSON.parse(accepted.fgReplayBody).prompt,prompt);
 }
 assert.deepEqual(accesses,[id,id,id]);
 const stale=response();assert.equal(await guardProjectLanguageTask(request({...body,input:{...body.input,metadata:{...body.input.metadata,shotRevisionId:'stale'}}}),stale,context),false);
 assert.equal(stale.status,409);
 const denied=response();assert.equal(await guardProjectLanguageTask(request(body),denied,{...context,access:async()=>{throw Object.assign(Error('denied'),{status:403});}}),false);
 assert.equal(denied.status,403);
});

test('manual shot video does not inherit old language policy or overwrite the actual artifact prompt',()=>{
 const body={type:'canvas_video',prompt:'用户手动修改的对白',input:{mode:'video',prompt:'用户手动修改的对白',metadata:{shotId:'shot',projectLanguagePolicy:{version:1,spoken:'source',screenText:'source'},artifactMetadata:{actualPrompt:'用户手动修改的对白'}}}};
 assert.deepEqual(applyLanguageToTask(body,{policy}),body);
 const automatic={...body,type:'canvas_text',input:{...body.input,mode:'text',metadata:{shotId:'shot'}}};
 assert.match(applyLanguageToTask(automatic,{policy}).prompt,/不重新翻译/);
});
test('prepared policy snapshots detect settings changes and retain the exact artifact prompt',()=>{
 const body={prompt:'当前镜头',input:{mode:'image',metadata:{projectLanguagePolicy:policy,artifactMetadata:{referenceManifest:[{assetId:'hero'}]}}}};
 const result=applyLanguageToTask(body,{policy});assert.equal(result.prompt,result.input.metadata.artifactMetadata.actualPrompt);
 assert.deepEqual(result.input.metadata.artifactMetadata.referenceManifest,[{assetId:'hero'}]);
 assert.throws(()=>applyLanguageToTask(body,{policy:{version:1,spoken:'source',screenText:'source'}}),/已变化/);
});
test('a silent locked shot cannot invent speech',()=>{
 assert.throws(()=>assertLockedEnglishPrompt('','【声音设计】\n对白：\nDylan: An invented line.'));
 assert.doesNotThrow(()=>assertLockedEnglishPrompt('','【声音设计】\n对白：无对白。'));
});
test('native image template recompilation retains the policy in an actual protected variable',()=>{
 const body={prompt:'模板占位',input:{mode:'image',metadata:{promptTemplateOperation:'character_turnaround',promptTemplateVariables:{角色名称:'迪伦',角色设定:'成年男性',项目画风:'真人'}}}};
 const result=applyLanguageToTask(body,{policy});assert.match(result.input.metadata.promptTemplateVariables.角色设定,/画面禁止出现中文/);
 assert.equal(result.input.metadata.promptTemplateVariables.角色名称,'迪伦');
 assert.deepEqual(applyLanguageToTask(result,{policy}),result);
});
