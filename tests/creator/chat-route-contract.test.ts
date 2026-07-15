import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('creator chat persists both sides and only calls the text adapter', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'app/api/creator/chat/route.ts'),
    'utf8',
  );

  assert.match(source, /chatWithTextModel/);
  assert.match(source, /creator_messages/);
  assert.match(source, /workspaceId/);
  assert.doesNotMatch(source, /generateImage|createVideoTask|image-client|video-client/);
});
