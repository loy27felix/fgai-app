import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { monthStartDate, monthStartKey, nextMonthStart } from '../../lib/usage/budget';

const root = path.resolve(process.cwd());

test('monthly budget migration creates a per-user monthly USD limit and timing column', async () => {
  const sql = await readFile(path.join(root, 'supabase/migrations/0008_usage_budgets.sql'), 'utf8');
  assert.match(sql, /add column if not exists duration_ms bigint not null default 0/i);
  assert.match(sql, /create table if not exists public\.ai_usage_budgets/i);
  assert.match(sql, /unique \(user_id, month_start\)/i);
  assert.match(sql, /limit_usd numeric\(20,10\) not null check \(limit_usd >= 0\)/i);
  assert.match(sql, /for select to authenticated/i);
  assert.match(sql, /for all to authenticated/i);
});

test('monthly budget boundaries follow the Asia/Shanghai calendar', () => {
  const firstMinuteOfAugustInShanghai = new Date('2026-07-31T16:00:00.000Z');
  assert.equal(monthStartKey(firstMinuteOfAugustInShanghai), '2026-08-01');
  assert.equal(monthStartDate(firstMinuteOfAugustInShanghai).toISOString(), '2026-07-31T16:00:00.000Z');
  assert.equal(nextMonthStart(firstMinuteOfAugustInShanghai).toISOString(), '2026-08-31T16:00:00.000Z');
});

test('all direct generation routes preflight the monthly budget before provider calls', async () => {
  const files = [
    'app/api/ai/chat/route.ts',
    'app/api/ai/image/route.ts',
    'app/api/ai/video/route.ts',
    'app/api/creator/chat/route.ts',
    'app/api/creator/videos/[id]/confirm/route.ts',
    'lib/creator/image-confirm-route.ts',
  ];
  for (const file of files) {
    const source = await readFile(path.join(root, file), 'utf8');
    assert.match(source, /assertMonthlyBudgetAvailable/);
  }
});
