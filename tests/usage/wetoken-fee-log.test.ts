import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWetokenFeeLogCsv } from '../../lib/usage/wetoken-fee-log';

test('parses successful WeToken consumption rows as exact positive USD costs', () => {
  const rows = parseWetokenFeeLogCsv([
    'Time,Type,Status,Original price,Discount,Cost,Model Name,Token Name,Reference ID',
    '2026-09-11 10:42:47,Consume,Success,-0.683551,85%,-0.581018,dreamina-seedance-2-0-mini-filter-off,FGAI,cgt-20260911103959-rgvw4',
    '2026-09-11 10:44:00,Top Up,N/A,10,,10,,,topup-1',
  ].join('\n'));

  assert.deepEqual(rows, [{
    referenceId: 'cgt-20260911103959-rgvw4',
    model: 'dreamina-seedance-2-0-mini-filter-off',
    occurredAt: '2026-09-11 10:42:47',
    actualCostUsd: 0.581018,
  }]);
});

test('accepts the Chinese export headers and escaped CSV fields', () => {
  const rows = parseWetokenFeeLogCsv([
    '时间,类型,状态,原价,折扣,费用,模型名称,令牌名称,流水标识',
    '2026-09-11 10:38:10,消费,成功,-0.041903,60%,"-0.025142","gpt-image-2","FGAI","20260911023732712120112W,part"',
  ].join('\n'));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].referenceId, '20260911023732712120112W,part');
  assert.equal(rows[0].actualCostUsd, 0.025142);
});

test('parses the account export while excluding model-less top-up rows', () => {
  const rows = parseWetokenFeeLogCsv([
    'Time,Model Name,Token Name,Actual Amount (USD),Reference ID',
    '2026-09-08 15:33:05,,,500.000000,ANTOM_topup',
    '2026-09-08 15:34:05,doubao-seedance-2-0,FGAI,1.669501,cgt-20260908153405-demo',
  ].join('\n'));

  assert.deepEqual(rows, [{
    referenceId: 'cgt-20260908153405-demo',
    model: 'doubao-seedance-2-0',
    occurredAt: '2026-09-08 15:34:05',
    actualCostUsd: 1.669501,
  }]);
});
