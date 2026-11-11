import test from 'node:test';
import assert from 'node:assert/strict';
import {personalFinanceRoute,settledFeeCTE} from './fg-personal-finance.mjs';

test('personal finance binds the authenticated user even for admins and ignores forged scope',async()=>{
 for(const reviewer of [false,true]){
  const queries=[];let result;
  const pool={query:async(sql,args)=>{queries.push({sql,args});return {rows:sql.includes('total_cny')?[{total_cny:'8',month_cny:'3',pending_requests:1}]:sql.includes('count(*)::int total')?[{total:1}]:[]};}};
  await personalFinanceRoute({method:'GET'},{},{actor:{id:'my-account',reviewer},pool,path:new URL('https://fg.test/api/fg/finance/mine?userId=other&owner=other&month=2026-10')},{send:(_,value,status)=>{result={value,status};}});
  assert.equal(queries.length,4);assert.equal(result.value.summary.total_cny,'8');
  for(const q of queries){assert.equal(q.args[0],'my-account');assert.match(q.sql,/WHERE l.user_id=\$1 AND l.billable=true/);assert.ok(!q.sql.includes('OR s.native_project_id'));assert.ok(!q.sql.includes('request_body'));assert.ok(!q.args.includes('other'));}
  assert.equal(result.value.records.length,0);
 }
});
test('personal finance refuses unauthenticated, writes and invalid filters before querying',async()=>{
 const pool={query:()=>{throw Error('must not query');}};
 for(const input of [{actor:null,method:'GET',query:'',status:401},{actor:{id:'me'},method:'POST',query:'',status:405},{actor:{id:'me'},method:'GET',query:'?month=2026-99',status:400},{actor:{id:'me'},method:'GET',query:'?pageSize=1000',status:400}]){
  let status;await personalFinanceRoute({method:input.method},{},{actor:input.actor,pool,path:new URL('https://fg.test/api/fg/finance/mine'+input.query)},{send:(_,v,s)=>{status=s;}});assert.equal(status,input.status);
 }
 assert.match(settledFeeCTE,/fg_fee_matches/);assert.match(settledFeeCTE,/f.usd\*f.fx/);
});
