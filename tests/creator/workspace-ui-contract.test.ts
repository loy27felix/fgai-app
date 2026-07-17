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
  assert.match(ui, /href="\/creator\/video"/);
  assert.doesNotMatch(ui, /disabled[^>]*title="下一模块接入"/);
  assert.match(ui, /\/api\/creator\/chat/);
  assert.match(projectBoard, /href:\s*"\/creator"|"\/creator"/);
});

test('standalone video workspace exposes continuous duration and readable controls', () => {
  const video = fs.readFileSync(
    path.join(process.cwd(), 'components/creator/CreatorVideoWorkspace.tsx'),
    'utf8',
  );

  assert.match(video, /const DURATION_MIN = 4/);
  assert.match(video, /const DURATION_MAX = 15/);
  assert.match(video, /type="range"/);
  assert.match(video, /min=\{DURATION_MIN\}/);
  assert.match(video, /max=\{DURATION_MAX\}/);
  assert.match(video, /adaptive-choice/);
  assert.match(video, /video-workspace\[data-theme="light"\]/);
  assert.match(video, /controls select option/);
});
