import http from 'node:http';
import {createGatewayShutdown} from './fg-gateway-shutdown.mjs';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { pipeline } from 'node:stream';
import pg from 'pg';
import fs from 'node:fs/promises';
import {applyHostDiskMetrics} from './host-metrics.mjs';
import {initializeFG,fgAPI} from './fg-integration.mjs';
import {startFeeSync} from './fg-fee-sync.mjs';
import {budgetInternalRoute} from './fg-budgets.mjs';
import {initializeSpeech,speechInternalRoute} from './fg-speech.mjs';
import {musicStatus} from './fg-music-provider.mjs';
import {initializeSpeechJobs,speechJobRoute} from './fg-speech-jobs.mjs';
import {initializeMusicQueue,musicQueueRoute} from './fg-music-queue.mjs';
import {publishExistingStoryMedia} from './fg-share-existing.mjs';
import {initializeAdcraft, adcraftInternalRoute, adcraftUserRoute,advertisingAccess} from './fg-adcraft.mjs';
import {startAdvertisingRetention} from './fg-adcraft-retention.mjs';
import {initializeCreator,creatorCapability,creatorInternalRoute,creatorUserRoute} from './fg-creator.mjs';
import {initializeArcReel,createArcReelServer} from './fg-arcreel.mjs';
import {initializeEditorLeases,editorLeaseRoute,guardEditorWrite} from './fg-editor-leases.mjs';
import { platformToken, trustedOrigin, publicResourceRead, publicCanvasShareRead, proxyHeaders, responseHeaders } from './policy.mjs';
import {publicEntryOrigins, workspaceRequestPath, workspaceEntryURL} from './fg-public-entry.mjs';
import {initializeInspiration,startInspirationSync,inspirationRoute} from './fg-inspiration.mjs';
import {registerSpeechStream} from './fg-speech-stream.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
const editorPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 16 });
const platform = new URL(process.env.FG_PLATFORM_URL || 'http://fgai-app-app-1:3000');
const web = new URL(process.env.CANVAS_WEB_URL || 'http://web:3000');
const publicOrigin = new URL(process.env.FG_SIX_PUBLIC_URL).origin;
const platformOrigin = new URL(process.env.FG_PLATFORM_PUBLIC_URL).origin;
const externalOrigins = publicEntryOrigins(process.env.FG_EXTERNAL_PUBLIC_URL);
const sessions = new Map();
const creating = new Map();
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
await initializeFG(pool);
await initializeSpeech(pool);
await initializeSpeechJobs(pool);
await initializeMusicQueue(pool);
await initializeAdcraft(pool);
await initializeCreator(pool);
await initializeArcReel(pool);
await initializeEditorLeases(pool);
await initializeInspiration(pool);
await publishExistingStoryMedia(pool);
startFeeSync(pool);
startAdvertisingRetention(pool);
startInspirationSync(pool);

function respond(res, status, message, reason) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ code: status, data: null, msg: message, reason }));
}

async function platformActor(req) {
  const token = platformToken(req.headers.cookie);
  if (!token) return null;
  if(process.env.FG_SIX_ENABLED==='false')return null;
  // Authenticate every request against the existing platform. Access is now
  // company-wide; native administrator rights remain superadmin-only.
  const response = await fetch(new URL('/api/auth/session', platform), {
    headers: { cookie: `fg_session=${token}` }, signal: AbortSignal.timeout(15000), redirect: 'error',
  });
  if (response.status === 403 || response.status === 401) return null;
  if (!response.ok) throw new Error('PLATFORM_UNAVAILABLE');
  const data = await response.json();
  const user=data.data?.session?.user;
  if(!user||!uuidPattern.test(user.id))return null;
  const known=(await pool.query('SELECT display_name FROM users WHERE id=$1',[user.id])).rows[0];
  return {id:user.id,email:user.email,name:known?.display_name||String(user.email||'FG 成员').split('@')[0],reviewer:user.platform_role==='superadmin',platformRole:user.platform_role||'user'};
}

async function canvasSession(actor) {
  const existing = sessions.get(actor.id);
  if (existing && existing.expires > Date.now() && existing.reviewer===actor.reviewer) return existing.cookie;
  if (creating.has(actor.id)) return creating.get(actor.id);
  const promise = (async () => {
    const token = randomBytes(32).toString('hex');
    const id = randomUUID();
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000);
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      await connection.query(`INSERT INTO users (id,username,display_name,role,status,password_hash,created_at,updated_at)
        VALUES ($1,$2,$3,$4,'active','',now(),now())
        ON CONFLICT (id) DO UPDATE SET display_name=EXCLUDED.display_name,role=EXCLUDED.role,status='active',updated_at=now()`,
        [actor.id, 'fg_' + actor.id.replaceAll('-', '').slice(0,29), String(actor.name || 'FG 成员').slice(0,80),actor.reviewer?'admin':'user']);
      await connection.query('INSERT INTO fg_accounts(user_id,email,platform_role) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,platform_role=excluded.platform_role',[actor.id,actor.email,actor.platformRole]);
      await connection.query(`INSERT INTO credit_accounts (user_id,available_microcredits,reserved_microcredits,version,created_at,updated_at)
        VALUES ($1,0,0,1,now(),now()) ON CONFLICT (user_id) DO NOTHING`, [actor.id]);
      await connection.query(`DELETE FROM auth_sessions WHERE user_id=$1 AND expires_at < now()`, [actor.id]);
      await connection.query(`INSERT INTO auth_sessions (id,user_id,token_hash,expires_at,created_at,updated_at)
        VALUES ($1,$2,$3,$4,now(),now())`, [id,actor.id,tokenHash,expires]);
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally { connection.release(); }
    const cookie = `open_ai_canvas_session=${id}.${token}`;
    sessions.set(actor.id, { cookie, reviewer:actor.reviewer, expires: expires.getTime() - 60000 });
    return cookie;
  })();
  creating.set(actor.id, promise);
  try { return await promise; } finally { creating.delete(actor.id); }
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/health/live') { res.writeHead(200); res.end('ok'); return; }
  try {
    let parsed;
    try { parsed = workspaceRequestPath(req.url, publicOrigin); }
    catch { respond(res,400,'请求路径无效','INVALID_PATH'); return; }
    const path = parsed.url;
    if(await budgetInternalRoute(req,res,{pool,path}))return;
    if(await speechInternalRoute(req,res,{pool,path}))return;
    if(await adcraftInternalRoute(req,res,{pool,web,publicOrigin,canvasSession,path}))return;
    if(await creatorInternalRoute(req,res,{pool,web,publicOrigin,canvasSession,path}))return;
    if (publicResourceRead(req.method, path) || publicCanvasShareRead(req.method, path)) {
      // Public media and share reads are authorized by the native backend's
      // expiring capability. Static bundles need no browser or FG credentials.
      const headers = Object.fromEntries(['range','if-none-match','if-modified-since'].filter(name => req.headers[name]).map(name => [name,req.headers[name]]));
      const upstream = http.request(new URL(path.pathname + path.search, web), {method:req.method,headers}, remote => {
        res.writeHead(remote.statusCode || 502,responseHeaders(remote.headers));
        pipeline(remote,res,()=>{});
      });
      upstream.on('error',()=>{if(!res.headersSent)respond(res,502,'素材服务暂时不可用','RESOURCE_UNAVAILABLE');else res.destroy();});
      res.on('close',()=>{if(!res.writableEnded)upstream.destroy();});
      upstream.end();return;
    }
    const actor = await platformActor(req);
    if (!actor && req.method === 'GET' && path.pathname === '/api/auth/session') {
      res.writeHead(200, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
      res.end(JSON.stringify({code:0,data:{user:null},msg:''}));return;
    }
    if (!actor) { respond(res,403,'请先登录 FG Studio','FG_ACCESS_DENIED'); return; }
    if(path.pathname.startsWith('/api/admin/')&&!actor.reviewer){respond(res,403,'仅超级管理员可管理平台','FG_ADMIN_REQUIRED');return;}
    if (path.pathname === '/fg/entry' && req.method === 'GET') {
      const entryURL = workspaceEntryURL(req.headers.host, externalOrigins, publicOrigin);
      const workspaceOrigin = entryURL.startsWith('/') ? [publicOrigin, platformOrigin, ...externalOrigins].find(origin => new URL(origin).host === req.headers.host) : publicOrigin;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FG Studio · 制作工作区</title><style>html,body{margin:0;height:100%;overflow:hidden;background:#101114}iframe{display:block;width:100%;height:100dvh;border:0}</style></head><body><iframe name="fg-canvas-workspace" title="FG 制作工作区" src="${entryURL}" allow="clipboard-read; clipboard-write; fullscreen; microphone ${workspaceOrigin}" allowfullscreen></iframe></body></html>`);
      return;
    }
    if (parsed.managedAuth) { respond(res,403,'账号登录由 FG Studio 管理，请返回平台处理','FG_MANAGED_AUTH'); return; }
    if (parsed.commercial) { respond(res,403,'FG 内部制作平台不使用积分、充值或兑换码','FG_INTERNAL_WORKSPACE'); return; }
    if (path.pathname === '/api/admin/settings/appearance' && req.method === 'DELETE') {
      respond(res,409,'请使用 FG 外观页面恢复默认设置','FG_BRAND_RESET'); return;
    }
    if (!trustedOrigin(req.method, req.headers.origin, [publicOrigin, platformOrigin, ...externalOrigins])) {
      respond(res,403,'请求来源无效','INVALID_ORIGIN'); return;
    }
    const cookie = await canvasSession(actor);
    if(await musicQueueRoute(req,res,{pool,actor,path,ownerAPI:async(ownerId,p,m,payload,extra)=>{
      const owner=(await pool.query('SELECT u.id,u.display_name name,a.email,a.platform_role FROM users u JOIN fg_accounts a ON a.user_id=u.id WHERE u.id=$1 AND u.status=\'active\'',[ownerId])).rows[0];
      if(!owner)throw Error('作品所属成员账号不可用');
      const ownerCookie=await canvasSession({...owner,reviewer:owner.platform_role==='superadmin',platformRole:owner.platform_role});
      const output=await fetch(new URL('/api'+p,web),{method:m,headers:{cookie:ownerCookie,origin:publicOrigin,...extra},body:payload,signal:AbortSignal.timeout(120000)});
      const envelope=await output.json();if(!output.ok||envelope.code!==0)throw Error(envelope.msg||'作品归档未完成');return envelope.data;
    }}))return;
    if(await inspirationRoute(req,res,{pool,actor,path}))return;
    if(path.pathname==='/api/fg/music/status'&&req.method==='GET'){
      const status=await musicStatus();const registered=(await pool.query(`SELECT 1 FROM channel_models cm JOIN model_channels c ON c.id=cm.channel_id WHERE c.name='Suno 音乐 · FG' AND cm.model_key='suno-company-music' AND c.enabled AND cm.enabled AND c.deleted_at IS NULL AND cm.deleted_at IS NULL`)).rowCount>0;
      res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({code:0,data:{...status,enabled:status.enabled&&registered},msg:''}));return;
    }
    if(path.pathname==='/api/fg/speech/generate'){
      if(req.method!=='POST'||!/^[0-9a-f-]{36}$/.test(String(req.headers['x-fg-operation-id']||''))){respond(res,400,'缺少音频操作标识','SPEECH_INVALID_INPUT');return;}
      req.headers.authorization='Bearer '+creatorCapability(actor.id);
      await creatorInternalRoute(req,res,{pool,web,publicOrigin,canvasSession,path:new URL(`/internal/creator/${actor.id}/v1/audio/speech`,publicOrigin)});return;
    }
    if(await speechJobRoute(req,res,{pool,actor,path,api:async(p,m='GET',b)=>{
      const r=await fetch(new URL('/api'+p,web),{method:m,headers:{cookie,origin:publicOrigin,'content-type':'application/json'},body:b===undefined?undefined:JSON.stringify(b),signal:AbortSignal.timeout(30000)});const d=await r.json();if(!r.ok||d.code!==0)throw Error(d.msg||'音频资源不可用');return d.data;
    }}))return;
    if(await creatorUserRoute(req,res,{pool,actor,path}))return;
    const headers = proxyHeaders(req.headers, cookie, new URL(process.env.FG_SIX_PUBLIC_URL).host);
    if (req.headers.origin) headers.origin = publicOrigin;
    if(await editorLeaseRoute(req,res,{pool,actor,path,web,cookie,publicOrigin,advertisingAccess}))return;
    if(!await guardEditorWrite(req,res,{pool:editorPool,actor,path}))return;
    if(await adcraftUserRoute(req,res,{pool,actor,cookie,web,publicOrigin,path}))return;
    if(await fgAPI(req,res,{actor,cookie,path,pool,web,platform,platformCookie:`fg_session=${platformToken(req.headers.cookie)}`,publicOrigin}))return;
    if (path.pathname.startsWith('/api/admin/system-update')) {
      if (req.method !== 'GET') { respond(res,409,'FG 版本由本公司仓库发布，不执行上游镜像升级','FG_MANAGED_RELEASE'); return; }
      res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
      res.end(JSON.stringify({code:0,data:{supported:false,connected:true,repository:'loy27felix/fgai-app',deployment:'fg-six-yingce',currentVersion:'v1.3.1',updateAvailable:false,checks:[],operation:{phase:'idle',logs:[]}},msg:''})); return;
    }
    if (path.pathname === '/api/admin/system-performance' && req.method === 'GET') {
      const response = await fetch(new URL(path.pathname,web),{headers,signal:AbortSignal.timeout(10000)});
      const payload = await response.json();
      if (payload.code === 0 && payload.data) {
        let hostDisk;
        try { hostDisk = JSON.parse(await fs.readFile('/host-metrics/nas.json','utf8')); } catch {}
        applyHostDiskMetrics(payload.data,hostDisk);
      }
      res.writeHead(response.status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(payload));return;
    }
    if (path.pathname === '/api/admin/settings/features' && req.method === 'PATCH') {
      const chunks = []; let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 32768) { respond(res,413,'设置请求过大','INVALID_SETTINGS'); return; }
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.stringify({...JSON.parse(Buffer.concat(chunks).toString('utf8')),creditsEnabled:false}); }
      catch { respond(res,400,'功能设置格式无效','INVALID_SETTINGS'); return; }
      const response = await fetch(new URL(path.pathname, web),{method:'PATCH',headers:{...headers,'content-length':String(Buffer.byteLength(body))},body,signal:AbortSignal.timeout(15000)});
      res.writeHead(response.status,Object.fromEntries([...response.headers].filter(([name]) => !['set-cookie','content-length','content-encoding','transfer-encoding'].includes(name))));
      res.end(await response.text()); return;
    }
    const upstream = http.request(new URL(path.pathname + path.search, web), { method: req.method, headers }, (remote) => {
      res.writeHead(remote.statusCode || 502, responseHeaders(remote.headers));
      pipeline(remote, res, () => {});
    });
    upstream.on('error', () => { if (!res.headersSent) respond(res,502,'画布服务暂时不可用，请稍后重试','CANVAS_UNAVAILABLE'); else res.destroy(); });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => { if (!res.writableEnded) upstream.destroy(); });
    if(req.fgReplayBody)upstream.end(req.fgReplayBody);else pipeline(req, upstream, () => {});
  } catch {
    // Never log platform cookies, database URLs or provider credentials.
    console.error('FG sixth-module gateway dependency unavailable');
    if (!res.headersSent) respond(res,503,'登录或画布数据服务暂时不可用，请稍后重试','FG_DEPENDENCY_UNAVAILABLE');
  }
});
server.requestTimeout = 0;
server.headersTimeout = 60000;
const speechStreams=registerSpeechStream(server,{pool,origins:[publicOrigin,platformOrigin,...externalOrigins],parsePath:url=>workspaceRequestPath(url,publicOrigin),authenticate:async req=>{const actor=await platformActor(req);if(actor)await canvasSession(actor);return actor;}});
server.listen(3010, '0.0.0.0');
const arcOrigin=new URL(publicOrigin);arcOrigin.port='3017';
const arcServer=createArcReelServer({pool,platformActor,canvasSession,platformOrigin,publicOrigin:arcOrigin.origin,externalOrigins});
arcServer.requestTimeout=0;
arcServer.headersTimeout=60000;
arcServer.listen(3020,'0.0.0.0');
const shutdownGateway=createGatewayShutdown([server,arcServer],{shutdownStreams:()=>speechStreams.shutdown(),closeDependencies:async()=>{await pool.end();await editorPool.end();}});
process.on('SIGTERM',()=>{shutdownGateway().then(()=>process.exit(0)).catch(()=>{console.error('FG gateway shutdown failed');process.exit(1);});});
