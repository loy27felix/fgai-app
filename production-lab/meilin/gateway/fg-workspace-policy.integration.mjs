// Uses one disposable PostgreSQL schema, without media or model requests.
import pg from 'pg';
import http from 'node:http';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {initializePersonalInspiration,personalInspirationState} from './fg-inspiration-personal.mjs';
import {inspirationRoute} from './fg-inspiration.mjs';
import {canvasOwnersRoute} from './fg-canvas-owners.mjs';
import {initializeEditorLeases,guardEditorWrite} from './fg-editor-leases.mjs';
process.env.FG_ADCRAFT_SECRET='disposable-policy-test';
const root=new pg.Pool({connectionString:process.env.DATABASE_URL});
const schema='fg_policy_qa_'+randomUUID().replaceAll('-','');
await root.query('CREATE SCHEMA '+schema);
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:'-c search_path='+schema,max:8});
const users={admin:randomUUID(),admin2:randomUUID(),alice:randomUUID(),bob:randomUUID()};
let server;
try{
 await pool.query('CREATE TABLE users(id varchar(36) PRIMARY KEY,username text,display_name text,status text)');
 await pool.query('CREATE TABLE fg_accounts(user_id varchar(36) PRIMARY KEY REFERENCES users(id),platform_role text)');
 await pool.query("CREATE TABLE canvas_projects(id text PRIMARY KEY,user_id varchar(36) REFERENCES users(id),project_id text DEFAULT '',deleted_at timestamptz)");
 for(const [name,id]of Object.entries(users)){
  await pool.query("INSERT INTO users VALUES($1,$2,$2,'active')",[id,name]);
  await pool.query('INSERT INTO fg_accounts VALUES($1,$2)',[id,name.startsWith('admin')?'superadmin':'user']);
 }
 await pool.query("INSERT INTO canvas_projects(id,user_id) VALUES('member-doc',$1),('admin-doc',$2)",[users.alice,users.admin2]);
 await pool.query('CREATE TABLE fg_inspiration_sources(id text PRIMARY KEY,entries jsonb NOT NULL DEFAULT \'[]\')');
 await initializePersonalInspiration(pool);await initializeEditorLeases(pool);
 for(const [key,actor]of [['canvas:member-doc',users.alice],['canvas:admin-doc',users.admin2]])await pool.query("INSERT INTO fg_editor_leases(resource_key,actor_id,generation,expires_at) VALUES($1,$2,$3,now()+interval '45 seconds')",[key,actor,randomUUID()]);
 server=http.createServer(async(req,res)=>{
  try{
   const name=req.headers['x-test-actor'],actor=users[name]?{id:users[name],reviewer:name.startsWith('admin')}:null,path=new URL(req.url,'http://qa.invalid');
   if(await inspirationRoute(req,res,{pool,actor,path}))return;
   if(await canvasOwnersRoute(req,res,{pool,actor,path}))return;
   if(!actor){res.writeHead(401);res.end();return;}
   if(!await guardEditorWrite(req,res,{pool,actor,path}))return;
   const id=path.pathname.split('/').pop();
   await pool.query('UPDATE canvas_projects SET deleted_at=now() WHERE id=$1',[id]);res.writeHead(200);res.end('{}');
  }catch(e){res.writeHead(500);res.end(JSON.stringify({code:e.code||'test-error'}));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const call=async(name,path,method='GET',body)=>{
  const response=await fetch(base+path,{method,headers:{'x-test-actor':name,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
 };
 const custom=await call('alice','/api/fg/inspiration/custom','POST',{title:'共享验收灵感',kind:'text',prompt:'Preserve identity',promptZh:'保留角色身份',category:'人物'});
 assert.equal(custom.status,200);const id=custom.body.data.custom[0].id;
 assert.equal((await call('alice','/api/fg/inspiration/favorites','POST',{id,favorite:true})).status,200);
 for(const name of ['bob','admin','admin2']){
  const detail=await call(name,'/api/fg/inspiration/items/'+id);assert.equal(detail.status,200);assert.equal(detail.body.data.ownerId,users.alice);
  const state=await personalInspirationState(pool,users[name]);assert.deepEqual(state.favorites,[]);assert.deepEqual(state.custom,[]);
 }
 const search=await call('bob','/api/fg/inspiration?q='+encodeURIComponent('角色身份'));assert.equal(search.body.data.total,1);assert.equal(search.body.data.items[0].promptZh,undefined,'gallery should not download full prompt bodies');
 const favorites=await call('bob','/api/fg/inspiration?collection=favorites');assert.equal(favorites.body.data.total,0);
 const mine=await call('alice','/api/fg/inspiration?collection=mine');assert.equal(mine.body.data.total,1);
 const copy=await call('bob','/api/fg/inspiration/custom','POST',{id,title:'独立副本',kind:'text',prompt:'Copy'});assert.notEqual(copy.body.data.custom[0].id,id);assert.equal((await personalInspirationState(pool,users.alice)).custom[0].title,'共享验收灵感');
 const failed=await call('alice','/api/fg/inspiration/import','POST',{entries:[{title:'不能部分提交',kind:'text',prompt:'valid'},{title:'invalid',kind:'text',prompt:''}]});assert.equal(failed.status,400);assert.equal((await personalInspirationState(pool,users.alice)).custom.length,1);
 const directory=await call('admin','/api/fg/canvas/owners');assert.equal(directory.status,200);assert.deepEqual(directory.body.data.owners.map(owner=>owner.username).sort(),['alice','bob']);assert.equal((await call('alice','/api/fg/canvas/owners')).status,403);
 assert.equal((await call('admin','/api/canvas-projects/admin-doc','DELETE')).status,409);
 assert.equal((await call('admin','/api/canvas-projects/member-doc','DELETE')).status,200);
 await pool.query("SELECT pg_advisory_xact_lock(hashtext('fg-editor:'||$1))",['canvas:member-doc']);
 assert.equal((await pool.query("SELECT * FROM fg_editor_leases WHERE resource_key='canvas:member-doc'")).rowCount,0);
 assert.equal((await pool.query("SELECT * FROM fg_editor_leases WHERE resource_key='canvas:admin-doc'")).rowCount,1);
 console.log(JSON.stringify({passed:true,checks:['public personal inspirations','account-private favorites','Chinese prompt search','foreign edits create separate copy','invalid import rolls back','member-only administrator directory','live member lease deletion','other administrator protected'],productionRowsTouched:0,paidRequests:0,NASMounts:0}));
}finally{
 if(server)await new Promise(resolve=>server.close(resolve));await pool.end();await root.query('DROP SCHEMA '+schema+' CASCADE');await root.end();
}
