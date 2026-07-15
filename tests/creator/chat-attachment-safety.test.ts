import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('chat sends transient references but never stores base64 image bodies', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'app/api/creator/chat/route.ts'),
    'utf8',
  );

  assert.match(source, /image_count: images\.length/);
  assert.match(source, /imageBytes \+ item\.length > 4_000_000/);
  assert.doesNotMatch(source, /content:\s*\{\s*text:\s*message,\s*images\s*\}/);
});
