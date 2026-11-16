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
  assert.equal(url,'http://web:3000/api/public/resources/0d16feab117157e15f728f2d828fbf9b/file?signature=test');
 }finally{globalThis.fetch=original;}
});

test('server result downloads do not depend on an expired public tunnel hostname',async()=>{
 const original=globalThis.fetch;
 const id='0d16feab117157e15f728f2d828fbf9b';
 globalThis.fetch=async()=>new Response(JSON.stringify({code:0,data:{items:[{access:{url:'https://expired.trycloudflare.com/api/public/resources/'+id+'/file?expires=123&signature=test'}}]}}));
 try{
  assert.equal(await resultURL({},'test-cookie',{web:'http://web:3000',publicOrigin:'https://studio.example'}, {image:{resourceId:id}}),
   'http://web:3000/api/public/resources/'+id+'/file?expires=123&signature=test');
 }finally{globalThis.fetch=original;}
});

test('result download refuses a resource path that does not belong to the generated result',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({code:0,data:{items:[{access:{url:'https://elsewhere.example/admin?signature=test'}}]}}));
 try{
  await assert.rejects(resultURL({},'test-cookie',{web:'http://web:3000',publicOrigin:'https://studio.example'}, {image:{resourceId:'0d16feab117157e15f728f2d828fbf9b'}}),/素材链接路径/);
 }finally{globalThis.fetch=original;}
});
