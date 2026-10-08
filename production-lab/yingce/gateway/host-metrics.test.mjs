import test from 'node:test';
import assert from 'node:assert/strict';
import {applyHostDiskMetrics} from './host-metrics.mjs';
const now=Date.parse('2026-10-02T12:00:00Z');
const snapshot={collectedAt:new Date(now-1000).toISOString(),totalBytes:100,usedBytes:25,freeBytes:75};
test('fresh host statistics replace only the invalid SMB metrics reason',()=>{
  const data=applyHostDiskMetrics({status:'degraded',degradedReasons:['diskMetrics'],disk:{writable:true}},snapshot,now);
  assert.equal(data.status,'healthy');
  assert.equal(data.disk.usagePercent,25);
  assert.equal(data.disk.writable,true);
});
test('valid host statistics cannot hide runtime, storage write or service failures',()=>{
  const reasons=['database','diskWritable','runtime','redis','agent'];
  const data=applyHostDiskMetrics({status:'degraded',degradedReasons:['diskMetrics',...reasons],disk:{writable:false}},snapshot,now);
  assert.equal(data.status,'degraded');
  assert.deepEqual(data.degradedReasons,reasons);
  assert.equal(data.disk.writable,false);
});
test('expired, future or inconsistent snapshots never show usable capacity',()=>{
  for(const invalid of [null,{...snapshot,collectedAt:new Date(now-180000).toISOString()},
    {...snapshot,collectedAt:new Date(now+1).toISOString()},{...snapshot,usedBytes:101},{...snapshot,freeBytes:-1}]) {
    const data=applyHostDiskMetrics({status:'healthy',disk:{writable:true}},invalid,now);
    assert.equal(data.status,'degraded');
    assert.equal(data.disk.available,false);
  }
});
test('legacy health status without explicit reasons is not silently cleared',()=>{
  assert.equal(applyHostDiskMetrics({status:'degraded',disk:{}},snapshot,now).status,'degraded');
});
