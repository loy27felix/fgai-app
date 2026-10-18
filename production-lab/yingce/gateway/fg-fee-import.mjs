import {createHash,randomUUID} from 'node:crypto';
import {parseFeeCsv} from './fg-finance.mjs';

// Shared by the authenticated API and the explicitly invoked operator CLI.
// This is the same transaction, not a second route around billing validation.
export async function importFeeCsv(pool,actorId,csv){
 const entries=parseFeeCsv(csv),hash=createHash('sha256').update(csv).digest('hex');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const actor=(await client.query("SELECT id FROM users WHERE id=$1 AND role='admin' AND status='active'",[actorId])).rows[0];
  if(!actor)throw new Error('费用单导入仅限已认证管理员');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('fg-fee-import'))");
  const old=(await client.query('SELECT id FROM fg_fee_imports WHERE sha256=$1',[hash])).rows[0];
  if(old){await client.query('COMMIT');return {reused:true,rows:0};}
  const fx=Number((await client.query("SELECT value FROM fg_company_settings WHERE key='usdCnyRate'")).rows[0].value),id=randomUUID();
  if(!Number.isFinite(fx)||fx<=0||fx>100)throw new Error('人民币折算汇率无效，费用单未导入');
  await client.query('INSERT INTO fg_fee_imports(id,actor_id,sha256,row_count) VALUES($1,$2,$3,$4)',[id,actorId,hash,entries.length]);
  for(const fee of entries){
   const prior=(await client.query('SELECT model,usd,occurred_at,provider_status FROM fg_provider_fees WHERE reference_id=$1',[fee.referenceId])).rows[0];
   if(prior&&prior.model===fee.model&&Number(prior.usd)===0&&prior.provider_status==='failed'&&!fee.providerStatus&&fee.usd>0){
    await client.query("UPDATE fg_provider_fees SET usd=$2,fx=$3,occurred_at=$4,import_id=$5,provider_status='success' WHERE reference_id=$1",[fee.referenceId,fee.usd,fx,fee.occurredAt,id]);
    await client.query("INSERT INTO fg_finance_audit(id,actor_id,action,target,before_value,after_value) VALUES(gen_random_uuid(),$1,'provider_fee_finalized',$2,$3::jsonb,$4::jsonb)",[actorId,fee.referenceId,JSON.stringify(prior),JSON.stringify(fee)]);
    continue;
   }
   if(prior&&(prior.model!==fee.model||Number(prior.usd)!==fee.usd||new Date(prior.occurred_at).toISOString()!==fee.occurredAt))throw new Error('已核销流水与本次费用单冲突，请先检查原始账单');
   await client.query('INSERT INTO fg_provider_fees(reference_id,model,usd,fx,occurred_at,import_id,provider_status) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',[fee.referenceId,fee.model,fee.usd,fx,fee.occurredAt,id,fee.providerStatus||'success']);
  }
  await client.query('COMMIT');return {reused:false,rows:entries.length};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
