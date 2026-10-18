import {createServer} from 'node:http';
import {createReadStream,existsSync,statSync,readFileSync} from 'node:fs';
import {resolve,join,extname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {integrated,runContext,context,bridge} from './fg-context.mjs';
import {readIdentity,uuid,validateRelativeFile} from './fg-contract.mjs';
import * as db from './fg-store.mjs';
import * as brain from './brain.mjs';
import * as store from './store.mjs';
import * as files from './files.mjs';
import * as models from './models.mjs';
import * as skills from './skills.mjs';
import * as styles from './styles.mjs';
import * as presets from './presets.mjs';
import * as production from './fg-production.mjs';
import {planningPrompts} from './planning.mjs';
import {visibleReply} from './turn-stream.mjs';
import * as studio from './studio.mjs';
import {chainCatalog} from './studio-skills.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),dist=join(root,'web/dist');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.mp4':'video/mp4','.mp3':'audio/mpeg','.wav':'audio/wav','.woff2':'font/woff2'};
const send=(res,status,data,type='application/json; charset=utf-8',extra={})=>{res.writeHead(status,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff',...extra});res.end(typeof data==='string'?data:JSON.stringify(data));};
async function body(req){let bytes=0;const chunks=[];for await(const c of req){bytes+=c.length;if(bytes>36*1024*1024)throw Error('上传或请求内容过大');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString()||'{}');}
const view=d=>{studio.legacyStudio(d);return production.documentView({...d,permissions:{owner:d._ownerId===context().actor.id,canEdit:d._ownerId===context().actor.id||d._role==='editor'},music:brain.musicCues(d)});};
async function catalog(){const c=context(),result=await bridge('catalog');c.models=result.models;c.budget=result.budget;c.personalGPTConfigured=result.personalGPTConfigured;return result;}
async function withDrama(id,fn){
 const connection=await (await db.database()).connect();let locked=false;
 try{
  locked=(await connection.query("SELECT pg_try_advisory_lock(hashtext('meilin-edit:'||$1)) AS locked",[id])).rows[0].locked;
  if(!locked)throw Error('此剧正在处理另一个操作，请稍后重试');
  const d=await store.get(id,true);if(!d)throw Error('剧目不存在或没有权限');brain.migrate(d);const c=context();c.dramaId=id;c.episodeId=d.episodes.find(e=>e.n===Number(c.episode))?.id;
  const out=await fn(d);
  d.skillVersions={...d.skillVersions,...c.skillsUsed};
  const pending=d._pending;delete d._pending;
  await production.prepare(d,pending);
  const trace=d._trace||[],focus=[...new Set(d._focus||[])];delete d._trace;delete d._focus;
  await store.save(d);
  return {reply:out?.reply||'',...out,trace,focus,next:brain.nextSteps(d,{episode:c.episode}),project:view(d)};
 }finally{if(locked)await connection.query("SELECT pg_advisory_unlock(hashtext('meilin-edit:'||$1))",[id]);connection.release();}
}
function file(res,req,base,name,attachment=false){
 const path=resolve(base,name),rel=relative(resolve(base),path);if(rel.startsWith('..')||rel.includes(':')||!existsSync(path)||!statSync(path).isFile())return send(res,404,{error:'文件不存在'});
 const size=statSync(path).size,type=mime[extname(path)]||'application/octet-stream',range=req.headers.range;
 const headers={'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','accept-ranges':'bytes',...(attachment?{'content-disposition':'attachment'}:{})};
 if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m)return send(res,416,'',type,{'content-range':`bytes */${size}`});const start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2])),end=m[1]&&m[2]?Math.min(size-1,Number(m[2])):size-1;
  if(start>end||start>=size)return send(res,416,'',type,{'content-range':`bytes */${size}`});res.writeHead(206,{...headers,'content-range':`bytes ${start}-${end}/${size}`,'content-length':end-start+1});return createReadStream(path,{start,end}).pipe(res);}
 res.writeHead(200,{...headers,'content-length':size});if(req.method==='HEAD')return res.end();createReadStream(path).pipe(res);
}
function aiStudio(){const md=readFileSync(join(root,'skills/fg-overseas-drama-script/SKILL.md'),'utf8').replace(/\r\n/g,'\n');return {steps:(md.split('## 2.')[1]?.split('## 3.')[0]||'').split('\n').filter(l=>/^\d+\.\s/.test(l)).map(l=>l.replace(/^\d+\.\s*/,'')),prompts:[...md.matchAll(/### (Prompt [①②③④][^\n]*)\n+```text\n([\s\S]*?)```/g)].map(m=>({name:m[1].trim(),text:m[2].trim()}))};}
export function createMeilinServer(){return createServer(async(req,res)=>{
 if(req.url==='/health/live')return send(res,200,{ok:true});
 let actor;try{actor=readIdentity(req.headers,req.method,req.url,process.env.MEILIN_INTERNAL_SECRET);}catch{return send(res,403,{error:'请从 FG 登录入口访问美林'});}
 const url=new URL(req.url,'http://meilin'),path=url.pathname,match=/^\/api\/dramas\/([a-f0-9-]{36})(?:\/(\w+))?$/.exec(path),dramaId=match?.[1]||'00000000-0000-4000-a000-000000000000';
 await runContext({actor,dramaId,operationId:req.headers['x-fg-operation-id'],textOrdinal:0},async()=>{try{
  if(path==='/api/config'){const result=await catalog();return send(res,200,{mode:'live',media:'fg-tasks',chains:chainCatalog(),directions:presets.DIRECTIONS,models:models.publicCatalog(),skills:skills.catalog(),styles:styles.allPresets(),dramaStages:[{id:'brief',name:'立项'},{id:'bible',name:'圣经与画风'}],episodeStages:[{id:'script',name:'剧本'},{id:'cast',name:'本集资产'},{id:'segments',name:'分段提示词'},{id:'shoot',name:'拍摄'},{id:'post',name:'后期'}],aiStudio:aiStudio(),planningPrompts,inspirations:false,budget:result.budget,actor});}
  if(path==='/api/dramas'&&req.method==='GET')return send(res,200,production.documentView(await store.list()));
  if(path==='/api/dramas'&&req.method==='POST'){
   const operationId=context().operationId;if(!uuid.test(operationId||''))return send(res,400,{error:'创建请求缺少操作编号'});
   const existing=await store.get(operationId);if(existing)return send(res,200,view(existing));
   await catalog();for(const kind of ['text','image','video'])if(!models.defaultModel(kind))throw Error(`默认${kind}模型未开启，请联系管理员配置`);
   const input=await body(req),d=brain.createDrama(input.direction);d.id=operationId;if(input.chain)studio.initializeStudio(d,input);context().dramaId=d.id;await store.save(d);return send(res,200,view(d));
  }
  if(match){const [,id,sub]=match;
   if(!sub&&req.method==='GET'){await catalog();const d=await store.get(id);if(d)brain.migrate(d);return d?send(res,200,view(d)):send(res,404,{error:'剧目不存在'});}
   if(!sub&&req.method==='DELETE'){await store.remove(id);return send(res,200,{ok:true});}
   if(sub==='costs'&&req.method==='GET')return send(res,200,await bridge('costs'));
   if(sub==='members'){const input=req.method==='GET'?undefined:await body(req);return send(res,200,await db.members(id,input));}
   if(['srt','prompts','next'].includes(sub)&&req.method==='GET'){const d=await store.get(id);if(!d)return send(res,404,{error:'剧目不存在'});brain.migrate(d);const n=Number(url.searchParams.get('episode')||1);if(sub==='next')return send(res,200,{next:brain.nextSteps(d,{episode:n}),memory:d.memory.length});return send(res,200,'\uFEFF'+(sub==='srt'?brain.srt(d,n):brain.promptsText(d,n)),'text/plain; charset=utf-8',{'content-disposition':`attachment; filename*=UTF-8''${encodeURIComponent(`EP${n}.${sub==='srt'?'srt':'txt'}`)}`});}
   if(['turn','action','upload','confirm','cancel','requote','studio'].includes(sub)&&req.method==='POST'){
    if(!uuid.test(context().operationId||''))return send(res,400,{error:'操作缺少稳定编号'});
    const input=await body(req);context().episode=input.ctx?.episode;context().action=input.type||sub;
    const streaming=req.headers.accept?.includes('text/event-stream');let heartbeat;
    if(streaming){res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store','x-accel-buffering':'no'});res.flushHeaders();
     context().emit=(event,data)=>{if(res.destroyed)return;if(event==='text'&&data.format==='reply')data={...data,text:visibleReply(data.text)};res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);};
     context().emit('status',{text:'已收到，正在准备本剧上下文。'});heartbeat=setInterval(()=>{if(!res.destroyed)res.write(': keepalive\n\n');},15000);res.on('close',()=>clearInterval(heartbeat));
    }
    try{await catalog();
    const out=await withDrama(id,async d=>{
     d.requests ||= {};const requestId=context().operationId;if(d.requests[requestId])return {reply:d.requests[requestId].reply||'原操作已完成，未重复提交'};
     let result;
     if(['confirm','cancel','requote'].includes(sub)){const ids=input.ids||[];if(!Array.isArray(ids)||ids.some(id=>!uuid.test(id)))throw Error('任务标识无效');
      if(sub==='confirm')await production.confirm(d,ids,input.digests||{});if(sub==='cancel')production.cancel(d,ids);if(sub==='requote')await production.requote(d,ids);result={reply:sub==='confirm'?'已确认，任务将在后台提交，可离开此页。':sub==='cancel'?'已取消，未提交模型任务。':'已更新报价，请重新核对。'};
     }else if(sub==='studio'){studio.legacyStudio(d);result=input.type==='turn'?studio.queueTurn(d,String(input.text||''),input):studio.studioAction(d,input.type,input.payload||{});}
     else if(sub==='turn')result=await brain.turn(d,String(input.text||'').slice(0,4000),input.ctx||{});
     else if(sub==='action')result=await brain.act(d,input.type,input.payload||{},input.ctx||{});
     else{
      const up=await files.saveDataUrl(input.dataUrl,input.name);const meta={id:up.id,name:up.name,mime:up.mime,size:up.size,url:up.url,purpose:input.purpose||'asset',palette:input.palette||[],at:new Date().toISOString()};d.uploads.push(meta);result={reply:'素材已保存',upload:meta};
      if(['script','script-start'].includes(meta.purpose))result={...await brain.act(d,meta.purpose==='script-start'?'script.start':'script.upload',{...input.spec,text:files.textOf(up),name:up.name,episode:input.episode},input.ctx||{}),upload:meta};
      if(meta.purpose==='studio-script'){studio.legacyStudio(d);meta.script=files.textOf(up);studio.addArtifact(d,{kind:'script',title:up.name,content:meta.script,data:{}},[],'用户上传原稿');result={reply:'原稿已保存，未改写；可以直接告诉导演要检查或修改什么',upload:meta};}
      if(meta.purpose==='asset'&&(input.code||input.kind))result={...await brain.act(d,'assets.upload',{upload:meta.id,code:input.code,kind:input.kind,name:input.assetName,episode:input.episode},input.ctx||{}),upload:meta};
     }
     d.requests[requestId]={reply:result.reply,at:new Date().toISOString()};return result;
    });if(streaming){context().emit('final',out);res.end();return;}return send(res,200,out);
    }catch(e){if(!streaming)throw e;context().emit('error',{error:e.message});res.end();return;}finally{clearInterval(heartbeat);}
   }
  }
  if(path.startsWith('/files/')&&['GET','HEAD'].includes(req.method)){const name=validateRelativeFile(path.slice(7));if(!await db.fileAccess(name))return send(res,404,{error:'素材不存在'});return file(res,req,files.FILES_DIR,name,!/\.(png|jpg|jpeg|webp|gif|mp4|mp3|wav|m4a)$/i.test(name));}
  if(path.startsWith('/api/'))return send(res,404,{error:'接口不存在'});
  if(['GET','HEAD'].includes(req.method)){const name=path==='/'?'index.html':decodeURIComponent(path.slice(1));return file(res,req,dist,name);}
  send(res,405,{error:'不支持的请求'});
 }catch(e){send(res,409,{error:e.message});}});
});}
let refreshing=false;
export async function recover(){if(refreshing)return;refreshing=true;try{
 for(const item of await db.active())await runContext({actor:{id:item.owner_id},dramaId:item.id,action:'recover'},async()=>{try{await catalog();await withDrama(item.id,async d=>{await production.refresh(d);return {};});}catch{/* The durable operation remains available for the next recovery pass. */}});
}finally{refreshing=false;}}
const studioRunning=new Set();
export async function recoverStudio(){
 if(studioRunning.size>=2)return;
 for(const item of await db.studioActive()){
  if(studioRunning.has(item.id)||studioRunning.size>=2)continue;
  studioRunning.add(item.id);
  void runContext({actor:{id:item.owner_id},dramaId:item.id,action:'studio.recover'},async()=>{
   try{
    const snapshot=await store.get(item.id),pending=snapshot?.studio?.runs.find(r=>['queued','running'].includes(r.status));if(!pending)return;
    context().actor={id:pending.actorId};context().operationId=pending.id;
    await catalog();
    await withDrama(item.id,async d=>{
     const run=d.studio.runs.find(r=>r.id===pending.id);if(!['queued','running'].includes(run.status))return {};
     run.status='running';run.startedAt||=new Date().toISOString();await store.save(d);
     try{await studio.executeRun(d,run,undefined,()=>store.save(d));}catch(error){studio.markStudioRunFailed(d,run,error);}
     return {};
    });
   }catch(error){
    if(!/处理另一个操作/.test(error.message))try{
     const d=await store.get(item.id,true),run=d?.studio?.runs.find(r=>['queued','running'].includes(r.status));
     if(run){studio.markStudioRunFailed(d,run,error);await store.save(d);}
    }catch{/* A storage outage leaves the original durable task available for recovery. */}
   }
   finally{studioRunning.delete(item.id);}
  });
 }
}
if(process.env.MEILIN_NO_LISTEN!=='1'){
 if(!integrated)throw Error('生产服务必须使用 MEILIN_MODE=fg');await db.initialize();
 const server=createMeilinServer();server.listen(Number(process.env.FG_DIRECTOR_PORT||5310),process.env.MEILIN_BIND||'0.0.0.0');setInterval(()=>{recover().catch(()=>{});recoverStudio().catch(()=>{});},5000).unref();
}
