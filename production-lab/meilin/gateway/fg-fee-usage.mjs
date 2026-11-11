import {feeAuthHeaders,feeResponseError} from './fg-fee-auth.mjs';
// Reconcile only a reciprocal unique receipt with identical provider usage.
// Completion time is a boundary check, never a substitute for token evidence.
export function receiptUsage(call){
 let body;try{body=JSON.parse(call.response_body);}catch{return null;}
 const u=body?.usage||body?.message?.usage;
 if(!u)return null;
 // WeToken's OpenAI envelope can contain placeholder input_tokens:0 beside
 // real prompt_tokens. Claude also reports its cache in OpenAI-shaped fields.
 const nativeAnthropic=body.type==='message'||u.cache_read_input_tokens!==undefined||u.cache_creation_input_tokens!==undefined;
 const semantic=u.billing_usage?.semantic||(nativeAnthropic||(/^claude-/.test(call.model)&&u.claude_cache_creation_1_h_tokens!==undefined)?'anthropic':'openai');
 const input=nativeAnthropic?u.input_tokens:(u.prompt_tokens||u.input_tokens),output=nativeAnthropic?u.output_tokens:(u.completion_tokens||u.output_tokens);
 const cached=nativeAnthropic?(u.cache_read_input_tokens??0):(u.prompt_tokens_details?.cached_tokens??u.input_tokens_details?.cached_tokens??0);
 const creation=nativeAnthropic?(u.cache_creation_input_tokens??0):((u.claude_cache_creation_1_h_tokens??0)+(u.claude_cache_creation_5_m_tokens??0));
 if(![input,output,cached,creation].every(n=>Number.isSafeInteger(n)&&n>=0)||input+output===0)return null;
 return {input,output,cached,creation,semantic};
}

export function usageMatches(calls,receipts){
 const candidates=[];
 for(const call of calls){
  const u=receiptUsage(call),completed=Date.parse(call.created_at)/1000;
  if(!u||!call.billable||call.capability!=='text'||!Number.isFinite(completed))continue;
  for(const r of receipts){
   if(r.model!==call.model||r.semantic!==u.semantic||r.input!==u.input||r.output!==u.output||r.cached!==u.cached||r.creation!==u.creation)continue;
   // Gateway buffering can delay its completed log by several seconds.
   if(Math.abs(completed-r.completed)>10)continue;
   candidates.push({callId:call.id,referenceId:r.referenceId,usage:u,completed:r.completed,receiptId:r.receiptId});
  }
 }
 const counts=(key)=>candidates.reduce((m,v)=>m.set(v[key],(m.get(v[key])||0)+1),new Map());
 const a=counts('callId'),b=counts('referenceId');
 return candidates.filter(c=>a.get(c.callId)===1&&b.get(c.referenceId)===1);
}

export function normalizeUsageReceipt(row){
 let o;try{o=typeof row.other==='string'?JSON.parse(row.other):row.other;}catch{return null;}
 const semantic=o?.usage_semantic||(/^gpt-(?!image)/.test(row.model_name||'')&&Number.isSafeInteger(o?.cache_tokens)?'openai':null);
 if(row.type!==2||o?.fee_log!==true||o.status!=='success'||!['anthropic','openai'].includes(semantic))return null;
 const r={receiptId:String(row.id),referenceId:o.reference_id,model:row.model_name,completed:row.created_at,input:row.prompt_tokens,output:row.completion_tokens,cached:o.cache_tokens??0,creation:o.cache_creation_tokens??0,semantic,usd:Math.abs(Number(o.actual_amount))};
 if(!r.referenceId||r.referenceId!==row.request_id||!r.model||!Number.isFinite(r.usd)||![r.completed,r.input,r.output,r.cached,r.creation].every(n=>Number.isSafeInteger(n)&&n>=0))return null;
 return r;
}

export async function readUsageLog(session,{fetcher=fetch,start,end}={}){
 const headers=feeAuthHeaders(session);
 const items=[],seen=new Set();let total;
 for(let page=1;page<=200;page++){
  const url=new URL('https://wetoken.ai/api/log/self');
  for(const[k,v]of Object.entries({p:page,page_size:100,start_timestamp:start,end_timestamp:end}))url.searchParams.set(k,String(v));
  const r=await fetcher(url,{redirect:'error',headers,signal:AbortSignal.timeout(15000)});
  if(r.status===401||r.status===403)throw Error('SESSION_EXPIRED');
  if(!r.ok)throw Error('USAGE_LOG_UNAVAILABLE');
  const b=await r.json(),error=feeResponseError(r,b);if(error)throw Error(error);
  if(!Array.isArray(b.data?.items)||!Number.isInteger(b.data.total))throw Error('INVALID_USAGE_LOG');
  if(total!==undefined&&total!==b.data.total)throw Error('LEDGER_CHANGED');total=b.data.total;
  for(const v of b.data.items){const key=JSON.stringify([v.created_at,v.id,v.request_id]);if(seen.has(key))throw Error('DUPLICATE_USAGE_PAGE');seen.add(key);items.push(v);}
  if(items.length===total)return items.map(normalizeUsageReceipt).filter(Boolean);
  if(items.length>total||!b.data.items.length)throw Error('INCOMPLETE_USAGE_LOG');
 }
 throw Error('USAGE_PAGE_LIMIT');
}

export async function reconcileUsage(pool,actorId,receipts,{dryRun=false}={}){
 if(!receipts.length)return [];
 const client=await pool.connect();try{
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('fg-fee-import'))");
  if(!(await client.query("SELECT id FROM users WHERE id=$1 AND role='admin' AND status='active'",[actorId])).rows.length)throw Error('UNAUTHORIZED_RECONCILIATION');
  // Include already matched calls in the candidate set: they must not allow a
  // second call to claim their receipt. Manual decisions always take precedence.
  const calls=(await client.query("SELECT c.id,c.model,c.created_at,c.response_body,c.billable,c.capability FROM api_call_logs c JOIN model_channels m ON m.id=c.channel_id WHERE c.billable AND c.capability='text' AND m.name LIKE 'WeToken%' AND c.created_at >= $1 AND c.created_at <= $2",[new Date((Math.min(...receipts.map(r=>r.completed))-11)*1000),new Date((Math.max(...receipts.map(r=>r.completed))+11)*1000)])).rows;
  const proposed=usageMatches(calls,receipts),applied=[];
  for(const match of proposed){
   const receipt=receipts.find(r=>r.referenceId===match.referenceId);
   const fee=(await client.query('SELECT model,usd FROM fg_provider_fees WHERE reference_id=$1',[match.referenceId])).rows[0];
   if(!fee||fee.model!==receipt.model||Number(fee.usd)!==receipt.usd)continue;
   const occupied=(await client.query('SELECT reference_id,call_id FROM fg_fee_matches WHERE reference_id=$1 OR call_id=$2',[match.referenceId,match.callId])).rows;
   const decisions=(await client.query('SELECT reference_id FROM fg_fee_decisions WHERE reference_id=$1 OR call_id=$2',[match.referenceId,match.callId])).rows;
   if(occupied.length||decisions.length)continue;
   if(!dryRun){
    const result=await client.query('INSERT INTO fg_fee_usage_matches(reference_id,call_id,evidence,actor_id) VALUES($1,$2,$3::jsonb,$4) ON CONFLICT DO NOTHING RETURNING reference_id',[match.referenceId,match.callId,JSON.stringify({...match,model:receipt.model,source:'/api/log/self/',semantic:receipt.semantic}),actorId]);
    if(!result.rows.length)continue;
    await client.query("INSERT INTO fg_finance_audit(id,actor_id,action,target,after_value) VALUES(gen_random_uuid(),$1,'automatic_usage_match',$2,$3::jsonb)",[actorId,match.referenceId,JSON.stringify(match)]);
   }
   applied.push(match);
  }
  await client.query(dryRun?'ROLLBACK':'COMMIT');return applied;
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
