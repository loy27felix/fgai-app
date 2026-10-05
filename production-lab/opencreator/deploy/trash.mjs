import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

const marker='FG private creator workspace\n';
function inside(root,target){return target.startsWith(root+path.sep);}
function safeDirectory(root,cwd){
 if(fs.readFileSync(path.join(root,'.fg-creator-ready'),'utf8')!==marker)throw Error('NAS 工作区标记无效');
 const folder=path.resolve(cwd);
 if(path.dirname(folder)!==path.resolve(root)||!/^project-[A-Za-z0-9_-]{12}$/.test(path.basename(folder)))throw Error('只允许清理本人创建的托管工程');
 if(fs.existsSync(folder)){
  if(fs.lstatSync(folder).isSymbolicLink()||fs.realpathSync(folder)!==folder||!inside(fs.realpathSync(root),fs.realpathSync(folder)))throw Error('工程目录不是安全的 NAS 子目录');
 }
 return folder;
}
export function purgeProjects(db,root,ids){
 if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>typeof id!=='string'||!/^project_[A-Za-z0-9_-]{10}$/.test(id)))throw Error('请选择有效工程');
 const unique=[...new Set(ids)],results=[];
 // Hold the database write lock while checking state and removing files.
 // Other daemon requests cannot claim a generation during the purge.
 db.transaction(()=>{
  if(db.prepare("SELECT 1 FROM runs WHERE public_status IN ('queued','running','canceling') OR internal_status IN ('created','queued','spawning','running','canceling') LIMIT 1").get())throw Error('请等待制作任务结束后清理');
  if(db.prepare("SELECT 1 FROM creator_stage_runs WHERE status IN ('pending','queued','running','canceling') LIMIT 1").get())throw Error('请等待制作步骤结束后清理');
  const candidates=unique.map(id=>{
   const row=db.prepare('SELECT id,name,cwd,status FROM projects WHERE id=?').get(id);
   if(!row||!['archived','purging'].includes(row.status))throw Error('只能彻底删除已归档工程');
   const folder=safeDirectory(root,row.cwd);
   const all=db.prepare('SELECT id,cwd FROM projects WHERE id<>? AND status<>?').all(id,'purged');
   if(all.some(other=>path.resolve(other.cwd)===folder||inside(folder,path.resolve(other.cwd))||inside(path.resolve(other.cwd),folder)))throw Error('工程目录仍被其他工程引用');
   return {...row,folder};
  });
  for(const row of candidates){
   // Files are scoped to this actor's mounted directory. Shared company assets,
   // other actor namespaces, credentials and central billing are never touched.
   if(fs.existsSync(row.folder))fs.rmSync(row.folder,{recursive:true,force:false});
   db.prepare("UPDATE projects SET status='purged',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);
   db.prepare("UPDATE threads SET status='archived',archived_at=CURRENT_TIMESTAMP WHERE project_id=?").run(row.id);
   results.push({id:row.id,name:row.name});
  }
 }).immediate();
 return results;
}
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>创作者回收站</title><style>body{background:#171a20;color:#e6e9ef;font:15px system-ui;margin:32px auto;max-width:950px;padding:0 24px}a{color:#bcc8f3}header{display:flex;align-items:center;justify-content:space-between}button{background:#303644;color:inherit;border:1px solid #495162;border-radius:8px;padding:9px 14px;cursor:pointer}button:disabled{opacity:.45;cursor:default}.danger{background:#832d39}table{width:100%;margin-top:22px;border-collapse:collapse}td,th{padding:15px;text-align:left;border-bottom:1px solid #353b46}small,p{color:#aeb7c8}#msg{color:#facb85}</style><header><h1>创作者回收站</h1><a href="/creator-app#/dashboard">返回工作台</a></header><p>归档工程可以恢复。彻底删除会立即清理该工程独占的 NAS 目录；其他工程、公司素材和账单保留。</p><button id="restore" disabled>恢复选中</button> <button id="purge" class="danger" disabled>彻底删除选中</button><p id="msg" role="status"></p><table><thead><tr><th><input id="all" type="checkbox" aria-label="全选"></th><th>工程</th><th>归档时间</th></tr></thead><tbody id="rows"></tbody></table><script>
const api='/.opencreator/runtime/fg-trash';let projects=[];
const ids=()=>[...document.querySelectorAll('input[data-id]:checked')].map(e=>e.dataset.id);
function update(){const empty=!ids().length;document.querySelector('#restore').disabled=empty;document.querySelector('#purge').disabled=empty;}
async function load(){const r=await fetch(api+'?format=json');if(!r.ok)throw Error('回收站暂不可用');projects=(await r.json()).projects;const rows=document.querySelector('#rows');rows.replaceChildren();for(const p of projects){const row=document.createElement('tr');const box=document.createElement('input');box.type='checkbox';box.dataset.id=p.id;box.setAttribute('aria-label','选择 '+p.name);box.onchange=update;const select=document.createElement('td');select.append(box);row.append(select);for(const text of [p.name,p.archived_at||'—']){const td=document.createElement('td');td.textContent=text;row.append(td);}rows.append(row);}document.querySelector('#all').checked=false;update();if(!projects.length)document.querySelector('#msg').textContent='回收站为空';}
document.querySelector('#all').onchange=e=>{document.querySelectorAll('input[data-id]').forEach(b=>b.checked=e.target.checked);update();};
async function act(action){const selected=ids();if(!selected.length)return;if(action==='purge'&&!confirm('彻底删除 '+selected.length+' 个工程及其独占的 NAS 文件？此操作无法恢复。'))return;const r=await fetch(api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,ids:selected,confirm:action==='purge'})});const result=await r.json();if(!r.ok)throw Error(result.error||'操作失败');document.querySelector('#msg').textContent=action==='purge'?'已彻底删除':'已恢复';await load();}
for(const name of ['restore','purge'])document.querySelector('#'+name).onclick=()=>act(name).catch(e=>document.querySelector('#msg').textContent=e.message);load().catch(e=>document.querySelector('#msg').textContent=e.message);
</script></html>`;

export async function trashRoute(req,res,connection){
 const url=new URL(req.url,'http://runtime');if(url.pathname!=='/fg-trash')return false;
 const Database=createRequire('/app/apps/daemon/dist/main.js')('better-sqlite3');
 const db=new Database('/state/opencreator/data/app.sqlite',{fileMustExist:true});db.pragma('foreign_keys = ON');db.pragma('busy_timeout = 5000');
 const reply=(status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));};
 try{
  if(req.method==='GET'){
   if(url.searchParams.get('format')==='json')reply(200,{projects:db.prepare("SELECT id,name,archived_at FROM projects WHERE status='archived' ORDER BY archived_at DESC").all()});
   else{res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(html);}return true;
  }
  if(req.method!=='POST')throw Error('不支持的清理操作');let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>16384)throw Error('请求过大');chunks.push(chunk);}const data=JSON.parse(Buffer.concat(chunks));
  if(data.action==='purge'&&data.confirm===true)reply(200,{deleted:purgeProjects(db,'/workspace',data.ids)});
  else if(data.action==='restore'&&Array.isArray(data.ids)&&data.ids.length<=100){
   for(const id of data.ids){if(!/^project_[A-Za-z0-9_-]{10}$/.test(id))throw Error('工程无效');const existing=db.prepare("SELECT id FROM projects WHERE id=? AND status='archived'").get(id);if(!existing)throw Error('工程不在回收站');const r=await fetch(new URL('/projects/'+id+'/restore',connection.address),{method:'POST',headers:{authorization:'Bearer '+connection.token}});if(!r.ok)throw Error('恢复失败');}reply(200,{restored:data.ids.length});
  }else throw Error('彻底删除需要再次确认');
 }catch(e){reply(400,{error:e.message});}finally{db.close();}return true;
}
