import test from 'node:test';
import assert from 'node:assert/strict';
import {rejectionEvidence} from './fg-fee-rejections.mjs';
import {feeLogCsv} from './fg-fee-sync.mjs';
import {parseFeeCsv} from './fg-finance.mjs';
test('final provider failure with an explicit zero charge retains its original status and reference',()=>{
 const row={type:'consume',status:'failed',actual_amount:0,time:1792143902,reference_id:'actual-provider-task-id',model_name:'MiniMax-H3'};
 const fees=parseFeeCsv(feeLogCsv([row]));assert.equal(fees.length,1);assert.equal(fees[0].usd,0);assert.equal(fees[0].providerStatus,'failed');assert.equal(fees[0].referenceId,row.reference_id);
 for(const amount of [null,undefined,'',-1,1])assert.equal(feeLogCsv([{...row,actual_amount:amount}]),null);
});
test('explicit request rejection has no charge evidence but ambiguous errors do not',()=>{
 const call={status:'failed',status_code:'403',error_code:'quota_not_enough',provider_request_id:'',input_tokens:0,output_tokens:0,media_count:0,fg_fee_references_json:'[]',response_body:'{}'};
 assert.equal(rejectionEvidence(call).statusCode,403);assert.equal(rejectionEvidence({...call,status_code:413}).statusCode,413);
 for(const patch of [{status_code:500},{status_code:0},{status:'succeeded'},{provider_request_id:'accepted-task'},{output_tokens:1},{media_count:1},{response_body:'{"task":{"id":"accepted"}}'},{status_code:403,error_code:'',error:'unknown failure'}])assert.equal(rejectionEvidence({...call,...patch}),null);
});
