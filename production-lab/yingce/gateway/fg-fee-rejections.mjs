// Only explicit admission rejection is evidence of no generation charge.
// Timeouts, HTTP 5xx, missing bills and failed asynchronous tasks are excluded.
export function rejectionEvidence(call){
 let refs;try{refs=JSON.parse(call.fg_fee_references_json||'[]');}catch{return null;}
 if(!Array.isArray(refs)||call.status!=='failed'||call.provider_request_id||call.media_count>0||call.input_tokens>0||call.output_tokens>0)return null;
 const status=Number(call.status_code);
 if(![401,403,413].includes(status))return null;
 let response={};try{response=JSON.parse(call.response_body||'{}');}catch{response={};}
 if(response.id||response.task?.id||response.output?.task_id||response.data?.id||response.data?.task_id)return null;
 if(status===403&&!/quota|insufficient|permission|forbidden|auth/i.test(String(call.error_code)+' '+String(call.error)))return null;
 return {source:'generation_admission_rejected',statusCode:status,errorCode:call.error_code||'',providerReference:call.fg_fee_reference_id||null};
}
export async function reconcileRejectedRequests(pool,actorId){
 const client=await pool.connect();const applied=[];
 try{
  await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('fg-fee-import'))");
  if(!(await client.query("SELECT id FROM users WHERE id=$1 AND role='admin' AND status='active'",[actorId])).rows.length)throw Error('UNAUTHORIZED_RECONCILIATION');
  const calls=(await client.query("SELECT c.* FROM api_call_logs c JOIN model_channels m ON m.id=c.channel_id WHERE c.billable AND c.status='failed' AND c.status_code IN(401,403,413) AND m.name LIKE 'WeToken%' AND NOT EXISTS(SELECT 1 FROM fg_fee_matches f WHERE f.call_id=c.id) AND NOT EXISTS(SELECT 1 FROM fg_request_decisions d WHERE d.call_id=c.id)")).rows;
  for(const call of calls){
   const evidence=rejectionEvidence(call);if(!evidence)continue;
   const note=`自动核对：供应商在生成受理前拒绝请求（HTTP ${evidence.statusCode}），无生成任务与用量；后续若有真实账单，实际账单优先计费。`;
   const inserted=await client.query("INSERT INTO fg_request_decisions(call_id,note,actor_id,source,evidence) VALUES($1,$2,$3,'admission_rejected',$4::jsonb) ON CONFLICT DO NOTHING RETURNING call_id",[call.id,note,actorId,JSON.stringify(evidence)]);
   if(!inserted.rows.length)continue;
   await client.query("INSERT INTO fg_finance_audit(id,actor_id,action,target,after_value) VALUES(gen_random_uuid(),$1,'automatic_no_charge',$2,$3::jsonb)",[actorId,call.id,JSON.stringify(evidence)]);applied.push(call.id);
  }
  await client.query('COMMIT');return applied;
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
