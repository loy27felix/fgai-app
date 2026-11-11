import test from 'node:test';
import assert from 'node:assert/strict';
import {rejectionEvidence} from './fg-fee-rejections.mjs';
import {feeLogCsv} from './fg-fee-sync.mjs';
import {parseFeeCsv} from './fg-finance.mjs';
test('final provider failure with an explicit zero charge retains its original status and reference',()=>{
 const row={type:'consume',status:'failed',actual_amount:0,time:1792143902,reference_id:'actual-provider-task-id',model_name:'MiniMax-H3'};
 const fees=parseFeeCsv(feeLogCsv([row]));assert.equal(fees.length,1);assert.equal(fees[0].usd,0);assert.equal(fees[0].providerStatus,'failed');assert.equal(fees[0].referenceId,row.reference_id);
 for(const amount of [null,undefined,''])assert.equal(feeLogCsv([{...row,actual_amount:amount}]),null);
 for(const amount of [-1,1]){
  const charged=parseFeeCsv(feeLogCsv([{...row,actual_amount:amount}]));assert.equal(charged[0].usd,1);assert.equal(charged[0].providerStatus,'failed');
 }
});
test('explicit request rejection has no charge evidence but ambiguous errors do not',()=>{
 const call={status:'failed',status_code:'403',error_code:'quota_not_enough',provider_request_id:'',input_tokens:0,output_tokens:0,media_count:0,fg_fee_references_json:'[]',response_body:'{}'};
 assert.equal(rejectionEvidence(call).statusCode,403);assert.equal(rejectionEvidence({...call,status_code:413}).statusCode,413);
 for(const patch of [{status_code:500},{status_code:0},{status:'succeeded'},{provider_request_id:'accepted-task'},{output_tokens:1},{media_count:1},{response_body:'{"task":{"id":"accepted"}}'},{status_code:403,error_code:'',error:'unknown failure'}])assert.equal(rejectionEvidence({...call,...patch}),null);
});

test('local circuit rejection and TLS handshake timeout prove the generation request was not admitted',()=>{
 const base={status:'failed',status_code:'0',provider_request_id:'',fg_fee_reference_id:'',input_tokens:0,output_tokens:0,media_count:0,fg_fee_references_json:'[]',response_body:''};
 assert.equal(rejectionEvidence({...base,error:'当前渠道连续失败，已暂时熔断，请稍后重试',duration_ms:0}).source,'local_channel_circuit_open');
 assert.equal(rejectionEvidence({...base,error:'网络异常。 Post "[URL]": net/http: TLS handshake timeout'}).source,'tls_handshake_failed');
 for(const patch of [
  {error:'unexpected EOF'}, {error:'等待上游响应超时'}, {error:'任务取消，中断上游请求'},
  {error:'net/http: TLS handshake timeout',response_body:'{}'},
  {error:'net/http: TLS handshake timeout',fg_fee_reference_id:'accepted-reference'},
  {error:'net/http: TLS handshake timeout',fg_fee_references_json:'["receipt"]'},
  {error:'当前渠道连续失败，已暂时熔断，请稍后重试',duration_ms:1},
 ]) assert.equal(rejectionEvidence({...base,...patch}),null);
});
