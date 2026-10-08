import test from 'node:test';
import assert from 'node:assert/strict';
import {resultURL} from './fg-adcraft.mjs';

test('advertising returns an accessible signed URL for an archived video',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async(_url,options)=>{
  const [{purpose,resourceId}]=JSON.parse(options.body);
  assert.equal(resourceId,'0d16feab117157e15f728f2d828fbf9b');
  // The native public resource API rejects provider-only access purposes.
  return new Response(JSON.stringify({code:0,data:{items:[purpose==='copy'?{access:{url:'/api/public/resources/'+resourceId+'/file?signature=test'}}:{error:{code:400}}]}}));
 };
 try{
  const url=await resultURL({},'test-cookie',{web:'http://web:3000',publicOrigin:'https://studio.example'}, {video:{storageKey:'resource:0d16feab117157e15f728f2d828fbf9b'}});
  assert.match(url,/^https:\/\/[^/]+\/api\/public\/resources\/0d16feab117157e15f728f2d828fbf9b\/file\?signature=test$/);
 }finally{globalThis.fetch=original;}
});
