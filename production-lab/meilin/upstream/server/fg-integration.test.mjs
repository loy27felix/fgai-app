import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createServer} from 'node:http';
import {mkdtemp,rm,readFile,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

process.env.MEILIN_MODE='fg';process.env.MEILIN_NO_LISTEN='1';process.env.MEILIN_INTERNAL_SECRET='test-only-local-identity-secret';
const {chat}=await import('./llm.mjs');
const temp=await mkdtemp(join(tmpdir(),'meilin-fg-test-'));process.env.MEILIN_FILES_DIR=temp;process.env.MEILIN_SKILLS_DIR=join(temp,'skills');
const {capabilities}=await import('./fg/fg-model-capabilities.mjs');
const {runContext}=await import('./fg-context.mjs');
const contract=await import('./fg-contract.mjs');
const store=await import('./fg-store.mjs');
const brain=await import('./brain.mjs');
const production=await import('./fg-production.mjs');
const skills=await import('./skills.mjs');
const {createMeilinServer,recoverStudio}=await import('./fg-server.mjs');
const actor={id:'72f7e666-928a-4b00-8b01-a49fbf07683b',name:'甲'},other={id:'82f7e666-928a-4b00-8b01-a49fbf07683b',name:'乙'};
const image='dola-seedream-5-0-pro-260628';
const models=[{id:'claude-sonnet-5-5-t3a',label:'Text',capability:'text',default:true,cap:capabilities({id:'claude-sonnet-5-5-t3a',capability:'text',protocol:'openai'})},{id:image,label:'Image',capability:'image',default:true,cap:capabilities({id:image,capability:'image',protocol:'ark'})},{id:'dreamina-seedance-2-5-filter-off',label:'Video',capability:'video',default:true,cap:capabilities({id:'dreamina-seedance-2-5-filter-off',capability:'video',protocol:'ark'})}];
const memory=new PGlite();await memory.exec('CREATE TABLE users(id varchar(36) PRIMARY KEY);');await memory.query('INSERT INTO users VALUES($1),($2)',[actor.id,other.id]);
const pool={query:async(sql,values)=>{if(!values&&sql.includes(';')){await memory.exec(sql);return {rows:[],rowCount:0};}const r=await memory.query(sql,values);return {...r,rowCount:r.affectedRows??r.rows.length};},connect:async()=>({...pool,release(){}})};
await store.initialize(pool);
let submissions=0,polls=0,unavailable=false,streamingText=false,streamPoll=0;
const tasks=new Map();
const upstream=createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const input=JSON.parse(Buffer.concat(chunks).toString()||'{}'),action=req.url.split('/').at(-1);contract.readIdentity(req.headers,req.method,req.url,process.env.MEILIN_INTERNAL_SECRET);
 let data;if(action==='catalog')data={models,budget:{monthlyCny:10,usedCny:0,remainingCny:10,unknown:0}};
 if(action==='quote')data={estimatedCny:.2,lines:['¥0.2'],notes:['待核销'],budget:{monthlyCny:10,remainingCny:10}};
 if(action==='submit'){if(unavailable){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:'等待恢复'}));return;}let task=tasks.get(input.operationId);if(!task){submissions++;task={taskId:randomUUID(),status:'running'};tasks.set(input.operationId,task);}data=task;}
 if(action==='task'){polls++;if(streamingText){streamPoll++;data={taskId:input.taskId,status:streamPoll===1?'running':'succeeded',replay:{deltas:streamPoll===1?[{sequence:1,content:'实时'}]:[{sequence:2,content:'正文'}]},result:{text:'实时正文'}};}else data={taskId:input.taskId,status:'succeeded',result:{resourceId:'resource-test',url:'/api/fg/meilin/dramas/test/media/test',text:'测试文本'}};}
 if(action==='costs')data={calls:[],budget:{monthlyCny:10,remainingCny:10}};
 res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(data));});
await new Promise(r=>upstream.listen(0,'127.0.0.1',r));process.env.MEILIN_GATEWAY_URL=`http://127.0.0.1:${upstream.address().port}`;
const app=createMeilinServer();await new Promise(r=>app.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.address().port}`;
test.after(async()=>{await Promise.all([new Promise(r=>app.close(r)),new Promise(r=>upstream.close(r))]);await memory.close();await rm(temp,{recursive:true,force:true});});
const scoped=(who,fn,id)=>runContext({actor:who,models,dramaId:id||randomUUID()},fn);

test('Postgres enforces ownership, sharing roles, revisions and soft deletion',async()=>{
 let d;await scoped(actor,async()=>{d=brain.createDrama();await store.save(d);});
 await scoped(other,async()=>{assert.equal(await store.get(d.id),null);assert.equal((await store.list()).length,0);assert.equal(await store.fileAccess('missing.png'),false);});
 await scoped(actor,()=>store.members(d.id,{userId:other.id,role:'viewer'}));
 await scoped(other,async()=>{assert.ok(await store.get(d.id));await assert.rejects(store.get(d.id,true),/编辑权限/);await assert.rejects(store.remove(d.id),/所有者/);});
 await scoped(actor,()=>store.members(d.id,{userId:other.id,role:'editor'}));
 await scoped(other,async()=>{const a=await store.get(d.id,true),b=await store.get(d.id,true);a.title='协作';await store.save(a);await assert.rejects(store.save(b),/更新/);});
 await scoped(actor,async()=>{await store.remove(d.id);assert.equal(await store.get(d.id),null);});
});
test('quote cancellation creates no task, expiry and tampering cannot confirm',async()=>{
 await scoped(actor,async()=>{const d=brain.createDrama();d.assets.items=[{code:'@场景1',versions:[{id:'v'}],current:'v',status:'rendering'}];
 await production.prepare(d,[{type:'image',code:'@场景1',version:'v',model:image,params:{size:'2048x2048'},prompt:'房间'}]);
 const op=d.production[0],before=submissions;
 await assert.rejects(production.confirm(d,[op.id],{[op.id]:'bad'}),/变化/);
 const old=op.quotedAt;op.quotedAt=0;await assert.rejects(production.confirm(d,[op.id],{[op.id]:op.digest}),/过期/);op.quotedAt=old;
 production.cancel(d,[op.id]);await production.refresh(d);assert.equal(submissions,before);assert.equal(d.assets.items[0].status,'draft');
 });
});
test('confirmed operations survive document reload, reuse task ID and update only their target version',async()=>{
 let d;await scoped(actor,async()=>{d=brain.createDrama();d.assets.items=[{code:'@场景1',versions:[{id:'v1'},{id:'v2'}],current:'v2',status:'draft'}];
 await production.prepare(d,[{type:'image',code:'@场景1',version:'v1',model:image,params:{size:'2048x2048'},prompt:'房间'}]);const op=d.production[0];await production.confirm(d,[op.id],{[op.id]:op.digest});await store.save(d);
 });
 await scoped(actor,async()=>{const loaded=await store.get(d.id),before=submissions;await production.refresh(loaded);assert.equal(submissions,before+1);assert.ok(loaded.production[0].taskId);await production.refresh(loaded);assert.equal(submissions,before+1);assert.equal(loaded.assets.items[0].current,'v2');assert.ok(loaded.assets.items[0].versions[0].url);assert.equal(loaded.assets.items[0].status,'draft');},d.id);
});
test('HTTP denies unsigned reads and media, signed configuration contains no credentials',async()=>{
 assert.equal((await fetch(base+'/api/dramas')).status,403);assert.equal((await fetch(base+'/files/test.png')).status,403);
 const path='/api/config',r=await fetch(base+path,{headers:contract.signIdentity(actor,'GET',path,process.env.MEILIN_INTERNAL_SECRET)});assert.equal(r.status,200);const c=await r.json();assert.equal(c.media,'fg-tasks');assert.equal(c.models.length,3);assert.equal(JSON.stringify(c).includes(process.env.MEILIN_INTERNAL_SECRET),false);
});
test('creation replay uses the same project ID and another account cannot read it',async()=>{
 const id=randomUUID(),headers={...contract.signIdentity(actor,'POST','/api/dramas',process.env.MEILIN_INTERNAL_SECRET),'x-fg-operation-id':id,'content-type':'application/json'};
 const a=await fetch(base+'/api/dramas',{method:'POST',headers,body:'{}'});assert.equal(a.status,200);assert.equal((await a.json()).id,id);
 const b=await fetch(base+'/api/dramas',{method:'POST',headers,body:'{}'});assert.equal(b.status,200);assert.equal((await b.json()).id,id);
 const path='/api/dramas/'+id;assert.equal((await fetch(base+path,{headers:contract.signIdentity(other,'GET',path,process.env.MEILIN_INTERNAL_SECRET)})).status,404);
});
test('an existing script skips AI planning and remains editable without a model call',async()=>{
 await scoped(actor,async()=>{const d=brain.createDrama(),before=submissions;
  assert.equal(d.settings.skills.script,'short-drama-factory');
  const result=await brain.act(d,'script.start',{title:'原稿测试',text:'第一集\nA：原稿台词。',language:'中文',episodeSeconds:60});
  assert.equal(submissions,before);assert.equal(result.nav.episode,1);assert.equal(d.stage,'ready');
  assert.equal(d.episodes[0].scripts.upload,'第一集\nA：原稿台词。');assert.equal(d.episodes[0].chosen,null);
  await brain.act(d,'bible.update',{value:{faces:'保持原稿人物',stylePrompt:'自然纪实光线'}});
  assert.equal(d.bible.faces,'保持原稿人物');assert.equal(d.episodes[0].scripts.upload,'第一集\nA：原稿台词。');
  await assert.rejects(brain.act(d,'script.start',{text:'不能覆盖'}),/已开始/);
 });
});
test('streaming action sends immediate feedback and a committed final document',async()=>{
 let d;await scoped(actor,async()=>{d=brain.createDrama();await store.save(d);});
 const path='/api/dramas/'+d.id+'/action',headers={...contract.signIdentity(actor,'POST',path,process.env.MEILIN_INTERNAL_SECRET),'x-fg-operation-id':randomUUID(),'content-type':'application/json',accept:'text/event-stream'};
 const r=await fetch(base+path,{method:'POST',headers,body:JSON.stringify({type:'memory.add',payload:{text:'流式操作只保存一次'}})});
 assert.equal(r.status,200);const wire=await r.text();assert.match(wire,/event: status/);assert.match(wire,/event: final/);
 await scoped(actor,async()=>assert.equal((await store.get(d.id)).memory.filter(m=>m.text==='流式操作只保存一次').length,1));
});
test('text task forwards real incremental deltas before its final result',async()=>{
 const updates=[];streamingText=true;streamPoll=0;
 try{await runContext({actor,models,dramaId:randomUUID(),operationId:randomUUID(),emit:(event,data)=>updates.push({event,...data})},async()=>{
  assert.equal(await chat({model:models[0].id,system:'test',messages:[],streamPresentation:'script'}), '实时正文');
 });assert.deepEqual(updates.filter(x=>x.event==='text').map(x=>x.text),['实时','实时正文']);}
 finally{streamingText=false;}
});
test('style decoding rejects more than six references before a model call',async()=>{
 await scoped(actor,async()=>{
  const d=brain.createDrama();d.bible={};d.uploads=Array.from({length:7},(_,i)=>({id:String(i),mime:'image/png',url:`/files/${randomUUID()}.png`,name:`参考${i}`}));
  const before=submissions;
  await assert.rejects(brain.act(d,'style.decode',{refs:d.uploads.map(u=>u.id)}),/最多.*6|一到六/);
  assert.equal(submissions,before);
 });
});
test('creation, confirmation and deletion have durable audit events',async()=>{
 let id;
 await scoped(actor,async()=>{const d=brain.createDrama();id=d.id;await store.save(d);});
 await runContext({actor,models,dramaId:id,action:'confirm'},async()=>{const d=await store.get(id);await store.save(d);await store.remove(id);});
 const events=(await memory.query('SELECT action FROM fg_meilin_events WHERE drama_id=$1 ORDER BY created_at,id',[id])).rows.map(x=>x.action);
 assert.equal(events.filter(x=>x==='create').length,1);assert.ok(events.includes('confirm'));assert.equal(events.filter(x=>x==='delete').length,1);
});
test('an incomplete external skill package is rejected instead of silently shortened',async()=>{
 const dir=join(process.env.MEILIN_SKILLS_DIR,'zy-cinematic-realism');await mkdir(dir,{recursive:true});await writeFile(join(dir,'SKILL.md'),'test skill entry');
 await scoped(actor,async()=>{assert.throws(()=>skills.loadSkill('render','zy-cinematic-realism','compile','gpt-image-2'),/技能文件缺失/);});
});

test('new director projects retain their selected route without submitting a model task',async()=>{
 const path='/api/dramas',before=submissions,operationId=randomUUID();
 const r=await fetch(base+path,{method:'POST',headers:{...contract.signIdentity(actor,'POST',path,process.env.MEILIN_INTERNAL_SECRET),'x-fg-operation-id':operationId,'content-type':'application/json'},body:JSON.stringify({chain:'prism'})});
 assert.equal(r.status,200);const d=await r.json();assert.equal(d.studio.chain,'prism');assert.equal(d.id,operationId);assert.equal(submissions,before);
 await scoped(other,async()=>assert.equal(await store.get(d.id),null));
});

test('queued conversation survives HTTP completion, reports a worker failure and reuses the original task on retry',async()=>{
 const {phaseSources}=await import('./studio-skills.mjs');
 for(const [id,file] of phaseSources('prism','concept')){const p=join(process.env.MEILIN_SKILLS_DIR,id,file);await mkdir(join(p,'..'),{recursive:true});await writeFile(p,'完整本地测试方法');}
 let d;await scoped(actor,async()=>{d=brain.createDrama();const {initializeStudio}=await import('./studio.mjs');initializeStudio(d,{chain:'prism'});await store.save(d);});
 const path='/api/dramas/'+d.id+'/studio',op=randomUUID(),headers={...contract.signIdentity(actor,'POST',path,process.env.MEILIN_INTERNAL_SECRET),'x-fg-operation-id':op,'content-type':'application/json'},before=submissions;
 const r=await fetch(base+path,{method:'POST',headers,body:JSON.stringify({type:'turn',text:'写一个神殿反击故事'})});assert.equal(r.status,200);const queued=await r.json();assert.equal(queued.project.studio.runs[0].status,'queued');assert.equal(submissions,before);assert.equal(queued.project.studio.runs[0].request,undefined);
 const awaitFailure=async()=>{for(let i=0;i<100;i++){const saved=await scoped(actor,()=>store.get(d.id));if(saved.studio.runs[0].status==='failed')return saved;await new Promise(r=>setTimeout(r,20));}throw Error('worker did not finish');};
 await recoverStudio();const failed=await awaitFailure();assert.match(failed.studio.runs[0].error,/JSON|解析/);assert.equal(submissions,before+1);
 await scoped(actor,async()=>{const saved=await store.get(d.id,true);const {studioAction}=await import('./studio.mjs');studioAction(saved,'retry',{id:op});await store.save(saved);});
 await recoverStudio();await awaitFailure();assert.equal(submissions,before+1);
});
