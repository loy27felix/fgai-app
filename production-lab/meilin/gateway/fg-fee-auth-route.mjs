import {feeAuthHeaders,feeResponseError,loadFeeAuthorization,sealFeeAuthorization} from './fg-fee-auth.mjs';
import {readFeeLog} from './fg-fee-sync.mjs';
import {readUsageLog} from './fg-fee-usage.mjs';

export async function feeAuthorizationRoute(req,res,{actor,pool,path,feeSync},{body,send,fetcher=fetch,secret=process.env.FG_BILLING_SECRET||process.env.FG_ADCRAFT_SECRET}={}){
 if(!['/api/fg/finance/authorization','/api/fg/finance/sync'].includes(path.pathname))return false;
 if(!actor.reviewer){send(res,'仅超级管理员可管理账单授权',403);return true;}
 if(req.method!=='POST'){send(res,'请求方式不支持',405);return true;}
 try{
  if(path.pathname.endsWith('/sync')){
   if(!feeSync)throw Error('SYNC_UNAVAILABLE');
   void feeSync.run();send(res,{accepted:true});return true;
  }
  const input=await body(req,8000),accessToken=String(input.accessToken||'').trim();
  const current=await loadFeeAuthorization(pool,{secret});
  const session={userId:String(current.userId),accessToken};
  const response=await fetcher('https://wetoken.ai/api/user/self',{method:'GET',redirect:'error',headers:feeAuthHeaders(session),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('AUTHORIZATION_REJECTED');
  const user=await response.json();
  if(feeResponseError(response,user)||String(user.data?.id)!==session.userId)throw Error('AUTHORIZATION_REJECTED');
  // Validate both required read endpoints before replacing working credentials.
  const end=Math.floor(Date.now()/1000),start=end-60;
  await readFeeLog(session,{fetcher,start,end});await readUsageLog(session,{fetcher,start,end});
  const sealed=sealFeeAuthorization(session,secret),client=await pool.connect();
  try{
   await client.query('BEGIN');
   await client.query("INSERT INTO fg_company_settings(key,value) VALUES('wetokenFeeAuthorization',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()",[JSON.stringify(sealed)]);
   await client.query("INSERT INTO fg_finance_audit(id,actor_id,action,target,after_value) VALUES(gen_random_uuid(),$1,'billing_authorization','wetoken',$2::jsonb)",[actor.id,JSON.stringify({providerUserId:session.userId,method:'access_token'})]);
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  void feeSync?.run();send(res,{saved:true});
 }catch(error){
  const message=['INVALID_SESSION','SESSION_EXPIRED','AUTHORIZATION_REJECTED'].includes(error.message)?'账单授权无效：请使用原 WeToken 公司账号的账户访问令牌，不能使用模型 API Key。':error.message==='BILLING_SECRET_UNAVAILABLE'?'服务器尚未配置账单凭证加密，未保存授权。':'账单授权验证未完成，原授权保持不变，请稍后重试。';
  send(res,message,400);
 }
 return true;
}
