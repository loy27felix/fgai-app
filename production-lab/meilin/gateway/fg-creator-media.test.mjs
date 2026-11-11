import test from 'node:test';
import assert from 'node:assert/strict';
import {creatorCapability,creatorInternalRoute} from './fg-creator.mjs';

test('owned native task IDs download without a new generation; other workspaces stay denied',async()=>{
 const originalFetch=globalThis.fetch,originalSecret=process.env.FG_ADCRAFT_SECRET;
 process.env.FG_ADCRAFT_SECRET='test-only-secret';
 const actor='70f9ee5d-510d-4bfd-a46e-6eec2a23a2b8';
 const calls=[];
 try{
  globalThis.fetch=async(url,init)=>{
   const path=new URL(url).pathname;calls.push([path,init?.method]);
   if(path.startsWith('/api/tasks/'))return Response.json({code:0,data:{status:'succeeded',resultJson:JSON.stringify({videos:[{resourceId:'fixture-resource'}]})}});
   if(path==='/api/resources/access')return Response.json({code:0,data:{items:[{access:{url:'/fixture-video'}}]}});
   if(path==='/fixture-video')return new Response('owned-video',{headers:{'content-type':'video/mp4'}});
   throw Error('Unexpected provider request');
  };
  for(const id of ['ff78e1e76b0d8ee0db39b71239e4adf5','12345678-1234-1234-1234-123456789012'])for(const owned of [true,false]){
   calls.length=0;let status,body='';
   const req={method:'GET',headers:{authorization:'Bearer '+creatorCapability(actor)}};
   const res={setHeader(){},writeHead(value){status=value},write(chunk){body+=Buffer.from(chunk).toString()},end(value=''){body+=value}};
   const pool={async query(sql,params){
    if(sql.includes('SELECT u.id'))return {rows:[{id:actor,name:'fixture',email:'fixture',platform_role:'member'}]};
    assert.deepEqual(params,[actor,id]);assert.ok(sql.includes('t.user_id=j.owner_id'));assert.ok(sql.includes('t.project_id IN'));
    return {rowCount:owned?1:0,rows:owned?[{task_id:id}]:[]};
   }};
   const path=new URL('http://fixture/internal/creator/'+actor+'/v1/media/'+id);
   await creatorInternalRoute(req,res,{pool,web:'http://fixture',publicOrigin:'http://fixture',canvasSession:async()=> 'fixture-cookie',path});
   assert.equal(status,owned?200:400);
   if(owned){assert.equal(body,'owned-video');assert.equal(calls.length,3);}
   else{assert.match(body,/结果不属于此工作区/);assert.equal(calls.length,0);}
  }
 }finally{
  globalThis.fetch=originalFetch;
  if(originalSecret===undefined)delete process.env.FG_ADCRAFT_SECRET;else process.env.FG_ADCRAFT_SECRET=originalSecret;
 }
});
