// Admission rejection and failures before HTTP submission prove no generation charge.
// Timeouts, HTTP 5xx, missing bills and failed asynchronous tasks are excluded.
function parameterRejection(response,call){
 if(call.capability!=='video'||call.method!=='POST'||call.path!=='/api/v3/contents/generations/tasks')return null;
 // Some channels wrap the provider JSON in error.message. Inspect each envelope
 // for an accepted task before unwrapping; a generic HTTP 400 is not proof.
 for(let depth=0;depth<3;depth++){
  if(!response||typeof response!=='object'||Array.isArray(response))return null;
  if(response.id||response.task?.id||response.output?.task_id||response.data?.id||response.data?.task_id)return null;
  const error=response.error;
  if(error?.code==='InvalidParameter'&&error.param==='content'&&error.type==='BadRequest'&&
   /first\/last frame content cannot be mixed with reference media content\./.test(String(error.message||'')))
   return {providerErrorCode:error.code,parameter:error.param};
  if(error?.code!=='upstream_error'||typeof error.message!=='string')return null;
  try{response=JSON.parse(error.message);}catch{return null;}
 }
 return null;
}
export function rejectionEvidence(call){
 let refs;try{refs=JSON.parse(call.fg_fee_references_json||'[]');}catch{return null;}
 if(!Array.isArray(refs)||call.status!=='failed'||call.provider_request_id||call.media_count>0||call.input_tokens>0||call.output_tokens>0)return null;
 const status=Number(call.status_code);
 if(status===0&&!call.response_body&&!call.fg_fee_reference_id&&refs.length===0){
  if(call.error==='当前渠道连续失败，已暂时熔断，请稍后重试'&&Number(call.duration_ms)===0)
   return {source:'local_channel_circuit_open',statusCode:0,errorCode:call.error_code||''};
  if(/(?:^|:\s*)net\/http: TLS handshake timeout$/.test(String(call.error||'')))
   return {source:'tls_handshake_failed',statusCode:0,errorCode:call.error_code||''};
 }
 if(![400,401,403,413].includes(status))return null;
 let response={};try{response=JSON.parse(call.response_body||'{}');}catch{response={};}
 if(status===400){
  const parameter=parameterRejection(response,call);if(!parameter)return null;
  return {source:'generation_admission_rejected',statusCode:400,errorCode:call.error_code||'',providerReference:call.fg_fee_reference_id||null,...parameter};
 }
 if(response.id||response.task?.id||response.output?.task_id||response.data?.id||response.data?.task_id)return null;
 if(status===403&&!/quota|insufficient|permission|forbidden|auth/i.test(String(call.error_code)+' '+String(call.error)))return null;
 return {source:'generation_admission_rejected',statusCode:status,errorCode:call.error_code||'',providerReference:call.fg_fee_reference_id||null};
}
export async function reconcileRejectedRequests(pool,actorId){
 const client=await pool.connect();const applied=[];
 try{
  await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('fg-fee-import'))");
  if(!(await client.query("SELECT id FROM users WHERE id=$1 AND role='admin' AND status='active'",[actorId])).rows.length)throw Error('UNAUTHORIZED_RECONCILIATION');
  const calls=(await client.query("WITH matched AS MATERIALIZED (SELECT call_id FROM fg_fee_matches) SELECT c.* FROM api_call_logs c JOIN model_channels m ON m.id=c.channel_id LEFT JOIN matched f ON f.call_id=c.id LEFT JOIN fg_request_decisions d ON d.call_id=c.id WHERE c.billable AND c.status='failed' AND c.status_code IN(0,400,401,403,413) AND m.name LIKE 'WeToken%' AND f.call_id IS NULL AND d.call_id IS NULL")).rows;
  for(const call of calls){
   const evidence=rejectionEvidence(call);if(!evidence)continue;
   const reason=evidence.source==='local_channel_circuit_open'?'本地渠道熔断，未发出 HTTP 请求':evidence.source==='tls_handshake_failed'?'TLS 握手未完成，未发送 HTTP 请求体':`供应商在生成受理前拒绝请求（HTTP ${evidence.statusCode}）`;
   const note=`自动核对：${reason}，无生成任务与用量；后续若有真实账单，实际账单优先计费。`;
   const inserted=await client.query("INSERT INTO fg_request_decisions(call_id,note,actor_id,source,evidence) VALUES($1,$2,$3,'admission_rejected',$4::jsonb) ON CONFLICT DO NOTHING RETURNING call_id",[call.id,note,actorId,JSON.stringify(evidence)]);
   if(!inserted.rows.length)continue;
   await client.query("INSERT INTO fg_finance_audit(id,actor_id,action,target,after_value) VALUES(gen_random_uuid(),$1,'automatic_no_charge',$2,$3::jsonb)",[actorId,call.id,JSON.stringify(evidence)]);applied.push(call.id);
  }
  await client.query('COMMIT');return applied;
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
