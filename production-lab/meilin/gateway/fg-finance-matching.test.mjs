import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {financeActions} from './fg-finance-actions.mjs';
import {validateMatchPairs} from './fg-finance-matching.mjs';

const note='已核实供应商原始账单与请求明细';
const pair=(callId,referenceId)=>({callId,referenceId});
test('rejects duplicate receipts, duplicate calls and incomplete evidence',()=>{
 for(const pairs of [[],[pair('a','x'),pair('b','x')],[pair('a','x'),pair('a','y')],[pair('a','')]])assert.throws(()=>validateMatchPairs(pairs,note));
 assert.throws(()=>validateMatchPairs([pair('a','x')],'按时间猜测'));
 assert.deepEqual(validateMatchPairs([pair('a','x')],note),[pair('a','x')]);
});

function database({wrongModel=false,alreadyMatched=false}={}){
 const fees={x:{reference_id:'x',model:'text-model'},y:{reference_id:'y',model:wrongModel?'different-model':'text-model'}};
 const calls={a:{id:'a',model:'text-model',user_id:'u'},b:{id:'b',model:'text-model',user_id:'u'}};
 let state={decisions:{},audit:[]},before;
 const client={release(){},async query(sql,args=[]){
  if(sql==='BEGIN'){before=structuredClone(state);return {rows:[]};}
  if(sql==='ROLLBACK'){state=before;return {rows:[]};}
  if(sql==='COMMIT'||sql.includes('pg_advisory_xact_lock'))return {rows:[]};
  if(sql.startsWith('SELECT * FROM fg_provider_fees'))return {rows:fees[args[0]]?[fees[args[0]]]:[]};
  if(sql.startsWith('SELECT * FROM api_call_logs'))return {rows:calls[args[0]]?[calls[args[0]]]:[]};
  if(sql.startsWith('SELECT reference_id,call_id,method'))return {rows:alreadyMatched?[{reference_id:args[0],call_id:'other',method:'automatic'}]:Object.values(state.decisions).filter(d=>d.reference_id===args[0]||d.call_id===args[1])};
  if(sql.startsWith('SELECT * FROM fg_fee_decisions'))return {rows:state.decisions[args[0]]?[state.decisions[args[0]]]:[]};
  if(sql.startsWith('INSERT INTO fg_fee_decisions')){state.decisions[args[0]]={reference_id:args[0],call_id:args[1],classification:'matched',note:args[2],actor_id:args[3]};return {rows:[]};}
  if(sql.startsWith('INSERT INTO fg_finance_audit')){state.audit.push(args);return {rows:[]};}
  throw Error('Unexpected query: '+sql);
 }};
 return {pool:{connect:async()=>client},state:()=>state};
}
async function submit(db,pairs,reviewer=true){
 const req=Readable.from([Buffer.from(JSON.stringify({pairs,note}))]);req.method='POST';
 let status,result;
 const res={writeHead(code){status=code;},end(body){result=JSON.parse(body);}};
 assert.equal(await financeActions(req,res,{pool:db.pool,actor:{id:'admin',reviewer},path:new URL('https://fg.test/api/fg/finance/batch-matches')}),true);
 return {status,result};
}
test('commits a complete batch and records per-receipt evidence',async()=>{
 const db=database();assert.equal((await submit(db,[pair('a','x'),pair('b','y')])).status,200);
 assert.equal(Object.keys(db.state().decisions).length,2);assert.equal(db.state().audit.length,2);
 assert.equal(db.state().audit[0][5].batchSize,2);
});
test('rolls back earlier pairs when a later model differs',async()=>{
 const db=database({wrongModel:true});assert.equal((await submit(db,[pair('a','x'),pair('b','y')])).status,400);
 assert.deepEqual(db.state(),{decisions:{},audit:[]});
});
test('prevents takeover of an existing automatic match',async()=>{
 const db=database({alreadyMatched:true});assert.equal((await submit(db,[pair('a','x')])).status,400);assert.equal(db.state().audit.length,0);
});
test('batch retry is idempotent and does not add duplicate audit records',async()=>{
 const db=database();await submit(db,[pair('a','x')]);await submit(db,[pair('a','x')]);assert.equal(db.state().audit.length,1);
});
test('members cannot batch-adjust ledger attribution',async()=>{
 const db=database();assert.equal((await submit(db,[pair('a','x')],false)).status,403);assert.equal(db.state().audit.length,0);
});
