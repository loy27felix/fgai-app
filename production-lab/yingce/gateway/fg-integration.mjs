import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {importFeeCsv} from './fg-fee-import.mjs';
import {estimateCNY} from './fg-prices.mjs';
import {priceQuote} from './fg-quotes.mjs';
import {capabilities} from './fg-model-capabilities.mjs';

export async function initializeFG(pool){await pool.query(await fs.readFile(new URL('./fg-schema.sql',import.meta.url),'utf8'));}
async function jsonBody(req,max=100000){const chunks=[];let n=0;for await(const c of req){n+=c.length;if(n>max)throw new Error('请求内容过大');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
function send(res,data,status=200){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify({code:status===200?0:status,data:status===200?data:null,msg:status===200?'':data}));}
export async function fgAPI(req,res,{actor,cookie,path,pool,web,platform,platformCookie,publicOrigin}){
  if(!path.pathname.startsWith('/api/fg/'))return false;
  const api=async(endpoint,method='GET',body)=>{
    const r=await fetch(new URL('/api'+endpoint,web),{method,headers:{cookie,origin:publicOrigin,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
    const j=await r.json();if(!r.ok||j.code!==0)throw new Error(j.msg||'FG 原生项目操作失败');return j.data;
  };
  try{
    if(path.pathname==='/api/fg/models/quote'&&req.method==='POST'){
      const body=await jsonBody(req);const model=String(body.modelKey||'');
      const price=(await pool.query('SELECT snapshot,collected_at FROM fg_model_prices WHERE model=$1',[model])).rows[0];
      if(!price)throw new Error('请选择已接入的 WeToken 模型');
      // Native authorization validates model ownership, enabled state and the
      // exact capability/options contract before returning our currency quote.
      await api('/model-catalog/quote','POST',{channelId:body.channelId,modelKey:model,intent:body.intent});
      const fx=Number((await pool.query("SELECT value FROM fg_company_settings WHERE key='usdCnyRate'")).rows[0].value);
      const duration=body.referenceVideoSeconds;
      const maxReferenceDuration=model.includes('seedance')?(model==='dreamina-seedance-2-5-filter-off'?30:15):45;
      if(duration!==undefined&&(!Number.isFinite(duration)||duration<0||duration>maxReferenceDuration))throw new Error('请提供有效的参考视频总时长，当前模型累计上限 '+maxReferenceDuration+' 秒');
      const intent={...body.intent,options:{...body.intent.options,...(duration!==undefined?{referenceVideoSeconds:duration}:{})}};
      send(res,{...priceQuote(model,price.snapshot,intent,fx),collectedAt:price.collected_at});return true;
    }
    if(path.pathname==='/api/fg/models/prices'&&req.method==='GET'){
      const prices=(await pool.query('SELECT model,snapshot,collected_at FROM fg_model_prices ORDER BY model')).rows;
      const evidence=(await pool.query(`SELECT t.model,t.operation,t.status,t.error,t.updated_at FROM tasks t WHERE t.input_json LIKE '%fg-model-matrix-20261001%' ORDER BY t.updated_at DESC`)).rows;
      const specs=JSON.parse(await fs.readFile(new URL('./model-specs.json',import.meta.url),'utf8'));
      const fx=Number((await pool.query("SELECT value FROM fg_company_settings WHERE key='usdCnyRate'")).rows[0].value);
      send(res,{models:prices.map(p=>{
        const spec=specs.find(s=>s.id===p.model),profile=capabilities(spec);
        const options=profile.image?{size:profile.image.size.default,quality:profile.image.quality.default,count:1}:profile.video?{size:profile.video.defaultRatio,vquality:profile.video.defaultResolution,videoSeconds:Math.min(...profile.video.duration.values)}:{};
        return {model:p.model,capability:spec.capability,enabled:p.snapshot.enabled,collectedAt:p.collected_at,profile,quote:priceQuote(p.model,p.snapshot,{capability:spec.capability,options,inputs:{}},fx),evidence:evidence.filter(e=>e.model.endsWith('::'+p.model)).map(e=>({operation:e.operation,status:e.status,error:e.error,updatedAt:e.updated_at}))};
      })});return true;
    }
    const topics=JSON.parse(await fs.readFile(process.env.FG_TOPICS_FILE||new URL('./topics.json',import.meta.url),'utf8'));
    if(path.pathname==='/api/fg/topics'&&req.method==='GET'){send(res,{topics});return true;}
    if(path.pathname==='/api/fg/projects'&&req.method==='GET'){
      const {rows}=await pool.query(`SELECT p.id,p.name,p.user_id,p.status,f.topic_id,f.topic_snapshot,f.tier,f.group_name,f.budget_cny,p.updated_at,
        u.display_name owner_name,(SELECT count(*)::int FROM canvas_projects c WHERE c.project_id=p.id) canvas_count
        FROM projects p JOIN users u ON u.id=p.user_id LEFT JOIN fg_story_projects f ON f.native_project_id=p.id WHERE p.user_id=$1 ORDER BY p.updated_at DESC`,[actor.id]);
      let legacy=[];let groups=[];
      const source=await fetch(new URL('/api/production-lab',platform),{headers:{cookie:platformCookie},signal:AbortSignal.timeout(15000)});
      if(!source.ok)throw new Error('原选题与小组数据暂时不可用');
      const data=await source.json();legacy=data.state?.projects||[];groups=data.groups||[];
      send(res,{projects:rows,legacy,groups});return true;
    }
    if(path.pathname==='/api/fg/projects'&&req.method==='POST'){
      const body=await jsonBody(req);const topic=topics.find(t=>t.id===body.topicId);
      if(!topic||topic.blocked)throw new Error('选题不存在或暂不适合立项');
      if(!['S','A','B','C'].includes(body.tier)||!Number.isFinite(body.budgetCny)||body.budgetCny<0||body.budgetCny>10000000)throw new Error('请选择档位并填写有效预算');
      const group=String(body.groupName||'');
      const source=await fetch(new URL('/api/production-lab',platform),{headers:{cookie:platformCookie},signal:AbortSignal.timeout(15000)});
      if(!source.ok)throw new Error('小组数据暂时不可用');
      const sourceData=await source.json();
      if(group&&!sourceData.groups?.some(g=>g.name===group))throw new Error('请选择当前有效的小组');
      const client=await pool.connect();
      try{
        await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[actor.id+':'+topic.id]);
        let link=(await client.query('SELECT * FROM fg_story_projects WHERE user_id=$1 AND topic_id=$2',[actor.id,topic.id])).rows[0];
        if(link?.native_project_id){send(res,{projectId:link.native_project_id,reused:true});await client.query('COMMIT');return true;}
        const hex=createHash('sha256').update(actor.id+':fg-topic:'+topic.id).digest('hex');
        const marker=link?.id||`${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
        const description=`[FG-STORY:${marker}]\n选题 #${topic.id} ${topic.title}\n原型：${topic.original||'待补充'}\n核心冲突：${topic.conflict||topic.plot}\n风格：${topic.style}\n目标市场：${topic.markets}\n选题人：${topic.selected_by||'未指定'} / 原选择小组：${topic.selection_group||'未指定'}\n项目档位：${body.tier} / 制作小组：${group||'待分组'}\n版权状态：${topic.source_rights||'待核验'}`;
        const recovered=(await client.query('SELECT id FROM projects WHERE user_id=$1 AND description LIKE $2',[actor.id,`[FG-STORY:${marker}]%`])).rows[0];
        const project=recovered|| (await api('/projects','POST',{name:topic.title,type:'short-drama',aspectRatio:'9:16',sourceType:'text',description})).project;
        await client.query(`INSERT INTO fg_story_projects(id,user_id,topic_id,native_project_id,topic_snapshot,tier,group_name,budget_cny)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(user_id,topic_id) DO UPDATE SET native_project_id=excluded.native_project_id`,[marker,actor.id,topic.id,project.id,JSON.stringify(topic),body.tier,group,body.budgetCny]);
        await client.query('COMMIT');send(res,{projectId:project.id,reused:false});return true;
      }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
    }
    if(path.pathname==='/api/fg/finance'&&req.method==='GET'){
      // Every provider attempt stays separate. Polls/downloads are not a second charge.
      const {rows}=await pool.query(`WITH calls AS (
        SELECT l.id,l.user_id,l.task_id,l.model,l.capability,l.status,t.status task_status,l.created_at,l.input_tokens,l.output_tokens,l.cached_tokens,l.usage_available,l.media_count,l.request_body,l.response_body,l.video_seconds,
          l.fg_fee_reference_id,l.fg_fee_references_json,l.provider_request_id,l.cost_available,l.estimated_cost_micros,l.currency,
          COALESCE(NULLIF(c.project_id,''),p.id) project_id,c.title canvas_title
        FROM api_call_logs l LEFT JOIN tasks t ON t.id=l.task_id
        LEFT JOIN canvas_projects c ON c.id=t.project_id
        LEFT JOIN projects p ON p.id=t.project_id
        WHERE l.billable=true AND l.channel_id IN(SELECT id FROM model_channels WHERE name LIKE 'WeToken%')
      ), fee_candidates AS (
        SELECT f.reference_id,min(c.id) call_id FROM fg_provider_fees f JOIN calls c ON c.model=f.model AND
          (c.fg_fee_reference_id=f.reference_id OR c.fg_fee_references_json::jsonb ? f.reference_id OR(c.capability='video' AND c.provider_request_id=f.reference_id)) GROUP BY f.reference_id HAVING count(*)=1
      ), matched AS (
        SELECT reference_id,call_id FROM fee_candidates WHERE call_id IN(SELECT call_id FROM fee_candidates GROUP BY call_id HAVING count(*)=1)
      ) SELECT c.*,p.name project_name,u.display_name user_name,s.group_name,s.tier,s.budget_cny,
        f.usd settled_usd,f.fx settled_fx,(f.usd*f.fx) settled_cny, f.reference_id settled_reference_id
        FROM calls c JOIN users u ON u.id=c.user_id LEFT JOIN projects p ON p.id=c.project_id
        LEFT JOIN fg_story_projects s ON s.native_project_id=c.project_id
        LEFT JOIN matched m ON m.call_id=c.id LEFT JOIN fg_provider_fees f ON f.reference_id=m.reference_id
        ORDER BY c.created_at DESC`);
      const settings=(await pool.query("SELECT value FROM fg_company_settings WHERE key='usdCnyRate'")).rows[0];
      const imports=(await pool.query('SELECT id,row_count,created_at FROM fg_fee_imports ORDER BY created_at DESC LIMIT 1')).rows;
      const matchedReferences=rows.filter(c=>c.settled_reference_id).map(c=>c.settled_reference_id);
      const unallocated=(await pool.query(`SELECT reference_id,model,usd,fx,occurred_at FROM fg_provider_fees WHERE NOT(reference_id=ANY($1::text[])) ORDER BY occurred_at DESC`,[matchedReferences])).rows;
      const prices=(await pool.query('SELECT model,snapshot,collected_at FROM fg_model_prices ORDER BY model')).rows;
      const byModel=new Map(prices.map(p=>[p.model,p.snapshot]));
      const fx=Number(settings.value);
      for(const call of rows){call.rate_estimated_cny=estimateCNY(call,byModel.get(call.model),fx);delete call.request_body;delete call.response_body;delete call.settled_usd;}
      const billingSync=(await pool.query("SELECT value FROM fg_company_settings WHERE key='wetokenFeeSync'")).rows[0]?.value||{mode:'csv',automatic:false,reason:'未配置授权账单会话；可导入官方 CSV。'};
      send(res,{calls:rows,fx,lastImport:imports[0]||null,unallocated:unallocated.map(({usd,fx,...row})=>({...row,cny:Number(usd)*Number(fx)})),collectedAt:new Date().toISOString(),billingSync});return true;
    }
    if(path.pathname==='/api/fg/finance/import'&&req.method==='POST'){
      const body=await jsonBody(req,5_500_000);send(res,await importFeeCsv(pool,actor.id,body.csv));return true;
    }
    if(path.pathname==='/api/fg/finance/fx'&&req.method==='PUT'){
      const {fx}=await jsonBody(req);if(!Number.isFinite(fx)||fx<=0||fx>100)throw new Error('人民币折算汇率必须为 0–100 的正数');
      await pool.query("UPDATE fg_company_settings SET value=$1,updated_at=now() WHERE key='usdCnyRate'",[JSON.stringify(fx)]);send(res,{fx});return true;
    }
    send(res,'FG 接口不存在',404);return true;
  }catch(error){const message=String(error.message);send(res,/^(费用单|请|同一|已核销|原选题|小组|选题|人民币|请求内容)/.test(message)?message:'FG 数据操作失败，请稍后刷新重试',400);return true;}
}
