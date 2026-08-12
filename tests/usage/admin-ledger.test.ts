import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('admin usage dashboard reads the trusted ledger and exposes cost transparency', () => {
  const page = fs.readFileSync(path.join(process.cwd(), 'app/admin/page.tsx'), 'utf8');
  const consoleSource = fs.readFileSync(path.join(process.cwd(), 'components/AdminConsole.tsx'), 'utf8');

  assert.match(page, /from\(["']ai_usage_ledger["']\)/);
  assert.doesNotMatch(page, /from\(["']ai_usage["']\)/);
  assert.match(consoleSource, /estimated_cost_usd/);
  assert.match(consoleSource, /cost_source/);
  assert.match(consoleSource, /待定价/);
  assert.match(consoleSource, /按用户/);
  assert.match(consoleSource, /用户 × 模型/);
  assert.match(consoleSource, /type="month"/);
  assert.match(consoleSource, /供应商已确认费用/);
  assert.match(consoleSource, /额度占用/);
  assert.match(consoleSource, /reconcileUsageCost/);
  assert.doesNotMatch(page, /withKnownMediaEstimate/);
});
