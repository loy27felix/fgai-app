import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('AI creator is an additive project-independent workspace', () => {
  const ui = fs.readFileSync(
    path.join(process.cwd(), 'components/creator/CreatorWorkspace.tsx'),
    'utf8',
  );
  const projectBoard = fs.readFileSync(
    path.join(process.cwd(), 'components/ProjectBoard.tsx'),
    'utf8',
  );

  assert.match(ui, /AI 创作台/);
  assert.match(ui, /新对话/);
  assert.match(ui, /独立生图/);
  assert.match(ui, /视频画布/);
  assert.match(ui, /\/api\/creator\/chat/);
  assert.match(projectBoard, /href:\s*"\/creator"|"\/creator"/);
});
