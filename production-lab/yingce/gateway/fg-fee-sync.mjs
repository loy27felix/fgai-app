import {importFeeCsv} from './fg-fee-import.mjs';
import {readUsageLog,reconcileUsage} from './fg-fee-usage.mjs';
import {feeAuthHeaders,feeResponseError,loadFeeAuthorization} from './fg-fee-auth.mjs';
import {reconcileRejectedRequests} from './fg-fee-rejections.mjs';

const endpoint='https://wetoken.ai/api/user/v2/fee-log';
const csvCell=value=>'"'+String(value).replaceAll('"','""')+'"';
export function feeLogCsv(items){
 const rows=['Time,Model Name,Actual Amount (USD),Reference ID,Type,Status'];
 for(const item of items){
  const explicitAmount=(typeof item.actual_amount==='number'||typeof item.actual_amount==='string'&&item.actual_amount.trim()!=='');
  if(item.type!=='consume'||!['success','failed'].includes(item.status)||(item.status==='failed'&&!explicitAmount))continue;
  const amount=Number(item.actual_amount),seconds=Number(item.time);
  if(!Number.isFinite(amount)||!Number.isInteger(seconds)||seconds<=0||!item.reference_id||!item.model_name)throw new Error('INVALID_FEE_RECORD');
  const time=new Date(seconds*1000+8*3600000).toISOString().slice(0,19).replace('T',' ');
  rows.push([time,item.model_name,Math.abs(amount).toFixed(10).replace(/0+$/,'').replace(/\.$/,''),item.reference_id,'consume',item.status].map(csvCell).join(','));
 }
 return rows.length>1?rows.join('\n'):null;
}

export async function readFeeLog(session,{fetcher=fetch,start,end}={}){
 const headers=feeAuthHeaders(session);
 const items=[];let expectedTotal;
 for(let page=1;page<=200;page++){
  const url=new URL(endpoint);
  for(const [key,value] of Object.entries({p:page,page_size:100,order:'desc',start_timestamp:start,end_timestamp:end}))url.searchParams.set(key,String(value));
  const response=await fetcher(url,{method:'GET',redirect:'error',headers,signal:AbortSignal.timeout(15000)});
  if(response.status===401||response.status===403)throw new Error('SESSION_EXPIRED');
  if(!response.ok)throw new Error('PROVIDER_UNAVAILABLE');
  const data=await response.json();
  const error=feeResponseError(response,data);if(error)throw Error(error);
  const body=data.data;
  if(!Array.isArray(body?.items)||!Number.isInteger(body.total)||body.total<0)throw new Error('INVALID_FEE_RESPONSE');
  // A changing account ledger must be fetched again; never mark a partial page set as synchronized.
  if(expectedTotal!==undefined&&body.total!==expectedTotal)throw new Error('LEDGER_CHANGED');
  expectedTotal=body.total;items.push(...body.items);
  if(items.length===body.total)return items;
  if(items.length>body.total)throw Error('INCOMPLETE_FEE_RESPONSE');
  if(body.items.length===0)throw new Error('INCOMPLETE_FEE_RESPONSE');
 }
 throw new Error('FEE_PAGE_LIMIT');
}

export function startFeeSync(pool,{file=process.env.WETOKEN_FEE_SESSION_FILE,actorId=process.env.FG_FEE_SYNC_ACTOR_ID,intervalMs=60000,loadAuthorization=()=>loadFeeAuthorization(pool,{file}),readFees=readFeeLog,readUsage=readUsageLog,importFees=importFeeCsv,matchUsage=reconcileUsage,matchRejected=reconcileRejectedRequests,autoStart=true}={}){
 let busy=false,timer;
 const save=async value=>pool.query("INSERT INTO fg_company_settings(key,value) VALUES('wetokenFeeSync',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()",[JSON.stringify(value)]);
 const run=async()=>{
  if(busy)return {started:false};
  busy=true;
  let prior={};
  try{
   prior=(await pool.query("SELECT value FROM fg_company_settings WHERE key='wetokenFeeSync'")).rows[0]?.value||{};
   if(!actorId){await save({mode:'csv',automatic:false,reason:'未配置对账执行账号；可导入官方 CSV。'});return {started:false};}
   // Reload credentials every run, including after a previous 401. Authorization
   // renewal must recover without restarting a production service.
   const session=await loadAuthorization();
   await save({...prior,automatic:true,status:'running',lastAttempt:new Date().toISOString(),reason:'正在自动补拉消费账单并核销，请稍候。'});
   const end=Math.floor(Date.now()/1000),last=Date.parse(prior.lastSuccess||'');
   const oldest=(await pool.query("SELECT min(c.created_at) oldest FROM api_call_logs c JOIN model_channels m ON m.id=c.channel_id WHERE c.billable AND m.name LIKE 'WeToken%' AND NOT EXISTS(SELECT 1 FROM fg_fee_matches f WHERE f.call_id=c.id) AND NOT EXISTS(SELECT 1 FROM fg_request_decisions d WHERE d.call_id=c.id)")).rows[0]?.oldest;
   const pending=oldest?Date.parse(oldest):NaN;
   const start=Math.max(0,Math.min(Number.isFinite(last)?Math.floor(last/1000):end-31*86400,Number.isFinite(pending)?Math.floor(pending/1000):end)-2*86400);
   const entries=await readFees(session,{start,end}),csv=feeLogCsv(entries);
   const imported=csv?await importFees(pool,actorId,csv):{rows:0,reused:false};
   const usage=await readUsage(session,{start,end});
   const matched=usage.length?await matchUsage(pool,actorId,usage):[];
   const rejected=await matchRejected(pool,actorId);
   await save({mode:session.accessToken?'access_token':'session',automatic:true,status:'synced',intervalSeconds:Math.max(30,intervalMs/1000),lastSuccess:new Date().toISOString(),fetchedRows:entries.length,reason:'每分钟自动对账；按流水核销扣费及失败零扣款，明确的生成前拒绝自动确认未收费。',importedRows:imported.rows,usageMatchedRows:matched.length,rejectedNoChargeRows:rejected.length});
   return {started:true,status:'synced',fetchedRows:entries.length};
  }catch(error){
   const expired=['SESSION_EXPIRED','INVALID_SESSION'].includes(error.message);
   await save({...prior,mode:'session',automatic:!expired,status:expired?'reauthorization_required':'retrying',lastAttempt:new Date().toISOString(),reason:expired?'账单授权已失效；请更新账单授权，更新后自动恢复并补拉遗漏账单。':'本轮未完成；保留已核销费用，下一轮自动重试。'}).catch(()=>{});
   console.warn('FG fee synchronization:',expired?'reauthorization_required':'retrying');
   return {started:true,status:expired?'reauthorization_required':'retrying'};
  }finally{busy=false;}
 };
 timer=setInterval(()=>void run(),Math.max(30000,intervalMs));timer.unref();if(autoStart)void run();
 return {run,stop:()=>clearInterval(timer)};
}
