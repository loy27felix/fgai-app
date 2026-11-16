import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {feeAuthorizationRoute} from './fg-fee-auth-route.mjs';
import {sealFeeAuthorization,openFeeAuthorization} from './fg-fee-auth.mjs';
const secret='unit-test-billing-server-secret-only';
const token='test-account-access-token-only';
function fixture({reviewer=true,userId=226}={}){
 let result,stored=sealFeeAuthorization({userId:'226',cookie:'session=old-test'},secret),runs=0;
 const writes=[];
 const client={query:async(sql,args)=>{writes.push({sql,args});if(sql.includes("VALUES('wetokenFeeAuthorization'"))stored=JSON.parse(args[0]);return {rows:[]};},release(){}};
 const pool={query:async()=>({rows:[{value:stored}]}),connect:async()=>client};
 const req=Readable.from([JSON.stringify({accessToken:token})]);req.method='POST';
 const helpers={secret,body:async(r)=>{let s='';for await(const c of r)s+=c;return JSON.parse(s);},send:(_,data,status=200)=>{result={data,status};},fetcher:async url=>({ok:true,status:200,json:async()=>String(url)==='https://wetoken.ai/api/user/self'?{success:true,data:{id:userId}}:{success:true,data:{items:[],total:0}}})};
 return {req,helpers,context:{actor:{id:'admin-id',reviewer},pool,path:new URL('https://fg.local/api/fg/finance/authorization'),feeSync:{run:async()=>{runs++;}}},result:()=>result,writes,stored:()=>stored,runs:()=>runs};
}
test('authorization rejects a different provider account without replacing the old credentials',async()=>{
 const f=fixture({userId:999});await feeAuthorizationRoute(f.req,{},f.context,f.helpers);
 assert.equal(f.result().status,400);assert.equal(f.writes.length,0);assert.equal(f.runs(),0);
});
test('only a verified original account is encrypted and triggers automatic backfill',async()=>{
 const f=fixture();await feeAuthorizationRoute(f.req,{},f.context,f.helpers);
 assert.equal(f.result().status,200);assert.equal(f.runs(),1);
 assert.equal(openFeeAuthorization(f.stored(),secret).accessToken,token);
 assert.ok(!JSON.stringify(f.writes).includes(token));assert.ok(!JSON.stringify(f.result()).includes(token));
 assert.ok(f.writes.some(w=>w.sql.includes('fg_finance_audit')));
});
test('ordinary members cannot update provider authorization or trigger privileged sync',async()=>{
 const f=fixture({reviewer:false});await feeAuthorizationRoute(f.req,{},f.context,f.helpers);
 assert.equal(f.result().status,403);assert.equal(f.writes.length,0);assert.equal(f.runs(),0);
});
