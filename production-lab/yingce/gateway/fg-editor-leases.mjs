import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';

const keyPattern=/^(canvas:[a-zA-Z0-9_-]{1,64}|ad:[0-9a-f-]{36})$/;
const tokenFor=row=>createHmac('sha256',process.env.FG_ADCRAFT_SECRET).update([row.resource_key,row.actor_id,row.generation].join(':')).digest('hex');
const watchers=new Map();
async function notifyWatchers(pool,key){for(const check of watchers.get(key)||[])await check();}
export function leaseTokenMatches(row,actor,key,token){
  if(!row||row.actor_id!==actor.id||row.resource_key!==key||typeof token!=='string')return false;
  const expected=tokenFor(row);return token.length===expected.length&&timingSafeEqual(Buffer.from(token),Buffer.from(expected));
}
const send=(res,status,data,msg='')=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({code:status===200?0:status,data,msg,reason:status===409?'FG_EDITOR_REPLACED':undefined}));};
export async function initializeEditorLeases(pool){await pool.query(`CREATE TABLE IF NOT EXISTS fg_editor_leases(resource_key varchar(100) PRIMARY KEY,actor_id varchar(36) NOT NULL REFERENCES users(id),generation uuid NOT NULL,expires_at timestamptz NOT NULL,updated_at timestamptz NOT NULL DEFAULT now())`);}
async function readJSON(req){let size=0;const parts=[];for await(const part of req){size+=part.length;if(size>24*1024*1024)throw Error('编辑请求过大');parts.push(part);}const bytes=Buffer.concat(parts);req.fgReplayBody=bytes;return JSON.parse(bytes.toString());}
export async function editorLeaseRoute(req,res,{pool,actor,path,web,cookie,publicOrigin,advertisingAccess}){
 const watching=path.pathname==='/api/fg/editor/watch';
 if(!watching&&path.pathname!=='/api/fg/editor/lease')return false;
 if(req.method!==(watching?'GET':'POST')){send(res,405,null,'不支持的编辑权操作');return true;}
 try{
  const input=watching?{key:path.searchParams.get('key'),generation:path.searchParams.get('generation')}:await readJSON(req),key=String(input.key||'');if(!keyPattern.test(key))throw Error('画布编号无效');
  if(key.startsWith('ad:')){if(!await advertisingAccess(pool,actor,key.slice(3))){send(res,403,null,'无权编辑此广告项目');return true;}}
  else{const r=await fetch(new URL('/api/canvas-projects/'+encodeURIComponent(key.slice(7)),web),{headers:{cookie,origin:publicOrigin},signal:AbortSignal.timeout(15000)});const d=await r.json();if(!r.ok||d.code!==0){send(res,403,null,'无权编辑此画布');return true;}}
  if(watching){
   if(!/^[0-9a-f-]{36}$/i.test(input.generation||''))throw Error('编辑连接编号无效');
   res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store','connection':'keep-alive','x-accel-buffering':'no'});res.write(': connected\n\n');
   let closed=false,checking=false;
   const cleanup=()=>{if(closed)return;closed=true;clearInterval(timer);watchers.get(key)?.delete(check);if(!watchers.get(key)?.size)watchers.delete(key);};
   const check=async()=>{if(closed||checking)return;checking=true;try{const row=(await pool.query('SELECT * FROM fg_editor_leases WHERE resource_key=$1',[key])).rows[0];if(row?.actor_id!==actor.id||row?.generation!==input.generation){const holder=await holderName(pool,row?.actor_id);if(!closed){res.write('event: replaced\ndata: '+JSON.stringify({holder,msg:holder+' 进入了这个画布，你已退出编辑。'})+'\n\n');cleanup();res.end();}}else if(!closed)res.write(': active\n\n');}catch{if(!closed){cleanup();res.end();}}finally{checking=false;}};
   const timer=setInterval(()=>void check(),2000);if(!watchers.has(key))watchers.set(key,new Set());watchers.get(key).add(check);res.once('close',cleanup);await check();return true;
  }
  if(input.action==='heartbeat'){
   const row=(await pool.query('SELECT * FROM fg_editor_leases WHERE resource_key=$1',[key])).rows[0];
   if(!leaseTokenMatches(row,actor,key,input.token)){const holder=await holderName(pool,row?.actor_id);send(res,409,{holder},holder+' 进入了这个画布，你已退出编辑。');return true;}
   const updated=await pool.query("UPDATE fg_editor_leases SET expires_at=now()+interval '45 seconds',updated_at=now() WHERE resource_key=$1 AND actor_id=$2 AND generation=$3 RETURNING resource_key",[key,actor.id,row.generation]);
   if(!updated.rowCount){send(res,409,null,'画布编辑权已变更');return true;}send(res,200,{active:true});return true;
  }
  if(input.action!=='acquire')throw Error('编辑权操作无效');
  const client=await pool.connect();let row,previous;
  try{await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('fg-editor:'||$1))",[key]);
   previous=(await client.query('SELECT * FROM fg_editor_leases WHERE resource_key=$1 FOR UPDATE',[key])).rows[0];
   const generation=previous?.actor_id===actor.id&&new Date(previous.expires_at)>new Date()?previous.generation:randomUUID();
   row=(await client.query("INSERT INTO fg_editor_leases(resource_key,actor_id,generation,expires_at) VALUES($1,$2,$3,now()+interval '45 seconds') ON CONFLICT(resource_key) DO UPDATE SET actor_id=excluded.actor_id,generation=excluded.generation,expires_at=excluded.expires_at,updated_at=now() RETURNING *",[key,actor.id,generation])).rows[0];
   await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  send(res,200,{token:tokenFor(row),generation:row.generation,previousHolder:previous&&previous.actor_id!==actor.id&&new Date(previous.expires_at)>new Date()?await holderName(pool,previous.actor_id):null});
  await notifyWatchers(pool,key);
 }catch(e){send(res,400,null,e.message);}return true;
}
async function holderName(pool,id){if(!id)return null;return (await pool.query('SELECT display_name FROM users WHERE id=$1',[id])).rows[0]?.display_name||'另一位同事';}

// Hold the row lock until the native write finishes. A new editor cannot take
// over between validation and persistence of the previous editor's request.
export async function guardEditorWrite(req,res,{pool,actor,path}){
 if(['GET','HEAD','OPTIONS'].includes(req.method))return true;
 let expected;
 const canvas=/^\/api\/canvas-projects\/([^/]+)(?:\/history\/[^/]+\/restore)?$/.exec(path.pathname);
 if(canvas)expected='canvas:'+canvas[1];
 const ad=/^\/adcraft-api\/([0-9a-f-]{36})\//.exec(path.pathname);if(ad)expected='ad:'+ad[1];
 const asset=/^\/api\/fg\/advertising\/([0-9a-f-]{36})\/company-asset$/.exec(path.pathname);if(asset)expected='ad:'+asset[1];
 if(!expected&&/^\/api\/(?:tasks|agent)(?:\/|$)/.test(path.pathname)&&String(req.headers['content-type']).includes('application/json')){
  try{const body=await readJSON(req);const id=body.canvasId||body.input?.metadata?.canvasId||body.context?.canvasId;if(id)expected='canvas:'+id;}catch{send(res,400,null,'请求格式无效');return false;}
 }
 const supplied=String(req.headers['x-fg-editor-key']||'');if(!expected&&keyPattern.test(supplied)&&!path.pathname.startsWith('/api/fg/'))expected=supplied;
 if(!expected)return true;
 if(!keyPattern.test(expected)){send(res,400,null,'画布编号无效');return false;}
 const client=await pool.connect();
 try{
  await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('fg-editor:'||$1))",[expected]);
  const row=(await client.query('SELECT * FROM fg_editor_leases WHERE resource_key=$1 FOR UPDATE',[expected])).rows[0];
  // A list-page delete carries no editor token. The same account's open tab
  // must not block its own deletion; another person's live lease still does.
  const ownCanvasDelete=req.method==='DELETE'&&canvas&&path.pathname==='/api/canvas-projects/'+canvas[1]&&row?.actor_id===actor.id;
  if(row&&new Date(row.expires_at)>new Date()){
   if(!ownCanvasDelete&&(supplied!==expected||!leaseTokenMatches(row,actor,expected,req.headers['x-fg-editor-token']))){await client.query('ROLLBACK');client.release();const holder=await holderName(pool,row.actor_id);send(res,409,{holder},holder+' 进入了这个画布，你已退出编辑。');return false;}
  }else if(supplied){await client.query('ROLLBACK');client.release();send(res,409,null,'编辑连接已过期，请重新打开画布');return false;}
  let done=false;const release=()=>{if(done)return;done=true;void client.query('ROLLBACK').finally(()=>client.release());};res.once('finish',release);res.once('close',release);return true;
 }catch(e){await client.query('ROLLBACK');client.release();throw e;}
}
