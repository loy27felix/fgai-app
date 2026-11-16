import test from 'node:test';import assert from 'node:assert/strict';import {Readable} from 'node:stream';
import {normalizePersonalEntry,personalInspirationRoute,personalInspirationState,sharedPersonalInspirations} from './fg-inspiration-personal.mjs';
import {normalizeCatalog,catalogSources} from './fg-inspiration-catalog.mjs';
import {distinctInspiration,inspirationRoute} from './fg-inspiration.mjs';
const id='a'.repeat(24);const entry={id,title:'我的分镜',prompt:'保持人物一致',kind:'text',user_id:'someone-else'};
function database(){
 const rows=new Map();let rollbacks=0;
 const pool={async query(sql,args=[]){if(sql==='SELECT * FROM fg_inspiration_sources')return {rows:[]};if(sql.includes('JOIN users'))return {rows:[...rows].map(([user_id,v])=>({user_id,custom:structuredClone(v.custom),username:user_id}))};return {rows:rows.has(args[0])?[structuredClone(rows.get(args[0]))]:[]};},async connect(){let staged=new Map([...rows].map(([k,v])=>[k,structuredClone(v)]));return {release(){},async query(sql,args=[]){
  if(sql==='BEGIN')return {rows:[]};if(sql==='ROLLBACK'){rollbacks++;return {rows:[]};}if(sql==='COMMIT'){rows.clear();for(const [k,v]of staged)rows.set(k,v);return {rows:[]};}
  if(sql.startsWith('INSERT')){if(!staged.has(args[0]))staged.set(args[0],{custom:[],favorites:[]});return {rows:[]};}
  if(sql.startsWith('SELECT'))return {rows:[structuredClone(staged.get(args[0]))]};
  if(sql.startsWith('UPDATE')){staged.set(args[0],{custom:JSON.parse(args[1]),favorites:JSON.parse(args[2])});return {rows:[]};}
  throw Error('Unexpected SQL');
 }}}};return {pool,rows,get rollbacks(){return rollbacks;}};
}
async function post(db,path,body,actor={id:'alice'}){let response;const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.method='POST';assert(await personalInspirationRoute(req,{}, {pool:db.pool,actor,path:new URL('https://fg.test/api/fg/inspiration/'+path),send:(data,status=200)=>response={data,status}}));return response;}
test('personal inspiration never accepts caller supplied ownership or unsafe URLs',()=>{
 const normal=normalizePersonalEntry(entry);assert.equal(normal.sourceId,'mine');assert.equal(normal.user_id,undefined);assert.equal(normal.kind,'text');
 assert.throws(()=>normalizePersonalEntry({...entry,cover:'javascript:alert(1)'}));assert.throws(()=>normalizePersonalEntry({...entry,prompt:''}));
});
test('shared personal inspirations preserve ownership while favorites remain account isolated',async()=>{
 const db=database();const saved=await post(db,'custom',entry);assert.equal(saved.status,200);const savedId=saved.data.custom[0].id;await post(db,'favorites',{id:savedId,favorite:true});
 assert.deepEqual(await personalInspirationState(db.pool,'admin'),{custom:[],favorites:[]});
 await post(db,'custom',{...entry,title:'管理员的独立副本'}, {id:'admin',reviewer:true});
 assert.equal((await personalInspirationState(db.pool,'alice')).custom[0].title,entry.title);
 assert.equal((await personalInspirationState(db.pool,'admin')).custom[0].title,'管理员的独立副本');
 assert.deepEqual((await personalInspirationState(db.pool,'admin')).favorites,[]);
 const shared=await sharedPersonalInspirations(db.pool);assert.equal(shared.length,2);assert.equal(shared.find(e=>e.ownerId==='alice').creatorName,'alice');
 let detail;await inspirationRoute({method:'GET'},{writeHead(){},end(s){detail=JSON.parse(s);}},{pool:db.pool,actor:{id:'bob'},path:new URL('https://fg.test/api/fg/inspiration/items/'+savedId)});
 assert.equal(detail.code,0);assert.equal(detail.data.ownerId,'alice');assert.deepEqual((await personalInspirationState(db.pool,'bob')).favorites,[]);
});
test('invalid import rolls back every entry and favorite in the same batch',async()=>{
 const db=database();await post(db,'custom',entry);const before=structuredClone(db.rows.get('alice'));
 assert.equal((await post(db,'import',{entries:[{...entry,id:'b'.repeat(24)},{...entry,prompt:''}],favorites:['c'.repeat(24)]})).status,400);
 assert.deepEqual(db.rows.get('alice'),before);assert.equal(db.rollbacks,1);
});
test('export and import preserve an empty personal library and public favorite IDs',async()=>{
 const db=database();await post(db,'favorites',{id,favorite:true});let result;
 await inspirationRoute({method:'GET'},{writeHead(){},end(s){result=JSON.parse(s);}},{pool:db.pool,actor:{id:'alice'},path:new URL('https://fg.test/api/fg/inspiration/export')});
 assert.deepEqual(result.data.entries,[]);assert.deepEqual(result.data.favorites,[id]);
 assert.equal((await post(db,'import',result.data,{id:'bob'})).status,200);assert.deepEqual((await personalInspirationState(db.pool,'bob')).favorites,[id]);
});
test('canonical catalog keeps original video page, credit, detailed category and license',()=>{
 const source=catalogSources[0];const [e]=normalizeCatalog({revision:'2026-10-08',categories:{vlog:'手持 UGC Vlog'},entries:[{id:'ugc',title:'案例',prompt:'镜头推进',mode:'video',image:'https://example.com/cover.png',sourceUrl:'https://goodcase.ai/case/123',credit:'@author',category:'vlog'}]},source);
 assert.equal(e.sourceUrl,'https://goodcase.ai/case/123');assert.equal(e.author,'@author');assert.equal(e.license,'CC BY 4.0');assert.equal(e.categoryName,'手持 UGC Vlog');assert.equal(e.playable,false);assert.equal(e.media[0].kind,'image');
});
test('catalog deduplication prefers original-page metadata while retaining existing favorite IDs',()=>{
 const old={...normalizePersonalEntry(entry),sourceId:'legacy',sourceUrl:'https://example.com/index'};
 const canonical={...old,id:'b'.repeat(24),sourceId:'catalog-seedance',sourceUrl:'https://goodcase.ai/case/123'};
 const [result]=distinctInspiration([old,canonical],[old.id]);assert.equal(result.id,old.id);assert.equal(result.sourceUrl,canonical.sourceUrl);
 assert.equal(distinctInspiration([old,canonical,{...old,sourceId:'mine'}]).length,2);
});
test('unauthenticated personal requests are rejected',async()=>{assert.equal((await post(database(),'custom',entry,null)).status,401);});
test('importing another account export creates a distinct public ID and remaps its favorite',async()=>{
 const db=database();const original=(await post(db,'custom',entry)).data.custom[0];
 const imported=await post(db,'import',{entries:[original],favorites:[original.id]},{id:'bob'});
 assert.equal(imported.status,200);assert.notEqual(imported.data.custom[0].id,original.id);assert.deepEqual(imported.data.favorites,[imported.data.custom[0].id]);
 assert.equal((await sharedPersonalInspirations(db.pool)).length,2);
});
