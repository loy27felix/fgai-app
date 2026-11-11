import {randomUUID} from 'node:crypto';

// The caller owns the transaction and fee-import lock; one invalid row aborts the batch.
export function validateMatchPairs(pairs, note) {
 if(!Array.isArray(pairs)||pairs.length===0||pairs.length>100)throw Error('每批请选择 1–100 条待核对请求');
 if(typeof note!=='string'||note.trim().length<8||note.length>2000)throw Error('请填写至少 8 字的核对依据');
 const calls=new Set(),refs=new Set();
 for(const pair of pairs){
  if(!pair||typeof pair.callId!=='string'||!pair.callId.trim()||typeof pair.referenceId!=='string'||!pair.referenceId.trim())throw Error('每条请求须选择一条经核实的账单流水');
  if(calls.has(pair.callId)||refs.has(pair.referenceId))throw Error('请求和账单流水不能重复关联');
  calls.add(pair.callId);refs.add(pair.referenceId);
 }
 return pairs;
}

export async function matchReceiptPairs(client, actorId, pairs, note) {
 validateMatchPairs(pairs,note);
 for(const {callId,referenceId} of [...pairs].sort((a,b)=>a.referenceId.localeCompare(b.referenceId))){
  const fee=(await client.query('SELECT * FROM fg_provider_fees WHERE reference_id=$1 FOR UPDATE',[referenceId])).rows[0];
  if(!fee)throw Error('账单流水不存在，请刷新后重试');
  const call=(await client.query("SELECT * FROM api_call_logs WHERE id=$1 AND billable AND channel_id IN(SELECT id FROM model_channels WHERE name LIKE 'WeToken%') FOR UPDATE",[callId])).rows[0];
  if(!call||call.model!==fee.model)throw Error('费用单模型与请求不一致');
  const matched=(await client.query('SELECT reference_id,call_id,method FROM fg_fee_matches WHERE reference_id=$1 OR call_id=$2',[referenceId,callId])).rows;
  if(matched.some(x=>x.call_id!==callId||x.reference_id!==referenceId))throw Error('请求或账单已关联其他记录，请刷新后核对');
  const before=(await client.query('SELECT * FROM fg_fee_decisions WHERE reference_id=$1',[referenceId])).rows[0]||null;
  if(matched.length&&!before)throw Error('该账单已自动核销，无需人工关联');
  if(before&&before.classification!=='matched')throw Error('该账单已归类，请先撤回原处理');
  if(before?.classification==='matched'&&before.call_id===callId)continue;
  await client.query("SELECT pg_advisory_xact_lock(hashtext('fg-budget-user:'||$1))",[call.user_id]);
  await client.query("INSERT INTO fg_fee_decisions(reference_id,call_id,classification,note,actor_id) VALUES($1,$2,'matched',$3,$4) ON CONFLICT(reference_id) DO UPDATE SET call_id=excluded.call_id,classification=excluded.classification,note=excluded.note,actor_id=excluded.actor_id,updated_at=now()",[referenceId,callId,note.trim(),actorId]);
  await client.query('INSERT INTO fg_finance_audit(id,actor_id,action,target,before_value,after_value) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),actorId,'receipt_matched',referenceId,before,{classification:'matched',callId,note:note.trim(),batchSize:pairs.length}]);
 }
 return {saved:true,count:pairs.length};
}
