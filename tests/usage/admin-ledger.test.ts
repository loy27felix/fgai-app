import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('admin usage dashboard reads the trusted ledger with simple success/failure accounting', () => {
  const page = fs.readFileSync(path.join(process.cwd(), 'app/admin/page.tsx'), 'utf8');
  const consoleSource = fs.readFileSync(path.join(process.cwd(), 'components/AdminConsole.tsx'), 'utf8');

  assert.match(page, /from\(["']ai_usage_ledger["']\)/);
  assert.doesNotMatch(page, /from\(["']ai_usage["']\)/);
  assert.match(consoleSource, /estimated_cost_usd/);
  assert.match(consoleSource, /成功生成/);
  assert.match(consoleSource, /生成失败/);
  assert.match(consoleSource, /失败任务费用固定为 ¥0/);
  assert.match(consoleSource, /按用户/);
  assert.match(consoleSource, /用户 × 模型/);
  assert.match(consoleSource, /type="month"/);
  assert.doesNotMatch(page, /historicalUsage/);
  assert.doesNotMatch(consoleSource, /reconcileUsageCost/);
  assert.doesNotMatch(page, /withKnownMediaEstimate/);
});
