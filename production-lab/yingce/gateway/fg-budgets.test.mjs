import {test} from 'node:test';
import assert from 'node:assert/strict';
import {admissionPrice,monthStart,monthRange,spendUsage,reserveBudget} from './fg-budgets.mjs';
test('text budget reserves declared maximum output',()=>{
 const price={enabled:true,discount:.85,pricing_rules:{input_price:2,output_price:8}};
 const payload={messages:[{role:'user',content:'测试'}],max_tokens:2000};
 assert.equal(admissionPrice('text','text',payload,price,6.77),(Buffer.byteLength(JSON.stringify(payload))*2+2000*8)/1e6*.85*6.77);
 assert.equal(admissionPrice('unknown','text',payload,{enabled:false},6.77),null);
 assert.equal(admissionPrice('text','text',{messages:[]},price,6.77),null);
 assert.equal(admissionPrice('text','text',{...payload,messages:[{content:[{type:'image_url',image_url:{url:'x'}}]}]},price,6.77),null);
});
test('month history uses Shanghai half-open boundaries and rejects future or invalid months',()=>{
 assert.deepEqual(monthRange('2025-12'),{month:'2025-12',since:'2025-12-01T00:00:00+08:00',until:'2026-01-01T00:00:00+08:00'});
 assert.equal(monthRange('2024-02').until,'2024-03-01T00:00:00+08:00');
 for(const month of ['2025-13','2025-00','2025-2','2025-02-01','9999-12','1999-12'])assert.throws(()=>monthRange(month));
});
test('history applies the exclusive end to both charges and outstanding reservations',async()=>{
 const queries=[];const pool={query:async(sql,params)=>{queries.push({sql,params});return {rows:sql.includes("key='usdCnyRate'")?[{value:6.77}]:[]};}};
 const range=monthRange('2025-12');assert.deepEqual(await spendUsage(pool,{userId:'test',since:range.since,until:range.until}),{actual:0,pending:0,unknown:0,used:0});
 const charges=queries.find(q=>q.sql.includes('FROM api_call_logs c')),reserves=queries.find(q=>q.sql.includes('SELECT r.*'));
 for(const q of [charges,reserves]){assert.match(q.sql,/created_at<\$4/);assert.deepEqual(q.params,['test',null,range.since,range.until]);}
});
test('an incomplete multimodal quote cannot authorize a capped request',()=>{
 const price={enabled:true,discount:1,pricing_rules:{rules:[{tier:'standard',token_type:'Output image',image_size:'1K',price:.04}]}};
 assert.equal(admissionPrice('gemini-3-pro-image-preview','image',{quality:'1K'},price,6.77),null);
 assert.match(monthStart(),/^\d{4}-\d{2}-01T00:00:00\+08:00$/);
});

function speechBudgetPool({access=true,monthly=0,project=0}={}){
 const queries=[];
 const client={release(){},async query(sql,params){queries.push({sql,params});
  const rows=sql.includes("status='active'")?[{id:'member'}]:sql.includes('w.native_project_id')?(access?[{id:'ad-project'}]:[]):sql.includes('SELECT monthly_cny')?[{monthly_cny:monthly}]:sql.includes('SELECT budget_cny')?[{budget_cny:project}]:sql.includes('SELECT snapshot')?[{snapshot:{enabled:true,provider:'volcengine',pricing_rules:{}}}]:sql.includes("key='usdCnyRate'")?[{value:6.77}]:[];
  return {rows};
 }};return {queries,connect:async()=>client};
}
test('audio utilities reject inaccessible advertising contexts before reserving charges',async()=>{
 const pool=speechBudgetPool({access:false});
 await assert.rejects(()=>reserveBudget(pool,{userId:'member',advertisingWorkspaceId:'foreign',model:'volc.seedasr.auc',capability:'transcription'}),/无权/);
 assert.ok(pool.queries.some(q=>q.sql==='ROLLBACK'));assert.ok(!pool.queries.some(q=>q.sql.includes('INSERT INTO')));
});
test('unverified speech rates fail closed for either monthly or advertising limits',async()=>{
 for(const constraints of [{monthly:10},{project:10}])for(const [model,capability] of [['volc.speech.mt','translation'],['seed-tts-2.0','audio'],['seed-audio-1.0','audio']]){
  const pool=speechBudgetPool(constraints);
  await assert.rejects(()=>reserveBudget(pool,{userId:'member',advertisingWorkspaceId:'ad',model,capability}),/费用上限/);
  assert.ok(!pool.queries.some(q=>q.sql.includes('INSERT INTO')));
 }
 for(const [model,capability] of [['volc.speech.mt','translation'],['seed-tts-2.0','audio'],['seed-audio-1.0','audio']]){
 const pool=speechBudgetPool();const result=await reserveBudget(pool,{userId:'member',advertisingWorkspaceId:'ad',model,capability});
 assert.equal(result.reservedCny,null);assert.equal(pool.queries.find(q=>q.sql.includes('INSERT INTO')).params[2],'ad-project');
 }
});
