import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const routePath = path.join(process.cwd(), 'app/api/local/db/route.ts');

test('local database gateway uses an allowlist and user ownership scope', () => {
  assert.equal(fs.existsSync(routePath), true);
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /const allowedTables = new Set/);
  assert.match(source, /const userScopedTables = new Set\(\["custom_presets", "chat_sessions", "canvases"\]\)/);
  assert.match(source, /operation\.eq\("user_id", user\.id\)/);
  assert.match(source, /if \(!user\)/);
});
