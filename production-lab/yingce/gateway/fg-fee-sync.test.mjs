import test from 'node:test';
import assert from 'node:assert/strict';
import {feeLogCsv,readFeeLog,startFeeSync} from './fg-fee-sync.mjs';
import {feeAuthHeaders,sealFeeAuthorization,openFeeAuthorization} from './fg-fee-auth.mjs';
import {parseFeeCsv} from './fg-finance.mjs';
const session={cookie:'session=test-only',userId:'226'};
test('only successful consumption is imported, with exact reference and Shanghai time',()=>{
 const csv=feeLogCsv([{type:'consume',status:'success',actual_amount:-.1234,time:1790858888,model_name:'model',reference_id:'exact-id'},{type:'recharge',status:'success',actual_amount:5}]);
 assert.deepEqual(parseFeeCsv(csv),[{referenceId:'exact-id',model:'model',usd:.1234,occurredAt:new Date(1790858888000).toISOString()}]);
 assert.equal(feeLogCsv([{type:'consume',status:'failed'}]),null);
});
test('bill reads are fixed-origin GET with no redirects and complete pagination',async()=>{
 const seen=[];const items=await readFeeLog(session,{start:1,end:2,fetcher:async(url,options)=>{seen.push([url,options]);return {ok:true,json:async()=>({success:true,data:{total:2,items:[{reference_id:'r'+seen.length}]}})};}});
 assert.equal(items.length,2);
 assert.equal(seen[1][0].searchParams.get('p'),'2');
 assert.equal(seen[0][0].origin,'https://wetoken.ai');
 assert.equal(seen[0][1].method,'GET');assert.equal(seen[0][1].redirect,'error');
});
test('HTTP 200 login failures and truncated pages never become a successful zero bill',async()=>{
 await assert.rejects(readFeeLog(session,{fetcher:async()=>({ok:true,json:async()=>({success:false,message:'未登录'})})}),/SESSION_EXPIRED/);
 await assert.rejects(readFeeLog(session,{fetcher:async()=>({ok:true,json:async()=>({success:true,data:{total:1,items:[]}})})}),/INCOMPLETE/);
});

test('temporary provider rejections are retried rather than misclassified as expired authorization',async()=>{
 await assert.rejects(readFeeLog(session,{fetcher:async()=>({ok:true,json:async()=>({success:false,message:'服务繁忙，请稍后重试'})})}),/PROVIDER_REJECTED/);
});
test('account access tokens use a header, and encrypted storage never contains the token',()=>{
 const value={userId:'226',accessToken:'account-token-test-only'},secret='test-only-billing-encryption-secret';
 const headers=feeAuthHeaders(value);assert.equal(headers.Authorization,'Bearer '+value.accessToken);assert.equal(headers.Cookie,undefined);
 const sealed=sealFeeAuthorization(value,secret);assert.ok(!JSON.stringify(sealed).includes(value.accessToken));
 assert.deepEqual(openFeeAuthorization(sealed,secret),value);
 assert.throws(()=>openFeeAuthorization({...sealed,tag:Buffer.alloc(16).toString('base64')},secret));
 assert.throws(()=>feeAuthHeaders({...value,accessToken:'bad\r\nheader'}),/INVALID_SESSION/);
});
test('expired authorization recovers on the next run, backfills from the last success, and excludes simultaneous runs',async()=>{
 let value={lastSuccess:'2026-10-14T01:46:04.781Z'},expired=true,reads=0,window;
 const pool={query:async(sql,args)=>{if(sql.startsWith('SELECT'))return {rows:[{value}]};value=JSON.parse(args[0]);return {rows:[]};}};
 const sync=startFeeSync(pool,{actorId:'admin',autoStart:false,loadAuthorization:async()=>session,
  readFees:async(_,range)=>{reads++;window=range;if(expired)throw Error('SESSION_EXPIRED');return [];},readUsage:async()=>[],intervalMs:60000});
 try{
  assert.equal((await sync.run()).status,'reauthorization_required');assert.equal(value.lastSuccess,'2026-10-14T01:46:04.781Z');
  expired=false;assert.equal((await sync.run()).status,'synced');assert.equal(reads,2);
  assert.equal(window.start,Date.parse('2026-10-14T01:46:04.781Z')/1000-2*86400-.781);
  assert.equal(value.automatic,true);
 }finally{sync.stop();}
});
