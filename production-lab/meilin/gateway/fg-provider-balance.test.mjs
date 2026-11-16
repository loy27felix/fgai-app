import test from 'node:test';
import assert from 'node:assert/strict';
import {sealFeeAuthorization} from './fg-fee-auth.mjs';
import {providerBalance,providerBalanceRoute} from './fg-provider-balance.mjs';
const secret='a-private-test-secret-that-is-long-enough';process.env.FG_BILLING_SECRET=secret;
const pool=()=>({query:async()=>({rows:[{value:sealFeeAuthorization({userId:'226',accessToken:'test-read-only-access-token'},secret)}]})});
const response=data=>({ok:true,status:200,json:async()=>({success:true,data})});
test('use provider currency and quota unit rather than legacy 500000 conversion; cache concurrent reads',async()=>{
 const p=pool();let reads=0;
 const fetcher=async url=>{reads++;return response(url.endsWith('/status')?{quota_per_unit:1000000,quota_display_type:'USD'}:{id:226,quota:128451235});};
 const values=await Promise.all([providerBalance(p,{fetcher}),providerBalance(p,{fetcher})]);
 assert.equal(values[0].balance,128.451235);assert.equal(values[0].currency,'USD');assert.equal(reads,2);
 await providerBalance(p,{fetcher});assert.equal(reads,2);assert.ok(!JSON.stringify(values).includes('accessToken'));
});
test('zero and negative actual balances are valid; unknown units, auth failures and wrong accounts are not zero',async()=>{
 for(const quota of [0,-1000000]){const value=await providerBalance(pool(),{fetcher:async url=>response(url.endsWith('/status')?{quota_per_unit:1000000,quota_display_type:'USD'}:{id:226,quota})});assert.equal(value.balance,quota/1000000);assert.equal(value.available,true);}
 for(const data of [{quota_display_type:'USD'},{quota_per_unit:1000000,quota_display_type:'CNY'}]){const v=await providerBalance(pool(),{fetcher:async url=>response(url.endsWith('/status')?data:{id:226,quota:5})});assert.equal(v.balance,null);assert.equal(v.available,false);}
 const v=await providerBalance(pool(),{fetcher:async()=>{throw Error('private provider details');}});assert.equal(v.balance,null);assert.ok(!JSON.stringify(v).includes('private'));
});
test('temporary outages retain last successful amount with a stale label',async()=>{
 const p=pool();let time=0;const good=await providerBalance(p,{now:()=>time,fetcher:async url=>response(url.endsWith('/status')?{quota_per_unit:1000000,quota_display_type:'USD'}:{id:226,quota:1000000})});time=61000;
 const stale=await providerBalance(p,{now:()=>time,fetcher:async()=>{throw Error('offline');}});assert.equal(stale.balance,good.balance);assert.equal(stale.stale,true);assert.equal(stale.updatedAt,good.updatedAt);
});
test('provider balance is restricted to reviewers and GET',async()=>{
 const calls=[];const send=(_,data,status=200)=>calls.push({data,status});const path=new URL('https://fg/api/fg/finance/balance');
 await providerBalanceRoute({method:'GET'},{},{actor:{reviewer:false},pool:pool(),path},{send});assert.equal(calls[0].status,403);
 await providerBalanceRoute({method:'POST'},{},{actor:{reviewer:true},pool:pool(),path},{send});assert.equal(calls[1].status,405);
});
