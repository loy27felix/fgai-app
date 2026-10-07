import http from 'node:http';
import fs from 'node:fs/promises';
import {pipeline} from 'node:stream';
import {creatorCapability} from './fg-creator.mjs';
import {responseHeaders,trustedOrigin} from './policy.mjs';
import {workspaceRequestPath} from './fg-public-entry.mjs';

export async function initializeArcReel(pool){
 await pool.query(`CREATE TABLE IF NOT EXISTS fg_arcreel_runtimes(actor_id varchar(36) PRIMARY KEY REFERENCES users(id),requested_at timestamptz NOT NULL DEFAULT now());`);
}
export function managedArcWrite(method,path){
 if(['GET','HEAD','OPTIONS'].includes(method))return false;
 if(/^\/api\/v1\/agent\/credentials\/\d+\/activate$/.test(path)&&method==='POST')return false;
 return /^\/api\/v1\/(?:auth|api-keys|providers|custom-providers|custom-endpoints|agent\/credentials|agent\/preset-providers|system\/config|official-service|market)/.test(path);
}
function failure(res,status,message){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify({detail:message}));}
export function publicArcResponseHeaders(headers,target){
 const output=responseHeaders(headers);
 if(typeof output.location==='string'){
  try{
   const redirect=new URL(output.location,target);
   // FastAPI slash redirects must remain on the authenticated public gateway.
   if(redirect.origin===target.origin)output.location=redirect.pathname+redirect.search+redirect.hash;
  }catch{}
 }
 return {...output,'cache-control':'no-store'};
}
export function waitingPage(req,res,message='首次打开需要约一分钟，准备好后自动进入。', failed=false){
 if(req.method!=='GET'||new URL(req.url,'http://localhost').pathname.startsWith('/api/'))return false;
 res.writeHead(503,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','retry-after':'5'});
 res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="refresh" content="5"><title>超级小说转视频</title><body style="background:#171a20;color:#e7e9ed;font:16px system-ui;display:grid;place-content:center;min-height:95vh;margin:0"><main style="max-width:480px;padding:32px;border:1px solid #ffffff20;border-radius:24px;background:#ffffff08"><h2>'+(failed?'导演工作区准备遇到问题':'正在准备你的导演工作台')+'</h2><p style="line-height:1.8;color:#adb6c8">'+message+'</p><p style="font-size:13px;color:#adb6c8">页面每 5 秒检查一次。已保存的工程会保留。</p><a href="/" style="color:#a8bcff">返回 FG 超级工作台</a></main></body></html>');return true;
}
export function createArcReelServer({pool,platformActor,canvasSession,platformOrigin,publicOrigin,externalOrigins=[]}){
 return http.createServer(async(req,res)=>{
  if(req.url==='/health/live'){res.writeHead(200);res.end('ok');return;}
  try{
   const path=workspaceRequestPath(req.url,publicOrigin,'/fg-director').url;
   const actor=await platformActor(req);
   if(!actor){failure(res,403,'请从 FG 工作台登录后打开导演工作台');return;}
   if(!trustedOrigin(req.method,req.headers.origin,[publicOrigin,platformOrigin,...externalOrigins])){failure(res,403,'请求来源无效');return;}
   if(managedArcWrite(req.method,path.pathname)){failure(res,403,'公司渠道、密钥和存储由 FG 统一管理；可在导演助手中切换已配置模型');return;}
   await canvasSession(actor);
   await pool.query('INSERT INTO fg_arcreel_runtimes(actor_id) VALUES($1) ON CONFLICT(actor_id) DO UPDATE SET requested_at=now()',[actor.id]);
   let address;
   try{address=JSON.parse(await fs.readFile('/host-metrics/arcreel-runtimes.json','utf8'))[actor.id];}catch{}
   if(!/^10\.(?:20[89]|21[0-9]|22[0-3])\.\d{1,3}\.\d{1,3}$/.test(address||'')){
    let preparation;
    try{preparation=JSON.parse(await fs.readFile('/host-metrics/runtime-provision.json','utf8'));}catch{}
    const failed=preparation&&Date.now()-Date.parse(preparation.collectedAt)<240000&&['failed','timeout'].includes(preparation.arcreel);
    if(!waitingPage(req,res,failed?'后台准备尚未完成，系统会继续重试。超过两分钟仍停在这里，请联系管理员检查工作区准备状态。':undefined,failed))failure(res,503,failed?'导演工作区准备失败，系统会继续重试':'导演工作台正在启动，请稍后重试');
    return;
   }
   const target=new URL(path.pathname+path.search,'http://'+address+':1241');
   const headers={'x-fg-runtime':creatorCapability(actor.id)};
   for(const name of ['content-type','content-length','accept','range','last-event-id','accept-language'])if(req.headers[name])headers[name]=req.headers[name];
   const upstream=http.request(target,{method:req.method,headers},remote=>{
    clearTimeout(headerDeadline);
    if((remote.statusCode||502)>=500&&waitingPage(req,res)){remote.resume();return;}

    res.writeHead(remote.statusCode||502,publicArcResponseHeaders(remote.headers,target));pipeline(remote,res,()=>{});
   });
   // Limit a dead runtime's connection/header wait, while preserving long SSE streams.
   const headerDeadline=setTimeout(()=>upstream.destroy(new Error('Runtime response timeout')),20000);
   upstream.on('close',()=>clearTimeout(headerDeadline));
   upstream.on('error',()=>{if(!res.headersSent){if(!waitingPage(req,res,'服务正在恢复，稍后自动重试。'))failure(res,503,'导演工作台正在恢复，请稍后刷新');}else res.destroy();});
   req.on('aborted',()=>upstream.destroy());res.on('close',()=>{if(!res.writableEnded)upstream.destroy();});pipeline(req,upstream,()=>{});
  }catch{if(!res.headersSent)failure(res,503,'FG 会话或导演服务暂时不可用，请稍后刷新');else res.destroy();}
 });
}
