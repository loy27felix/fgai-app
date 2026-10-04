import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cleanupArchivedAdvertising} from './fg-adcraft-retention.mjs';

for(const state of ['restored','running','offline','ready'])test('advertising retention: '+state,async()=>{
  const calls=[];
  const client={query:async(sql,args)=>{
    calls.push(sql);
    if(sql.startsWith('SELECT *'))return {rows:state==='restored'?[]:[{id:'old-workspace',native_project_id:'native-project'}]};
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
