import test from 'node:test';
import assert from 'node:assert/strict';
import {financePeriod,inFinancePeriod} from './fg-finance-period.mjs';
test('monthly bills use exclusive Shanghai boundaries, including year and leap transitions',()=>{
 const september=financePeriod('2026-09');assert.equal(september.since,'2026-09-01T00:00:00+08:00');
 assert.equal(inFinancePeriod('2026-08-31T16:00:00Z',september),true);
 assert.equal(inFinancePeriod('2026-09-30T15:59:59.999Z',september),true);
 assert.equal(inFinancePeriod('2026-09-30T16:00:00Z',september),false);
 assert.equal(financePeriod('2025-12').until,'2026-01-01T00:00:00+08:00');
 assert.equal(inFinancePeriod('2024-02-29T12:00:00Z',financePeriod('2024-02')),true);
 assert.equal(inFinancePeriod('2001-01-01',financePeriod('all')),true);
 for(const month of ['2026-13','not-month','2099-01','1999-12'])assert.throws(()=>financePeriod(month));
});
