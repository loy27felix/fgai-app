import test from 'node:test';
import assert from 'node:assert/strict';
import {feeLogCsv,readFeeLog} from './fg-fee-sync.mjs';
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
 await assert.rejects(readFeeLog(session,{fetcher:async()=>({ok:true,json:async()=>({success:false})})}),/SESSION_EXPIRED/);
 await assert.rejects(readFeeLog(session,{fetcher:async()=>({ok:true,json:async()=>({success:true,data:{total:1,items:[]}})})}),/INCOMPLETE/);
});
