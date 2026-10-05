import http from 'node:http';
import {createHmac, createHash, randomUUID, timingSafeEqual} from 'node:crypto';
import {pipeline} from 'node:stream';
import {priceQuote} from './fg-quotes.mjs';
import {responseHeaders} from './policy.mjs';
import {advertisingModels,selectedAdvertisingModel} from './fg-adcraft-models.mjs';
import {admissionPrice} from './fg-budgets.mjs';
import {purgeArchivedAdvertising} from './fg-adcraft-retention.mjs';

const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const models={text:'claude-sonnet-5-5-t3a',image:'seedream-5-0-lite-260128',video:'doubao-seedance-2-0-fast-filter-off'};
const secret=()=>process.env.FG_ADCRAFT_SECRET||'';
export function tokenContext(token,workspace){
  if(!secret()||typeof token!=='string')throw Error('FG 广告服务未授权');
  const [raw,signature,...extra]=token.split('.');
  const expected=createHmac('sha256',secret()).update(raw||'').digest('hex');
  if(extra.length||!signature||signature.length!==expected.length||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw Error('FG 广告服务未授权');
  const context=JSON.parse(Buffer.from(raw,'base64url').toString());
  if(context.workspace!==workspace||!uuid.test(context.actor||'')||typeof context.operation!=='string'||context.operation.length>180)throw Error('FG 广告操作身份无效');
  return context;
}
export async function initializeAdcraft(pool){
  await pool.query(`CREATE TABLE IF NOT EXISTS fg_adcraft_workspaces(id uuid PRIMARY KEY,owner_id varchar(36) NOT NULL REFERENCES users(id),native_project_id varchar(36) UNIQUE NOT NULL REFERENCES projects(id),name varchar(160) NOT NULL,brief text NOT NULL,group_id uuid REFERENCES fg_groups(id),story_id integer, budget_cny numeric(16,2) NOT NULL CHECK(budget_cny>0),archived_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS fg_adcraft_members(workspace_id uuid REFERENCES fg_adcraft_workspaces(id),user_id varchar(36) REFERENCES users(id),PRIMARY KEY(workspace_id,user_id));
    CREATE TABLE IF NOT EXISTS fg_adcraft_jobs(id uuid PRIMARY KEY,workspace_id uuid REFERENCES fg_adcraft_workspaces(id),actor_id varchar(36) NOT NULL REFERENCES users(id),logical_key varchar(64) NOT NULL,task_id varchar(36) REFERENCES tasks(id),mode varchar(12) NOT NULL,reserved_cny numeric(16,6) NOT NULL,status varchar(16) NOT NULL DEFAULT 'reserved',error varchar(300) NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,logical_key));`);
  await pool.query('ALTER TABLE fg_adcraft_workspaces ADD COLUMN IF NOT EXISTS adcraft_project_id varchar(80); ALTER TABLE fg_adcraft_workspaces ADD COLUMN IF NOT EXISTS adcraft_workflow_id varchar(80); ALTER TABLE fg_adcraft_workspaces DROP CONSTRAINT IF EXISTS fg_adcraft_workspaces_budget_cny_check; ALTER TABLE fg_adcraft_workspaces ADD CONSTRAINT fg_adcraft_workspaces_budget_cny_check CHECK(budget_cny>=0)');
  await pool.query('ALTER TABLE fg_adcraft_workspaces ADD COLUMN IF NOT EXISTS purged_at timestamptz');
}
export async function advertisingAccess(pool,actor,id){
  if(!uuid.test(id))return null;
  return (await pool.query(`SELECT w.* FROM fg_adcraft_workspaces w WHERE w.id=$1 AND w.archived_at IS NULL AND ($3 OR w.owner_id=$2 OR EXISTS(SELECT 1 FROM fg_adcraft_members a WHERE a.workspace_id=w.id AND a.user_id=$2))`,[id,actor.id,actor.reviewer===true])).rows[0]||null;
}
// Release a reservation only with a complete receipt match or explicit proof
// that the provider request never left FG. Missing receipts remain reserved.
export function budgetCharge(row){
  if(row.not_sent)return 0;
  const actual=Number(row.settled_cny)||0;
  return Number(row.billable_count)>0&&Number(row.matched_count)===Number(row.billable_count)?actual:Math.max(actual,Number(row.reserved_cny)||0);
}
async function budgetUsage(client,workspace){
  const {rows}=await client.query(`WITH calls AS (
    SELECT id,task_id,model,capability,fg_fee_reference_id,fg_fee_references_json,provider_request_id FROM api_call_logs WHERE billable=true AND channel_id IN(SELECT id FROM model_channels WHERE name LIKE 'WeToken%')
  ), candidates AS (
    SELECT f.reference_id,min(c.id) call_id FROM fg_provider_fees f JOIN calls c ON c.model=f.model AND (c.fg_fee_reference_id=f.reference_id OR c.fg_fee_references_json::jsonb ? f.reference_id OR(c.capability='video' AND c.provider_request_id=f.reference_id)) GROUP BY f.reference_id HAVING count(*)=1
  ), matched AS (
    SELECT reference_id,call_id FROM candidates WHERE call_id IN(SELECT call_id FROM candidates GROUP BY call_id HAVING count(*)=1)
  ) SELECT j.reserved_cny,count(c.id) billable_count,count(f.reference_id) matched_count,COALESCE(sum(f.usd*f.fx),0) settled_cny,
    (t.status IN ('failed','cancelled') AND count(c.id)=0 AND (EXISTS(SELECT 1 FROM api_call_logs l WHERE l.task_id=j.task_id AND l.error_code='request_not_sent') OR(t.status='cancelled' AND t.started_at IS NULL))) not_sent
    FROM fg_adcraft_jobs j LEFT JOIN tasks t ON t.id=j.task_id LEFT JOIN calls c ON c.task_id=j.task_id LEFT JOIN matched m ON m.call_id=c.id LEFT JOIN fg_provider_fees f ON f.reference_id=m.reference_id
    WHERE j.workspace_id=$1 AND j.status<>'rejected' GROUP BY j.id,j.task_id,t.status,t.started_at`,[workspace]);
  return rows.reduce((total,row)=>total+budgetCharge(row),0);
}
const json=(res,data,status=200,envelope=true)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(envelope?{code:status===200?0:status,data:status===200?data:null,msg:status===200?'':String(data)}:data));};
async function body(req,max=24<<20){let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>max)throw Error('请求过大');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString());}
async function nativeAPI(web,cookie,origin,path,method='GET',payload){
  const response=await fetch(new URL('/api'+path,web),{method,headers:{cookie,origin,'content-type':'application/json'},body:payload===undefined?undefined:JSON.stringify(payload),signal:AbortSignal.timeout(120000)});
  const data=await response.json();if(!response.ok||data.code!==0)throw Error(data.msg||'FG 制作服务暂时不可用');return data.data;
}
export async function adcraftUserRoute(req,res,{pool,actor,cookie,web,publicOrigin,path}){
  const purgeMatch=/^\/api\/fg\/advertising\/([^/]+)\/purge$/.exec(path.pathname);
  if(purgeMatch&&req.method==='POST'){
    try{if(!uuid.test(purgeMatch[1]))throw Error('项目编号无效');await purgeArchivedAdvertising(pool,purgeMatch[1],{actor});json(res,{id:purgeMatch[1],purged:true});}
    catch(error){json(res,error.message,400);}return true;
  }
  const deleteMatch=/^\/api\/fg\/advertising\/([^/]+)(\/restore)?$/.exec(path.pathname);
  if(deleteMatch&&((req.method==='DELETE'&&!deleteMatch[2])||(req.method==='POST'&&deleteMatch[2]))){
    try{
      if(!uuid.test(deleteMatch[1]))throw Error('项目编号无效');
      const client=await pool.connect();try{
        await client.query('BEGIN');
        const w=(await client.query('SELECT * FROM fg_adcraft_workspaces WHERE id=$1 FOR UPDATE',[deleteMatch[1]])).rows[0];
        if(!w||(!actor.reviewer&&w.owner_id!==actor.id)){await client.query('ROLLBACK');json(res,'仅所有者或超级管理员可以删除或恢复项目',403);return true;}
        const active=(await client.query("SELECT count(*) n FROM tasks WHERE project_id=$1 AND status IN ('queued','running')",[w.native_project_id])).rows[0];if(Number(active.n))throw Error('请先结束项目中正在运行的任务');
        const restore=Boolean(deleteMatch[2]);if(w.purged_at)throw Error('该广告项目已到期清理，不能恢复');await client.query('UPDATE fg_adcraft_workspaces SET archived_at=$2 WHERE id=$1',[w.id,restore?null:w.archived_at||new Date()]);
        await client.query('UPDATE projects SET status=$2 WHERE id=$1',[w.native_project_id,restore?'active':'archived']);
        await client.query('COMMIT');json(res,{id:w.id,restored:restore,retainedMedia:true});
      }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
    }catch(e){json(res,e.message,400);}return true;
  }
  const memberMatch=/^\/api\/fg\/advertising\/([^/]+)\/members$/.exec(path.pathname);
  if(memberMatch){
    try{const workspace=await advertisingAccess(pool,actor,memberMatch[1]);if(!workspace||(!actor.reviewer&&workspace.owner_id!==actor.id)){json(res,'仅项目所有者或超级管理员可管理分享',403);return true;}
      if(req.method==='GET'){json(res,{members:(await pool.query('SELECT user_id FROM fg_adcraft_members WHERE workspace_id=$1',[workspace.id])).rows.map(r=>r.user_id),users:(await pool.query("SELECT u.id,u.display_name name,a.email FROM users u JOIN fg_accounts a ON a.user_id=u.id WHERE u.status='active' AND u.id<>$1 ORDER BY u.display_name",[workspace.owner_id])).rows});return true;}
      if(req.method==='PUT'){const input=await body(req,8192);if(!Array.isArray(input.userIds)||input.userIds.length>100||input.userIds.some(id=>!uuid.test(id)))throw Error('请选择有效成员');const client=await pool.connect();try{await client.query('BEGIN');await client.query('SELECT id FROM fg_adcraft_workspaces WHERE id=$1 FOR UPDATE',[workspace.id]);const valid=(await client.query("SELECT id FROM users WHERE id=ANY($1::text[]) AND status='active'",[input.userIds])).rows;if(valid.length!==new Set(input.userIds).size)throw Error('部分成员不可用');await client.query('DELETE FROM fg_adcraft_members WHERE workspace_id=$1',[workspace.id]);for(const user of valid)await client.query('INSERT INTO fg_adcraft_members(workspace_id,user_id) VALUES($1,$2)',[workspace.id,user.id]);await client.query('COMMIT');json(res,{saved:true});}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}return true;}
    }catch(e){json(res,e.message,400);}return true;
  }
  const assetMatch=/^\/api\/fg\/advertising\/([^/]+)\/company-asset$/.exec(path.pathname);
  if(assetMatch&&req.method==='POST'){
    try{
      const workspace=await advertisingAccess(pool,actor,assetMatch[1]);if(!workspace?.adcraft_workflow_id){json(res,'请先打开广告工程',409);return true;}
      const input=await body(req,4096);if(!/^[a-zA-Z0-9_-]{1,64}$/.test(input.assetId||''))throw Error('请选择公司素材');
      const asset=(await pool.query("SELECT * FROM fg_company_assets WHERE id=$1 AND status='active'",[input.assetId])).rows[0];if(!asset)throw Error('素材已下架或不存在');
      const response=await fetch(new URL('/api/resources/'+asset.resource_id+'/file',web),{headers:{cookie},signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error('公司素材读取失败');const blob=await response.blob();
      const form=new FormData();form.set('file',blob,asset.title+'.'+(asset.kind==='image'?'png':asset.kind==='video'?'mp4':'mp3'));form.set('metadata',JSON.stringify({title:asset.title,media_type:asset.kind,metadata:{fg_company_asset_id:asset.id,brand:asset.brand,style:asset.style}}));
      const imported=await fetch('http://adcraft-api:8000/w/'+workspace.id+'/api/v2/workflows/'+workspace.adcraft_workflow_id+'/assets/upload',{method:'POST',headers:{'x-fg-internal':secret(),'x-fg-actor':actor.id,'x-fg-operation':'company-'+asset.id,'idempotency-key':'fg-company-'+asset.id+'-'+workspace.adcraft_workflow_id},body:form,signal:AbortSignal.timeout(120000)});const result=await imported.json();if(!imported.ok)throw Error(result.detail?.message||'广告素材导入失败');json(res,{imported:true});
    }catch(error){json(res,error.message,400);}return true;
  }
  const quoteMatch=/^\/api\/fg\/advertising\/([^/]+)\/quote$/.exec(path.pathname);
  if(quoteMatch&&req.method==='POST'){
    try{
      if(!await advertisingAccess(pool,actor,quoteMatch[1])){json(res,'无权访问该项目',403);return true;}
      const input=await body(req,4096);const selected=await selectedAdvertisingModel(pool,input.mode,input.model||models[input.mode]);const model=selected.billingId;
      const price=(await pool.query('SELECT snapshot FROM fg_model_prices WHERE model=$1',[model])).rows[0]?.snapshot;const fx=Number((await pool.query("SELECT value FROM fg_company_settings WHERE key='usdCnyRate'")).rows[0]?.value);
      const profile=selected.profile[input.mode],options=input.options||{};
      const normalized={...options,count:'1',size:options.size||options.aspect_ratio||profile.size?.default||profile.defaultRatio,quality:options.quality||profile.quality?.default,vquality:options.resolution||profile.defaultResolution,videoSeconds:options.duration_seconds||profile.duration?.default};
      const inputs={image:Number(input.images)||0,video:Number(input.videos)||0,audio:Number(input.audios)||0};
      json(res,priceQuote(model,price,{capability:input.mode,operation:inputs.video?'video_to_video':inputs.image?'image_to_video':'text_to_video',inputs,options:normalized},fx));
    }catch(error){json(res,error.message,400);}return true;
  }
  const budgetMatch=/^\/api\/fg\/advertising\/([^/]+)\/budget$/.exec(path.pathname);
  if(budgetMatch&&req.method==='PATCH'){
    try{const workspace=await advertisingAccess(pool,actor,budgetMatch[1]);if(!workspace||!actor.reviewer){json(res,'仅超级管理员可以修改预算',403);return true;}
      const input=await body(req,4096);const budget=Number(input.budgetCny||0);if(!Number.isFinite(budget)||budget<0||budget>10000000)throw Error('预算无效');
      const client=await pool.connect();try{await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('fg-budget-project:'||$1))",[workspace.native_project_id]);const before=(await client.query('SELECT budget_cny FROM fg_adcraft_workspaces WHERE id=$1 FOR UPDATE',[workspace.id])).rows[0];await client.query('UPDATE fg_adcraft_workspaces SET budget_cny=$2 WHERE id=$1',[workspace.id,budget]);await client.query('INSERT INTO fg_finance_audit(id,actor_id,action,target,before_value,after_value) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),actor.id,'advertising_budget',workspace.native_project_id,before,{budgetCny:budget}]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}json(res,{budgetCny:budget});
    }catch(error){json(res,error.message,400);}return true;
  }
  const openMatch=/^\/api\/fg\/advertising\/([^/]+)\/open$/.exec(path.pathname);
  if(openMatch&&req.method==='POST'){
    try{
      const workspace=await advertisingAccess(pool,actor,openMatch[1]);if(!workspace){json(res,'没有这个广告项目的访问权限',403);return true;}
      if(!workspace.adcraft_project_id){
        const response=await fetch('http://adcraft-api:8000/w/'+workspace.id+'/api/v2/projects',{method:'POST',headers:{'content-type':'application/json','x-fg-internal':secret(),'x-fg-actor':actor.id,'x-fg-operation':'init-'+workspace.id,'idempotency-key':'fg-'+workspace.id+'-init'},body:JSON.stringify({name:workspace.name,description:workspace.brief}),signal:AbortSignal.timeout(120000)});
        const created=await response.json();if(!response.ok||!created.project_id||!created.workflow_id)throw Error(adcraftServiceFailure(created,response.status));
        await pool.query('UPDATE fg_adcraft_workspaces SET adcraft_project_id=$2,adcraft_workflow_id=$3 WHERE id=$1',[workspace.id,created.project_id,created.workflow_id]);workspace.adcraft_project_id=created.project_id;
      }else{
        // Restore the mapped project; never replace a missing or temporarily
        // unavailable project with an empty project.
        const response=await fetch('http://adcraft-api:8000/w/'+workspace.id+'/api/v2/projects/'+encodeURIComponent(workspace.adcraft_project_id),{headers:{'x-fg-internal':secret(),'x-fg-actor':actor.id},signal:AbortSignal.timeout(20000)});
        if(!response.ok)throw Error(adcraftServiceFailure(await response.json().catch(()=>null),response.status));
      }
      json(res,{url:'/advertising-app/'+workspace.id+'/workflow/'+workspace.adcraft_project_id});
    }catch(error){json(res,error.message,503);}return true;
  }
  if(path.pathname==='/api/fg/advertising'){
    try {
      if(req.method==='GET'){
        const rows=(await pool.query(`SELECT w.*,NULL group_name,u.display_name owner_name FROM fg_adcraft_workspaces w JOIN users u ON u.id=w.owner_id WHERE w.purged_at IS NULL AND (w.archived_at IS NOT NULL)=$3 AND ($2 OR w.owner_id=$1 OR EXISTS(SELECT 1 FROM fg_adcraft_members a WHERE a.workspace_id=w.id AND a.user_id=$1)) ORDER BY w.created_at DESC`,[actor.id,actor.reviewer,path.searchParams.get('archived')==='true'])).rows;
        const groups=[];
        for(const row of rows){row.can_manage=actor.reviewer||row.owner_id===actor.id;row.can_budget=actor.reviewer;}
        json(res,{workspaces:rows,groups,models});return true;
      }
      if(req.method==='POST'){
        const input=await body(req,32768);const name=String(input.name||'').trim(),brief=String(input.brief||'').trim(),budget=Number(input.budgetCny||0);
        if(!name||name.length>160||brief.length<5||brief.length>10000||!Number.isFinite(budget)||budget<0||budget>1000000)throw Error('请填写项目名称、广告需求和有效预算');
        if(input.groupId||input.storyId)throw Error('广告项目独立于神话故事小组和故事库');
        const {project}=await nativeAPI(web,cookie,publicOrigin,'/projects','POST',{name,type:'advertising',aspectRatio:input.aspectRatio==='9:16'?'9:16':'16:9',sourceType:'text',description:brief});
        const id=randomUUID();await pool.query('INSERT INTO fg_adcraft_workspaces(id,owner_id,native_project_id,name,brief,group_id,story_id,budget_cny) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,actor.id,project.id,name,brief,null,null,budget]);
        json(res,{id,projectId:project.id});return true;
      }
      json(res,'不支持此操作',405);return true;
    }catch(error){json(res,error.message,400);return true;}
  }
  const match=/^\/(advertising-app|adcraft-api)\/([^/]+)(\/.*)?$/.exec(path.pathname);
  const staticReference=/\/(?:advertising-app|adcraft-static)\//.test(String(req.headers.referer||''))&&(/^\/(?:brand|agent-icons|agent-roles|video-skills|showcase|imgs|icon|fonts)\//.test(path.pathname)||/^\/assets\/.*\.(?:webp|png|jpg|svg|mp4)$/.test(path.pathname));
  if(!match&&!path.pathname.startsWith('/adcraft-static/')&&!staticReference)return false;
  if(!secret()){json(res,'广告工作台尚未配置',503);return true;}
  if(match&&!await advertisingAccess(pool,actor,match[2])){json(res,'没有这个广告项目的访问权限',403);return true;}
  let target;
  const headers={'x-fg-internal':secret(),'x-fg-actor':actor.id,'x-fg-operation':String(req.headers['idempotency-key']||randomUUID())};
  for(const key of ['content-type','content-length','accept','range','if-match','if-none-match','idempotency-key'])if(req.headers[key])headers[key]=req.headers[key];
  if(match?.[1]==='adcraft-api'){
    const inner=decodeURIComponent(match[3]||'/');
    const nativePurge=/^\/api\/v2\/projects\/(proj_[A-Za-z0-9_-]{1,100})\/purge$/.exec(inner);
    if(req.method==='POST'&&nativePurge){
      const w=await advertisingAccess(pool,actor,match[2]);
      if((!actor.reviewer&&w.owner_id!==actor.id)||w.adcraft_project_id===nativePurge[1]){json(res,'请在 FG 广告项目回收站管理主工程；只有所有者或超级管理员可以彻底删除',403,false);return true;}
      const response=await fetch('http://adcraft-api:8000/internal/fg/project-cleanup/'+w.id+'/'+nativePurge[1],{method:'POST',headers:{'x-fg-internal':secret()},signal:AbortSignal.timeout(120000)});
      json(res,await response.json(),response.status,false);return true;
    }
    if(req.method==='POST'&&/^\/api\/v2\/projects\/?$/.test(inner)){json(res,'请从 FG 广告项目页创建广告工程，避免产生未关联项目',409);return true;}
    const deleting=/^\/api\/v2\/projects\/([^/]+)$/.exec(inner);
    if(req.method==='DELETE'&&deleting){const w=await advertisingAccess(pool,actor,match[2]);if(deleting[1]===w.adcraft_project_id){json(res,'请返回 FG 广告项目页删除主工程；项目会进入可恢复的回收站',409);return true;}}
    if(inner.startsWith('/internal/')||(/providers|provider-settings|provider-certifications/.test(inner)&& !['GET','HEAD'].includes(req.method))){json(res,'模型渠道由 FG 管理',403);return true;}
    target=new URL('/w/'+match[2]+inner+path.search,'http://adcraft-api:8000');
  }else target=new URL(staticReference?path.pathname:path.pathname.startsWith('/adcraft-static/')?path.pathname.replace('/adcraft-static',''):'/index.html','http://adcraft-web');
  const upstream=http.request(target,{method:req.method,headers},remote=>{res.writeHead(remote.statusCode||502,{...responseHeaders(remote.headers),'cache-control':target.pathname.endsWith('index.html')?'no-store':remote.headers['cache-control']||'private, no-cache'});pipeline(remote,res,()=>{});});
  upstream.on('error',()=>{if(!res.headersSent)json(res,'广告工作台正在启动，请稍后重试',503);else res.destroy();});
  req.on('aborted',()=>upstream.destroy());res.on('close',()=>{if(!res.writableEnded)upstream.destroy();});pipeline(req,upstream,()=>{});return true;
}

export function adcraftServiceFailure(payload,status){
  const detail=typeof payload?.detail==='string'?payload.detail:payload?.detail?.message||'';
  if(status===503&&detail.includes('NAS'))return 'NAS 连接暂不可用，广告工程已停止写入；工程数据保留，请恢复 NAS 连接后重试';
  if(status===404)return '广告工程未找到，已保留原工程关联，请联系管理员恢复备份';
  if(status===403)return '广告服务拒绝访问，请联系管理员检查工程权限';
  return '广告服务暂不可用，请稍后重试（HTTP '+status+'）';
}

async function importReference(value,kind,context,cookie,env){
  if(typeof value!=='string')throw Error('参考素材无效');
  let blob;
  if(value.startsWith('data:')){const m=/^data:([^;]+);base64,(.+)$/s.exec(value);if(!m)throw Error('参考素材格式无效');blob=new Blob([Buffer.from(m[2],'base64')],{type:m[1]});}
  else {
    const parsed=new URL(value,'http://adcraft-api:8000');const prefix='/w/'+context.workspace+'/';
    // Read only the authorised native workspace, never a caller's arbitrary URL.
    let inner=parsed.pathname;
    if(inner.startsWith('/adcraft-api/'+context.workspace+'/'))inner='/w/'+context.workspace+'/'+inner.split('/').slice(3).join('/');
    if(inner.startsWith('/media/')||inner.startsWith('/api/v2/assets/'))inner=prefix+inner.slice(1);
    if(!inner.startsWith(prefix)||(!inner.includes('/media/')&&!/^\/w\/[^/]+\/api\/v2\/assets\/[^/]+\/(?:content|preview|poster)$/.test(inner)))throw Error('请先把参考素材上传到广告项目');
    const r=await fetch(new URL(inner+parsed.search,'http://adcraft-api:8000'),{headers:{'x-fg-internal':secret()},signal:AbortSignal.timeout(120000)});if(!r.ok)throw Error('参考素材读取失败');blob=await r.blob();
  }
  if(blob.size>50<<20)throw Error('当前广告模型中转单个参考素材上限 50 MB，请压缩后上传');
  const form=new FormData();form.set('kind',kind);form.set('file',blob,kind+'.'+(kind==='image'?'png':kind==='video'?'mp4':'mp3'));
  const r=await fetch(new URL('/api/resources',env.web),{method:'POST',headers:{cookie,origin:env.publicOrigin,'x-idempotency-key':'ad-ref-'+createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex')},body:form,signal:AbortSignal.timeout(120000)});
  const result=await r.json();if(!r.ok||result.code!==0)throw Error(result.msg||'参考素材未保存到 NAS');
  return {id:result.data.resource.id,storageKey:'resource:'+result.data.resource.id,name:'广告参考素材',type:blob.type};
}
function finalResult(task){if(task.status==='failed'||task.status==='cancelled')throw Error(task.error||'FG 制作任务失败');return JSON.parse(task.resultJson||'{}');}
async function waitTask(api,id){for(let i=0;i<1800;i++){const data=await api('/tasks/'+id);const task=data.task||data;if(['succeeded','failed','cancelled'].includes(task.status))return task;await new Promise(r=>setTimeout(r,1000));}throw Error('任务仍在运行，请在任务记录中继续查看；未重复提交');}
function outputResource(result){const list=[...(result.images||[]),...(result.videos||[]),result.video,result.image].filter(Boolean);return list.find(x=>x.storageKey||x.resourceId||x.url)||result;}

export async function adcraftInternalRoute(req,res,{pool,web,publicOrigin,canvasSession,path}){
  const match=/^\/internal\/adcraft\/([^/]+)(\/.*)$/.exec(path.pathname);if(!match)return false;
  try{
    if(!uuid.test(match[1]))throw Error('工作区无效');
    if(req.method==='GET'&&match[2]==='/models'){
      if(!secret()||req.headers['x-fg-internal']!==secret())throw Error('FG 广告服务未授权');
      json(res,{models:await advertisingModels(pool)},200,false);return true;
    }
    if(req.method==='GET'&&match[2].startsWith('/contents/generations/tasks/')){
      if(!secret()||req.headers['x-fg-internal']!==secret())throw Error('FG 广告服务未授权');
      const id=match[2].split('/').pop();const job=(await pool.query('SELECT j.*,w.native_project_id FROM fg_adcraft_jobs j JOIN fg_adcraft_workspaces w ON w.id=j.workspace_id WHERE j.task_id=$1 AND j.workspace_id=$2',[id,match[1]])).rows[0];if(!job)throw Error('任务不存在');
      const actor=(await pool.query('SELECT u.id,u.display_name name,a.email,a.platform_role FROM users u JOIN fg_accounts a ON a.user_id=u.id WHERE u.id=$1',[job.actor_id])).rows[0];if(!actor)throw Error('账号不存在');const cookie=await canvasSession({...actor,platformRole:actor.platform_role,reviewer:actor.platform_role==='superadmin'});
      const taskData=await nativeAPI(web,cookie,publicOrigin,'/tasks/'+id),task=taskData.task||taskData;
      let content={};if(task.status==='succeeded')content={video_url:await resultURL(pool,cookie,{web,publicOrigin},finalResult(task))};
      json(res,{id,status:task.status==='queued'?'queued':task.status==='running'?'running':task.status,content,error:task.error?{message:task.error}:undefined},200,false);return true;
    }
    if(req.method!=='POST')throw Error('不支持的模型操作');
    const context=tokenContext(String(req.headers.authorization||'').replace(/^Bearer /,''),match[1]);
    const account=(await pool.query('SELECT u.id,u.display_name name,a.email,a.platform_role FROM users u JOIN fg_accounts a ON a.user_id=u.id WHERE u.id=$1',[context.actor])).rows[0];if(!account)throw Error('FG 账号不存在');
    const actor={...account,reviewer:account.platform_role==='superadmin',platformRole:account.platform_role};const workspace=await advertisingAccess(pool,actor,context.workspace);if(!workspace)throw Error('没有广告项目权限');
    const cookie=await canvasSession(actor);const api=(p,m,b)=>nativeAPI(web,cookie,publicOrigin,p,m,b);
    const payload=await body(req);const mode=match[2]==='/v1/chat/completions'?'text':match[2]==='/images/generations'?'image':match[2]==='/contents/generations/tasks'?'video':null;if(!mode)throw Error('不支持的模型接口');
    const selected=await selectedAdvertisingModel(pool,mode,payload.model||models[mode]);const model=selected.billingId;payload.model=model;
    const channel=(await pool.query(`SELECT cm.channel_id,cm.protocol,c.api_format FROM channel_models cm JOIN model_channels c ON c.id=cm.channel_id WHERE c.name LIKE 'WeToken%' AND cm.model_key=$1 AND cm.enabled=true AND c.enabled=true AND cm.deleted_at IS NULL AND c.deleted_at IS NULL LIMIT 1`,[model])).rows[0];if(!channel)throw Error('FG 中未启用当前广告模型');
    const references={image:[],video:[],audio:[]};const env={web,publicOrigin};
    if(mode==='text'){
      for(const message of payload.messages||[])if(Array.isArray(message.content))for(const part of message.content)if(part.type==='image_url') { const ref=await importReference(part.image_url.url,'image',context,cookie,env);references.image.push(ref);part.image_url.url=ref.storageKey; }
    }else if(mode==='image')for(const value of [payload.image||[]].flat())if(value)references.image.push(await importReference(value,'image',context,cookie,env));
    else for(const part of payload.content||[])for(const kind of ['image','video','audio'])if(part.type===kind+'_url')references[kind].push(await importReference(part[kind+'_url']?.url,kind,context,cookie,env));
    const prompt=mode==='text'?JSON.stringify(payload.messages||[]):mode==='image'?payload.prompt:(payload.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');if(!prompt)throw Error('请填写制作内容');
    const profile=selected.profile[mode];
    const config={channelId:channel.channel_id,model,interfaceType:channel.protocol,apiFormat:channel.api_format||'openai',count:'1',size:mode==='image'?String(payload.size||profile.size.default):String(payload.ratio||profile.defaultRatio||'16:9'),quality:String(payload.quality||profile.quality?.default||''),videoSeconds:String(payload.duration||profile.duration?.default||5),vquality:String(payload.resolution||profile.defaultResolution||'480p').toUpperCase(),videoGenerateAudio:profile.generateAudio?.supported&&(payload.generate_audio??profile.generateAudio.default)?'true':'false'};
    if(mode==='video'&&(!profile.duration.values.includes(Number(config.videoSeconds))||!profile.resolutions.some(v=>v.toUpperCase()===config.vquality)||!profile.ratios.includes(config.size)))throw Error('此模型不支持所选时长、分辨率或比例');
    if(mode!=='text')for(const [kind,refs] of Object.entries(references)){const limit=profile.references['max'+kind[0].toUpperCase()+kind.slice(1)+'s']||0;if(refs.length>limit)throw Error('此模型不支持当前数量的'+kind+'参考素材');}
    if(mode==='video'&&references.image.length<(profile.references.minImages||0))throw Error('此模型需要上传参考图片');
    const intent={capability:mode,inputs:{text:1,image:references.image.length,video:references.video.length,audio:references.audio.length},options:{...config,size:config.size,vquality:config.vquality}};
    const price=(await pool.query('SELECT snapshot FROM fg_model_prices WHERE model=$1',[model])).rows[0]?.snapshot;const fx=Number((await pool.query("SELECT value FROM fg_company_settings WHERE key='usdCnyRate'")).rows[0]?.value);
    // A token-priced or partial quote has no exact pre-generation total. Only
    // uncapped projects may submit it; native monthly admission still applies.
    const amount=admissionPrice(model,mode,{...payload,max_tokens:payload.max_tokens||payload.max_completion_tokens||8192,size:config.size,quality:config.quality,resolution:config.vquality,duration:Number(config.videoSeconds)},price,fx);
    const logical=createHash('sha256').update(JSON.stringify([context.operation,context.actor,mode,payload])).digest('hex');
    const client=await pool.connect();let job;
    try{await client.query('BEGIN');const locked=(await client.query('SELECT budget_cny FROM fg_adcraft_workspaces WHERE id=$1 FOR UPDATE',[workspace.id])).rows[0];if(!locked)throw Error('广告项目不存在');job=(await client.query('SELECT * FROM fg_adcraft_jobs WHERE workspace_id=$1 AND logical_key=$2',[workspace.id,logical])).rows[0];
      if(!job){const used=await budgetUsage(client,workspace.id);if(Number(locked.budget_cny)>0&&(amount===null||used+amount>Number(locked.budget_cny)))throw Error(amount===null?'此规格不能确定费用上限，请联系超级管理员':'广告项目预算不足，请联系超级管理员调整预算');job={id:randomUUID()};await client.query('INSERT INTO fg_adcraft_jobs(id,workspace_id,actor_id,logical_key,mode,reserved_cny) VALUES($1,$2,$3,$4,$5,$6)',[job.id,workspace.id,actor.id,logical,mode,amount??0]);}
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    if(!job.task_id){
      if(job.status){
        const recovered=(await pool.query("SELECT id FROM tasks WHERE user_id=$1 AND project_id=$2 AND input_json::jsonb #>> '{metadata,clientOperationId}'=$3 ORDER BY created_at DESC LIMIT 1",[actor.id,workspace.native_project_id,'adcraft-'+job.id])).rows[0];
        if(!recovered)throw Error('同一制作请求已登记，正在恢复；不会再次调用模型');
        job.task_id=recovered.id;await pool.query("UPDATE fg_adcraft_jobs SET task_id=$2,status='submitted' WHERE id=$1",[job.id,recovered.id]);
      }
    }
    if(!job.task_id){
      const input={mode,prompt,config,referenceImages:references.image,referenceVideos:references.video,referenceAudios:references.audio,metadata:{clientOperationId:'adcraft-'+job.id,source:'fg-advertising',adcraftWorkspaceId:workspace.id},...(mode==='text'?{agentRequests:{chatCompletion:{...payload,stream:false}},textOptions:{stream:false,maxOutputTokens:Number(payload.max_tokens||payload.max_completion_tokens||8192)}}:{})};
      let task;try{task=await api('/tasks','POST',{projectId:workspace.native_project_id,type:'canvas_'+mode,operation:mode,model,prompt,input});}catch(error){await pool.query("UPDATE fg_adcraft_jobs SET status='uncertain',error=$2 WHERE id=$1",[job.id,String(error.message).slice(0,300)]);throw error;}
      job.task_id=task.id;await pool.query("UPDATE fg_adcraft_jobs SET task_id=$2,status='submitted' WHERE id=$1",[job.id,task.id]);
    }
    if(mode==='video'){json(res,{id:job.task_id,status:'queued'},200,false);return true;}
    const task=await waitTask(api,job.task_id),result=finalResult(task);
    if(mode==='image'){json(res,{created:Math.floor(Date.now()/1000),data:[{url:await resultURL(pool,cookie,env,result)}]},200,false);return true;}
    const message={role:'assistant',content:result.text||null,...(result.toolCalls?.length?{tool_calls:result.toolCalls}: {})};
    json(res,{id:'chatcmpl-'+task.id,object:'chat.completion',created:Math.floor(Date.now()/1000),model,choices:[{index:0,message,finish_reason:result.toolCalls?.length?'tool_calls':'stop'}]},200,false);return true;
  }catch(error){json(res,{error:{message:error.message,type:'fg_adcraft_error'}},400,false);return true;}
}
async function resultURL(pool,cookie,env,result){
  const output=outputResource(result);let id=output.resourceId||String(output.storageKey||'').replace(/^resource:/,'');
  if(!id&&result.assetId){id=(await pool.query('SELECT resource_id FROM assets WHERE id=$1',[result.assetId])).rows[0]?.resource_id;}
  if(!id)throw Error('制作结果尚未归档到 NAS，请从任务记录恢复');
  const data=await nativeAPI(env.web,cookie,env.publicOrigin,'/resources/access','POST',[{resourceId:id,purpose:'provider-input',variant:'original'}]);const url=data.items?.[0]?.access?.url;if(!url)throw Error('制作素材链接暂时不可用');return url;
}
