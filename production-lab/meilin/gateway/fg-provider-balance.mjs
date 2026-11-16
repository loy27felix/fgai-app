import {loadFeeAuthorization,feeAuthHeaders,feeResponseError} from './fg-fee-auth.mjs';

// Cache per database pool; never cache credentials or expose the provider user.
const caches=new WeakMap();
export async function providerBalance(pool,{fetcher=fetch,now=Date.now}={}){
 let cache=caches.get(pool);if(!cache){cache={};caches.set(pool,cache);}
 if(cache.until>now())return cache.value;
 if(cache.inflight)return cache.inflight;
 cache.inflight=(async()=>{
  try{
   const session=await loadFeeAuthorization(pool);
   const read=async endpoint=>{
    const response=await fetcher('https://wetoken.ai'+endpoint,{headers:feeAuthHeaders(session),redirect:'error',signal:AbortSignal.timeout(10000)});
    const body=await response.json();if(feeResponseError(response,body))throw Error('BALANCE_UNAVAILABLE');return body.data;
   };
   const [account,status]=await Promise.all([read('/api/user/self'),read('/api/status')]);
   if(String(account.id)!==String(session.userId)||status.quota_display_type!=='USD'||!Number.isFinite(status.quota_per_unit)||status.quota_per_unit<=0||!Number.isFinite(account.quota))throw Error('BALANCE_UNAVAILABLE');
   const value={available:true,provider:'WeToken',currency:'USD',balance:account.quota/status.quota_per_unit,updatedAt:new Date(now()).toISOString(),stale:false};
   cache.last=value;cache.value=value;cache.until=now()+60000;return value;
  }catch{
   const value=cache.last?{...cache.last,stale:true}:{available:false,provider:'WeToken',currency:'USD',balance:null,updatedAt:null,stale:false};
   cache.value=value;cache.until=now()+15000;return value;
  }finally{cache.inflight=null;}
 })();return cache.inflight;
}

export async function providerBalanceRoute(req,res,{actor,pool,path},{send}={}){
 if(path.pathname!=='/api/fg/finance/balance')return false;
 if(!actor.reviewer){send(res,'仅超级管理员可查看公司账户余额',403);return true;}
 if(req.method!=='GET'){send(res,'请求方式不支持',405);return true;}
 send(res,await providerBalance(pool));return true;
}
