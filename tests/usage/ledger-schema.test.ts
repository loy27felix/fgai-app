import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('usage ledger migration stores exact money and price snapshots', () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), 'supabase/migrations/0004_ai_usage_ledger.sql'),
    'utf8',
  );
  assert.match(sql, /create table if not exists public\.ai_usage_ledger/);
  assert.match(sql, /reported_cost_usd numeric\(20,10\)/);
  assert.match(sql, /estimated_cost_usd numeric\(20,10\)/);
  assert.match(sql, /price_snapshot jsonb not null/);
  assert.match(sql, /check \(cost_source in \('reported', 'estimated', 'unknown'\)\)/);
});
