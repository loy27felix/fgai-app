import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {guardEditorWrite} from './fg-editor-leases.mjs';

test('canvas writes and deletion reach native authorization without an exclusive editor lock',async()=>{
 const pool={async connect(){throw Error('canvas must not acquire a gateway lock');}};
 for(const method of ['PUT','DELETE']) for(const actor of [{id:'member'},{id:'admin',reviewer:true}]) {
  const res={writeHead(){throw Error('gateway must not kick a collaborator');}};
  assert.equal(await guardEditorWrite({method,headers:{'x-fg-editor-key':'canvas:document','x-fg-editor-token':'old-token'}},res,{pool,actor,path:new URL('https://fg.test/api/canvas-projects/document')}),true);
 }
});
test('advertising continues to reject stale editor tokens',async()=>{
 let released=0;
 const id='a0000000-0000-0000-0000-000000000001';
 const client={release(){released++;},async query(sql){return {rows:sql.includes('SELECT * FROM fg_editor_leases')?[{resource_key:'ad:'+id,actor_id:'other',expires_at:new Date(Date.now()+45000)}]:[]};}};
 const pool={async connect(){return client;},async query(){return {rows:[{display_name:'同事'}]};}};
 const res=new EventEmitter();res.writeHead=status=>{res.statusCode=status;};res.end=()=>{};
 assert.equal(await guardEditorWrite({method:'PUT',headers:{}},res,{pool,actor:{id:'member'},path:new URL('https://fg.test/adcraft-api/'+id+'/project')}),false);
 assert.equal(res.statusCode,409);assert.equal(released,1);
});
