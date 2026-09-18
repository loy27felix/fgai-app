import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('usage ledger migration stores exact money and price snapshots', () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), 'docker/initdb/001-local.sql'),
    'utf8',
  );
  assert.match(sql, /create table if not exists ai_usage_ledger/);
  assert.match(sql, /reported_cost_usd numeric\(20,10\)/);
  assert.match(sql, /estimated_cost_usd numeric\(20,10\)/);
  assert.match(sql, /price_snapshot jsonb not null/);
  assert.match(sql, /check \(cost_source in \('reported', 'estimated', 'unknown'\)\)/);
});

test('a succeeded WeToken ledger row requires an exact provider Reference ID', () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), 'docker/initdb/012-wetoken-ledger-reference-required.sql'),
    'utf8',
  );
  assert.match(sql, /ai_usage_ledger_wetoken_succeeded_reference_check/);
  assert.match(sql, /provider <> 'wetoken'\s+or status <> 'succeeded'/);
  assert.match(sql, /nullif\(btrim\(provider_request_id\), ''\) is not null/);
});

test('the ledger blocks new duplicate WeToken provider references', () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), 'docker/initdb/014-wetoken-provider-reference-guard.sql'),
    'utf8',
  );
  assert.match(sql, /prevent_duplicate_wetoken_provider_reference/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('wetoken:' \|\| normalized_reference, 0\)\)/);
  assert.match(sql, /errcode = '23505'/);
  assert.match(sql, /ai_usage_ledger_wetoken_provider_reference_guard/);
});
