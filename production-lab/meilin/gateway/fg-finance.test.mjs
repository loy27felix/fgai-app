import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFeeCsv,exactFeeOwner} from './fg-finance.mjs';
const header='Time,Type,Status,Model Name,Actual Amount USD,Reference ID\r\n';
test('official Shanghai consumption, zero bill and recharge exclusion',()=>{
    const rows=parseFeeCsv('\ufeff'+header+'2026-09-30 20:00:00,consume,success,gpt-6-astra,-0.00123,fee-1\r\n2026-09-30 20:00:00,recharge,success,,100,recharge-1\r\n2026-09-30 20:01:00,consume,success,gpt-6-astra,0,fee-2');
    assert.equal(rows.length,2);assert.equal(rows[0].occurredAt,'2026-09-30T12:00:00.000Z');assert.equal(rows[0].usd,0.00123);assert.equal(rows[1].usd,0);
});
test('duplicate bills never double count and conflicting originals fail',()=>{
    const line='2026-09-30 20:00:00,consume,success,gpt-6-astra,-0.1,fee-1\n';
    assert.equal(parseFeeCsv(header+line+line).length,1);
    assert.throws(()=>parseFeeCsv(header+line+line.replace('-0.1','-0.2')),/冲突/);
    assert.throws(()=>parseFeeCsv(header+line.replace('2026-09-30','2026-02-31')),/日期/);
});
test('fee reference is distinct from video task id, with no ambiguous attribution',()=>{
    const fee={referenceId:'fee-1',model:'seedance'};
    const call={billable:true,capability:'video',model:'seedance',fg_fee_reference_id:'fee-1',provider_request_id:'video-task-9'};
    assert.equal(exactFeeOwner(fee,[call]),call);
    assert.equal(exactFeeOwner(fee,[call,{...call}]),null);
    assert.equal(exactFeeOwner(fee,[{...call,model:'different-model'}]),null);
    assert.equal(exactFeeOwner(fee,[{...call,billable:false}]),null);
    assert.equal(exactFeeOwner({referenceId:'video-task-9',model:'seedance'},[call]),call);
    assert.equal(exactFeeOwner(fee,[{...call,capability:'text',fg_fee_reference_id:'other-fee',provider_request_id:'fee-1'}]),null);
});
test('malformed CSV and non official amounts rejected',()=>{
    assert.throws(()=>parseFeeCsv(header+'"unfinished'),/引号/);
    assert.throws(()=>parseFeeCsv(header+'2026-09-30 20:00:00,consume,success,gpt,NaN,id'),/金额/);
});
