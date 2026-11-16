import {financePeriod} from './fg-finance-period.mjs';

// Both the administrator and personal views settle from the same receipt links.
// Failed requests are not considered free until a receipt or decision says so.
function settlementCTE(ownOnly=false){return `settled AS MATERIALIZED (
 SELECT m.call_id,sum(f.usd*f.fx) settled_cny,string_agg(f.reference_id,', ') settled_reference_id,
 string_agg(CASE WHEN f.provider_status='failed' AND f.usd=0 THEN 'automatic_provider_zero' ELSE m.method END,', ') match_method
 FROM fg_fee_matches m JOIN fg_provider_fees f ON f.reference_id=m.reference_id
 ${ownOnly?'JOIN api_call_logs own ON own.id=m.call_id WHERE own.user_id=$1':''}
 GROUP BY m.call_id
)`;}
export const settledFeeCTE=settlementCTE();

const ownCallsCTE = `WITH ${settlementCTE(true)}, own_calls AS MATERIALIZED (
 SELECT l.id,l.created_at,l.model,l.capability,l.status,t.status task_status,
 COALESCE(p.name,c.title,'未归属项目') project_name,
 COALESCE(NULLIF(ch.name,''),'未知渠道') channel_name,
 COALESCE(f.settled_cny,CASE WHEN rd.call_id IS NOT NULL THEN 0 END) settled_cny,
 f.settled_reference_id,COALESCE(f.match_method,CASE WHEN rd.call_id IS NOT NULL THEN 'confirmed_no_charge' END) match_method
 FROM api_call_logs l LEFT JOIN tasks t ON t.id=l.task_id
 LEFT JOIN canvas_projects c ON c.id=t.project_id
 LEFT JOIN projects p ON p.id=COALESCE(NULLIF(c.project_id,''),t.project_id)
 LEFT JOIN model_channels ch ON ch.id=l.channel_id
 LEFT JOIN settled f ON f.call_id=l.id LEFT JOIN fg_request_decisions rd ON rd.call_id=l.id
 WHERE l.user_id=$1 AND l.billable=true
)`;

function integer(value,fallback,max){
 if(value===null)return fallback;
 if(!/^[1-9]\d*$/.test(value)||Number(value)>max)throw Error('分页参数无效');
 return Number(value);
}

export async function personalFinanceRoute(req,res,{actor,pool,path},{send}){
 if(path.pathname!=='/api/fg/finance/mine')return false;
 if(!actor?.id){send(res,'请先登录',401);return true;}
 if(req.method!=='GET'){send(res,'仅支持查看个人费用',405);return true;}
 let validated=false;
 try{
  const month=path.searchParams.get('month')||new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'}).format(new Date());
  const period=financePeriod(month);
  const current=financePeriod(new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'}).format(new Date()));
  const page=integer(path.searchParams.get('page'),1,100000),pageSize=integer(path.searchParams.get('pageSize'),20,100);
  const model=path.searchParams.get('model')||'';if(model.length>160)throw Error('模型筛选无效');
  validated=true;
  // Never accept userId, owner, reviewer or client scope flags as authority.
  const summary=(await pool.query(`${ownCallsCTE} SELECT
   COALESCE(sum(settled_cny),0) total_cny,count(*)::int total_requests,
   count(*) FILTER(WHERE settled_cny IS NULL)::int pending_requests,
   COALESCE(sum(settled_cny) FILTER(WHERE created_at >= $2 AND created_at < $3),0) month_cny,
   count(*) FILTER(WHERE created_at >= $2 AND created_at < $3 AND settled_cny IS NULL)::int month_pending
   FROM own_calls`,[actor.id,current.since,current.until])).rows[0];
  const selected=`($2::timestamptz IS NULL OR created_at >= $2) AND ($3::timestamptz IS NULL OR created_at < $3)`;
  const args=[actor.id,period.since,period.until];
  const models=(await pool.query(`${ownCallsCTE} SELECT model,count(*)::int requests,
   count(*) FILTER(WHERE settled_cny IS NULL)::int pending,COALESCE(sum(settled_cny),0) settled_cny
   FROM own_calls WHERE ${selected} GROUP BY model ORDER BY sum(settled_cny) DESC NULLS LAST,model`,args)).rows;
  const count=(await pool.query(`${ownCallsCTE} SELECT count(*)::int total FROM own_calls WHERE ${selected} AND ($4='' OR model=$4)`,[...args,model])).rows[0]?.total||0;
  const records=(await pool.query(`${ownCallsCTE} SELECT id,created_at,model,capability,status,task_status,project_name,channel_name,settled_cny,settled_reference_id,match_method
   FROM own_calls WHERE ${selected} AND ($4='' OR model=$4) ORDER BY created_at DESC,id DESC LIMIT $5 OFFSET $6`,[...args,model,pageSize,(page-1)*pageSize])).rows;
  send(res,{summary,currentMonth:current.month,period,models,records,page,pageSize,total:Number(count),collectedAt:new Date().toISOString()});
 }catch{send(res,validated?'个人费用服务暂不可用，请稍后重试':'请检查月份和分页参数',validated?503:400);}
 return true;
}
