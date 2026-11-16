import{test}from'node:test';
import assert from'node:assert/strict';
import{meilinQuotaError}from'./fg-meilin-errors.mjs';
test('WeToken insufficient_user_quota 403 is quota, without exposing diagnostics',()=>{
 const error=meilinQuotaError({status_code:403,response_body:JSON.stringify({error:{code:'insufficient_user_quota',message:'预扣费失败 api_key=secret'}})});
 assert.match(error,/额度不足/);assert.doesNotMatch(error,/secret|api_key/);
});
test('authentication failures and unstructured or echoed quota words remain untouched',()=>{
 for(const log of [
  {status_code:401,response_body:'{"error":{"code":"insufficient_user_quota"}}'},
  {status_code:403,response_body:'{"error":{"code":"invalid_api_key","message":"insufficient_user_quota"}}'},
  {status_code:403,response_body:'insufficient_user_quota api_key=secret'},
  {status_code:403,response_body:'{"error":{"code":"insufficient_user_quota"'},
 ])assert.equal(meilinQuotaError(log),null);
});
