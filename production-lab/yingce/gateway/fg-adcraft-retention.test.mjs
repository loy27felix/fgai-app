import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cleanupArchivedAdvertising,purgeArchivedAdvertising} from './fg-adcraft-retention.mjs';

for(const state of ['restored','running','offline','ready'])test('advertising retention: '+state,async()=>{
  const calls=[];
  const client={query:async(sql,args)=>{
    calls.push(sql);
    if(sql.startsWith('SELECT *'))return {rows:state==='restored'?[]:[{id:'old-workspace',native_project_id:'native-project',archived_at:new Date()}]};
    if(sql.startsWith('SELECT count'))return {rows:[{n:state==='running'?1:0}]};
    return {rows:[]};
  },release(){calls.push('released');}};
  const pool={query:async()=>({rows:[{id:'old-workspace'}]}),connect:async()=>client};
  let requested=0;
  const result=await cleanupArchivedAdvertising(pool,async(url,options)=>{
    requested++;assert.equal(options.method,'POST');assert.match(url,/cleanup\/old-workspace$/);
    return Response.json({purged:state==='ready'},{status:state==='offline'?503:200});
  });
  assert.equal(result,state==='ready'?1:0);
  assert.equal(requested,['restored','running'].includes(state)?0:1);
  assert.equal(calls.some(x=>x.startsWith('UPDATE')),state==='ready');
  assert.ok(calls.includes(state==='ready'?'COMMIT':'ROLLBACK'));
  assert.ok(calls.includes('released'));
});

for(const state of ['foreign','active','running','offline','ready','already-purged'])test('manual purge: '+state,async()=>{
  const calls=[];let requested=0;
  const pool={connect:async()=>({query:async sql=>{calls.push(sql);
    if(sql.startsWith('SELECT *'))return {rows:[{id:'workspace',owner_id:state==='foreign'?'other':'owner',native_project_id:'native',archived_at:state==='active'?null:new Date(),purged_at:state==='already-purged'?new Date():null}]};
    if(sql.startsWith('SELECT count'))return {rows:[{n:state==='running'?1:0}]};return {rows:[]};},release(){calls.push('released');}})};
  const action=()=>purgeArchivedAdvertising(pool,'workspace',{actor:{id:'owner'},request:async()=>{requested++;return Response.json({purged:true},{status:state==='offline'?503:200});}});
  if(['ready','already-purged'].includes(state))assert.equal(await action(),true);else await assert.rejects(action);
  assert.equal(requested,['ready','offline'].includes(state)?1:0);
  assert.equal(calls.some(sql=>sql.startsWith('UPDATE')),state==='ready');
  assert.ok(calls.includes(['ready','already-purged'].includes(state)?'COMMIT':'ROLLBACK'));assert.ok(calls.includes('released'));
});
