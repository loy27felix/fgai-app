// Run against a disposable PostgreSQL schema. No user data or model requests.
import pg from 'pg';
import http from 'node:http';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {initializeEditorLeases,editorLeaseRoute,guardEditorWrite} from './fg-editor-leases.mjs';
process.env.FG_ADCRAFT_SECRET='integration-only-secret';
const root=new pg.Pool({connectionString:process.env.DATABASE_URL});
const schema='fg_lease_qa_'+randomUUID().replaceAll('-','');
await root.query('CREATE SCHEMA '+schema);
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:'-c search_path='+schema,max:8});
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002',key='ad:00000000-0000-4000-8000-000000000003';
let server;
try{
 await pool.query('CREATE TABLE users(id varchar(36) PRIMARY KEY,display_name text)');
 await pool.query("INSERT INTO users VALUES($1,'A'),($2,'B')",[a,b]);await initializeEditorLeases(pool);
 server=http.createServer(async(req,res)=>{
  try{const actor={id:req.headers['x-test-actor']},path=new URL(req.url,'http://localhost');
   if(await editorLeaseRoute(req,res,{pool,actor,path,advertisingAccess:async()=>true}))return;
   if(!await guardEditorWrite(req,res,{pool,actor,path}))return;
   setTimeout(()=>{res.writeHead(200);res.end('saved');},req.url.includes('slow')?150:0);
  }catch(e){res.writeHead(500);res.end(String(e));}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const lease=async(actor,action,token)=>{const r=await fetch(base+'/api/fg/editor/lease',{method:'POST',headers:{'x-test-actor':actor,'content-type':'application/json'},body:JSON.stringify({key,action,token})});return {status:r.status,...await r.json()};};
 const first=await lease(a,'acquire');assert.equal(first.status,200);
 const same=await lease(a,'acquire');assert.equal(first.data.token,same.data.token,'same-account windows share editing rights');
 const write=(actor,token,path='/adcraft-api/'+key.slice(3)+'/api/v2/workflows/test')=>fetch(base+path,{method:'PATCH',headers:{'x-test-actor':actor,'x-fg-editor-key':key,'x-fg-editor-token':token}});
 const slow=write(a,first.data.token,'/adcraft-api/'+key.slice(3)+'/slow');await new Promise(r=>setTimeout(r,25));
 let taken=false;const secondPromise=lease(b,'acquire').then(d=>{taken=true;return d;});await new Promise(r=>setTimeout(r,40));assert.equal(taken,false,'takeover waits for accepted write persistence');
 assert.equal((await slow).status,200);const second=await secondPromise;assert.equal(second.data.previousHolder,'A');
 assert.equal((await lease(a,'heartbeat',first.data.token)).status,409);
 assert.equal((await write(a,first.data.token)).status,409);
 assert.equal((await write(b,second.data.token)).status,200);
 assert.equal((await lease(b,'heartbeat',second.data.token)).status,200);
 console.log(JSON.stringify({passed:8,checks:['same-account windows','takeover serialization','previous-holder notification','stale heartbeat denied','stale write denied','new editor writes']}));
}finally{if(server)await new Promise(r=>server.close(r));await pool.end();await root.query('DROP SCHEMA '+schema+' CASCADE');await root.end();}
