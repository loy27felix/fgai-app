import fs from 'node:fs/promises';
import {importFeeCsv} from './fg-fee-import.mjs';

const endpoint='https://wetoken.ai/api/user/v2/fee-log';
const csvCell=value=>'"'+String(value).replaceAll('"','""')+'"';
export function feeLogCsv(items){
 const rows=['Time,Model Name,Actual Amount (USD),Reference ID,Type,Status'];
 for(const item of items){
  if(item.type!=='consume'||item.status!=='success')continue;
  const amount=Number(item.actual_amount),seconds=Number(item.time);
  if(!Number.isFinite(amount)||!Number.isInteger(seconds)||seconds<=0||!item.reference_id||!item.model_name)throw new Error('INVALID_FEE_RECORD');
  const time=new Date(seconds*1000+8*3600000).toISOString().slice(0,19).replace('T',' ');
  rows.push([time,item.model_name,Math.abs(amount).toFixed(10).replace(/0+$/,'').replace(/\.$/,''),item.reference_id,'consume','success'].map(csvCell).join(','));
 }
 return rows.length>1?rows.join('\n'):null;
}

export async function readFeeLog(session,{fetcher=fetch,start,end}={}){
 if(!/^\d+$/.test(String(session.userId))||!/^session=[^;\r\n]+$/.test(session.cookie))throw new Error('INVALID_SESSION');
 if(session.expiresAt>0&&session.expiresAt*1000<=Date.now())throw new Error('SESSION_EXPIRED');
 const items=[];let expectedTotal;
 for(let page=1;page<=200;page++){
  const url=new URL(endpoint);
  for(const [key,value] of Object.entries({p:page,page_size:100,order:'desc',start_timestamp:start,end_timestamp:end}))url.searchParams.set(key,String(value));
  const response=await fetcher(url,{method:'GET',redirect:'error',headers:{Cookie:session.cookie,'New-API-User':String(session.userId),Accept:'application/json'},signal:AbortSignal.timeout(15000)});
  if(response.status===401||response.status===403)throw new Error('SESSION_EXPIRED');
  if(!response.ok)throw new Error('PROVIDER_UNAVAILABLE');
  const data=await response.json();
  if(data.success!==true)throw new Error('SESSION_EXPIRED');
  const body=data.data;
  if(!Array.isArray(body?.items)||!Number.isInteger(body.total)||body.total<0)throw new Error('INVALID_FEE_RESPONSE');
  // A changing account ledger must be fetched again; never mark a partial page set as synchronized.
  if(expectedTotal!==undefined&&body.total!==expectedTotal)throw new Error('LEDGER_CHANGED');
  expectedTotal=body.total;items.push(...body.items);
  if(items.length>=body.total)return items;
  if(body.items.length===0)throw new Error('INCOMPLETE_FEE_RESPONSE');
 }
 throw new Error('FEE_PAGE_LIMIT');
}

export function startFeeSync(pool,{file=process.env.WETOKEN_FEE_SESSION_FILE,actorId=process.env.FG_FEE_SYNC_ACTOR_ID,intervalMs=60000}={}){
 let busy=false,paused=false,timer;
 const save=async value=>pool.query("INSERT INTO fg_company_settings(key,value) VALUES('wetokenFeeSync',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()",[JSON.stringify(value)]);
 const run=async()=>{
  if(busy||paused)return;
  busy=true;
  let prior={};
  try{
   prior=(await pool.query("SELECT value FROM fg_company_settings WHERE key='wetokenFeeSync'")).rows[0]?.value||{};
   if(!file||!actorId){await save({mode:'csv',automatic:false,reason:'未配置授权账单会话；可导入官方 CSV。'});return;}
   const session=JSON.parse(await fs.readFile(file,'utf8'));
   const end=Math.floor(Date.now()/1000),start=Math.max(0,(prior.lastSuccess?Math.floor(Date.parse(prior.lastSuccess)/1000):end-31*86400)-2*86400);
   const entries=await readFeeLog(session,{start,end}),csv=feeLogCsv(entries);
   const imported=csv?await importFeeCsv(pool,actorId,csv):{rows:0,reused:false};
   await save({mode:'session',automatic:true,status:'synced',intervalSeconds:60,lastSuccess:new Date().toISOString(),fetchedRows:entries.length,reason:'每分钟只读同步；供应商出账后按 Reference ID 精确核销。',importedRows:imported.rows});
  }catch(error){
   const expired=['SESSION_EXPIRED','INVALID_SESSION'].includes(error.message);
   if(expired)paused=true;
   await save({...prior,mode:'session',automatic:!expired,status:expired?'reauthorization_required':'retrying',lastAttempt:new Date().toISOString(),reason:expired?'账单会话已过期，同步暂停；需要管理员重新授权。':'本轮未完成；保留已核销费用，下一轮重试。'}).catch(()=>{});
   console.warn('FG fee synchronization:',expired?'reauthorization_required':'retrying');
  }finally{busy=false;}
 };
 timer=setInterval(()=>void run(),Math.max(30000,intervalMs));timer.unref();void run();
 return {run,stop:()=>clearInterval(timer)};
}
