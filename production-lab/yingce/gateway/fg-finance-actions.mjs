import {randomUUID} from 'node:crypto';
import {spendUsage,monthStart} from './fg-budgets.mjs';
async function body(req){let chunks=[],n=0;for await(const c of req){n+=c.length;if(n>100000)throw Error('请求内容过大');chunks.push(c);}return JSON.parse(Buffer.concat(chunks));}
function send(res,data,status=200){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify({code:status===200?0:status,data:status===200?data:null,msg:status===200?'':String(data)}));}
export async function financeActions(req,res,{pool,actor,path}){
 const route=path.pathname;
 if(!['/api/fg/budgets/users','/api/fg/budgets/project','/api/fg/finance/decisions','/api/fg/finance/request-decisions','/api/fg/finance/audit'].includes(route))return false;
 try{
  if(route==='/api/fg/budgets/users'&&req.method==='GET'){
   const users=(await pool.query(`SELECT u.id,u.display_name name,a.email,COALESCE(b.monthly_cny,0) monthly_cny FROM users u LEFT JOIN fg_accounts a ON a.user_id=u.id LEFT JOIN fg_user_budgets b ON b.user_id=u.id WHERE u.status='active' AND($2 OR u.id=$1) ORDER BY u.display_name`,[actor.id,actor.reviewer])).rows;
   for(const u of users)Object.assign(u,await spendUsage(pool,{userId:u.id,since:monthStart()}));
   send(res,{users,month:monthStart().slice(0,7),canManage:actor.reviewer});return true;
  }
  if(!actor.reviewer){send(res,'仅超级管理员可调整费用额度或处理账单',403);return true;}
  if(route==='/api/fg/finance/audit'&&req.method==='GET'){
   send(res,{audit:(await pool.query('SELECT a.*,u.display_name actor_name FROM fg_finance_audit a JOIN users u ON u.id=a.actor_id ORDER BY created_at DESC LIMIT 200')).rows});return true;
  }
  const input=await body(req);const client=await pool.connect();
  try{
   await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('fg-fee-import'))");
   if(route==='/api/fg/budgets/users'&&req.method==='PATCH'){
    const limit=Number(input.monthlyCny||0);if(!Number.isFinite(limit)||limit<0||limit>1e7)throw Error('请填写有效月限额');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('fg-budget-user:'||$1))",[input.userId]);
    const before=(await client.query('SELECT * FROM fg_user_budgets WHERE user_id=$1',[input.userId])).rows[0]||null;
    await client.query('INSERT INTO fg_user_budgets(user_id,monthly_cny,updated_by) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET monthly_cny=$2,updated_by=$3,updated_at=now()',[input.userId,limit,actor.id]);
    await client.query('INSERT INTO fg_finance_audit(id,actor_id,action,target,before_value,after_value) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),actor.id,'monthly_budget',input.userId,before,{monthlyCny:limit}]);
   }else if(route==='/api/fg/budgets/project'&&req.method==='PATCH'){
    const limit=Number(input.budgetCny||0);if(!Number.isFinite(limit)||limit<0||limit>1e7)throw Error('请填写有效项目预算');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('fg-budget-project:'||$1))",[input.projectId]);
    const before=(await client.query('SELECT budget_cny FROM fg_story_projects WHERE native_project_id=$1',[input.projectId])).rows[0];if(!before)throw Error('请选择故事项目');
    await client.query('UPDATE fg_story_projects SET budget_cny=$2 WHERE native_project_id=$1',[input.projectId,limit]);
    await client.query('INSERT INTO fg_finance_audit(id,actor_id,action,target,before_value,after_value) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),actor.id,'project_budget',input.projectId,before,{budgetCny:limit}]);
   }else if(route==='/api/fg/finance/request-decisions'&&req.method==='POST'){
    const note=String(input.note||'').trim();if(!['no_charge','reset'].includes(input.classification)||note.length<8||note.length>2000)throw Error('请填写至少 8 字的费用核查依据');
    const call=(await client.query("SELECT id,user_id FROM api_call_logs WHERE id=$1 AND billable AND channel_id IN(SELECT id FROM model_channels WHERE name LIKE 'WeToken%') FOR UPDATE",[input.callId])).rows[0];if(!call)throw Error('请选择有效制作请求');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('fg-budget-user:'||$1))",[call.user_id]);
    const before=(await client.query('SELECT * FROM fg_request_decisions WHERE call_id=$1',[call.id])).rows[0]||null;
    if(input.classification==='reset')await client.query('DELETE FROM fg_request_decisions WHERE call_id=$1',[call.id]);
    else{
     if((await client.query('SELECT 1 FROM fg_fee_matches WHERE call_id=$1',[call.id])).rowCount)throw Error('请求已有实际账单，请核对账单归属，不能改成未收费');
     await client.query('INSERT INTO fg_request_decisions(call_id,note,actor_id) VALUES($1,$2,$3) ON CONFLICT(call_id) DO UPDATE SET note=$2,actor_id=$3,updated_at=now()',[call.id,note,actor.id]);
    }
    await client.query('INSERT INTO fg_finance_audit(id,actor_id,action,target,before_value,after_value) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),actor.id,'request_'+input.classification,call.id,before,{classification:input.classification,note}]);
   }else if(route==='/api/fg/finance/decisions'&&req.method==='POST'){
    const refs=input.referenceIds,kind=input.classification,note=String(input.note||'').trim();
    if(!Array.isArray(refs)||!refs.length||refs.length>500||!['matched','external','ignored','reset'].includes(kind)||note.length<8||note.length>2000)throw Error('请填写至少 8 字的处理依据，并选择有效流水');
    if(kind==='matched'&&refs.length!==1)throw Error('请逐笔核对流水');
    for(const ref of refs){
     const fee=(await client.query('SELECT * FROM fg_provider_fees WHERE reference_id=$1 FOR UPDATE',[ref])).rows[0];if(!fee)throw Error('费用单流水不存在');
     const current=(await client.query('SELECT call_id FROM fg_fee_matches WHERE reference_id=$1',[ref])).rows[0];
     const before=(await client.query('SELECT * FROM fg_fee_decisions WHERE reference_id=$1',[ref])).rows[0]||null;
     if(kind!=='reset'&&current&&!before)throw Error('已自动核销的流水不可重新归属');
     if(kind==='matched'){
      const call=(await client.query("SELECT * FROM api_call_logs WHERE id=$1 AND billable AND channel_id IN(SELECT id FROM model_channels WHERE name LIKE 'WeToken%')",[input.callId])).rows[0];
      if(!call||call.model!==fee.model)throw Error('费用单模型与请求不一致');
      if((await client.query('SELECT 1 FROM fg_fee_matches WHERE call_id=$1 AND reference_id<>$2',[call.id,ref])).rowCount)throw Error('该请求已核销其他流水，请先撤回人工处理');
     }
     if(kind==='reset')await client.query('DELETE FROM fg_fee_decisions WHERE reference_id=$1',[ref]);
     else await client.query('INSERT INTO fg_fee_decisions(reference_id,call_id,classification,note,actor_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(reference_id) DO UPDATE SET call_id=excluded.call_id,classification=excluded.classification,note=excluded.note,actor_id=excluded.actor_id,updated_at=now()',[ref,kind==='matched'?input.callId:null,kind,note,actor.id]);
     await client.query('INSERT INTO fg_finance_audit(id,actor_id,action,target,before_value,after_value) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),actor.id,'receipt_'+kind,ref,before,{classification:kind,callId:input.callId||null,note}]);
    }
   }else throw Error('请求方式不支持');
   await client.query('COMMIT');send(res,{saved:true});
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }catch(e){send(res,e.code?'账单处理失败，请检查记录是否已变化':e.message,400);}return true;
}
