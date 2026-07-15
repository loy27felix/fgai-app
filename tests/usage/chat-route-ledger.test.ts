import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('existing chat route dual-writes trusted usage without changing its response contract', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'app/api/ai/chat/route.ts'),
    'utf8',
  );
  assert.match(source, /buildTextLedgerEntry/);
  assert.match(source, /recordUsageBestEffort/);
  assert.match(source, /provider: spec\.provider/);
  assert.match(source, /return NextResponse\.json\(\{ content: result\.content, usage: result\.usage \}\)/);
});
