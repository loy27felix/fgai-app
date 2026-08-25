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

  assert.match(ui, /今天想创作什么？/);
  assert.match(ui, /新对话/);
  assert.match(ui, /独立生图/);
  assert.match(ui, /视频画布/);
  assert.match(ui, /href="\/creator\/video"/);
  assert.doesNotMatch(ui, /disabled[^>]*title="下一模块接入"/);
  assert.match(ui, /\/api\/creator\/chat/);
  assert.match(projectBoard, /href:\s*"\/creator"|"\/creator"/);
});

test('infinite video canvas treats connected images as reference media', () => {
  const canvas = fs.readFileSync(
    path.join(process.cwd(), 'components/creator/InfiniteCanvasWorkspace.tsx'),
    'utf8',
  );

  assert.match(canvas, /role: file\.type\.startsWith\("video\/"\) \? "reference_video" : "reference_image"/);
  assert.doesNotMatch(canvas, /index === 0 \? "first_frame" : "reference_image"/);
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
test('reference canvas mounts the full source navigation and owns Seedance video calls', () => {
  const host = fs.readFileSync(
    path.join(process.cwd(), 'components/creator/InfiniteCanvasReferenceHost.tsx'),
    'utf8',
  );
  const video = fs.readFileSync(
    path.join(process.cwd(), 'reference/infinite-canvas/src/services/api/video.ts'),
    'utf8',
  );

  for (const page of ['HomePage', 'CanvasPage', 'ImagePage', 'VideoPage', 'PromptsPage', 'AssetsPage', 'ConfigPage']) {
    assert.match(host, new RegExp(`<Route path=.*${page}`));
  }
  assert.match(host, /UserLayout/);
  assert.match(video, /kind === "video" \? "reference_video" : kind === "audio" \? "reference_audio" : "reference_image"/);
  assert.doesNotMatch(video, /index === 0 \? "first_frame" : "reference_image"/);
  assert.match(video, /FG_VIDEO_MODELS/);
});

test('transport-interrupted video submissions stop canvas polling and surface reconciliation', () => {
  const confirmRoute = fs.readFileSync(
    path.join(process.cwd(), 'app/api/creator/videos/[id]/confirm/route.ts'),
    'utf8',
  );
  const project = fs.readFileSync(
    path.join(process.cwd(), 'reference/infinite-canvas/src/pages/canvas/project.tsx'),
    'utf8',
  );
  const videoApi = fs.readFileSync(
    path.join(process.cwd(), 'reference/infinite-canvas/src/services/api/video.ts'),
    'utf8',
  );
  const standaloneCanvas = fs.readFileSync(
    path.join(process.cwd(), 'components/creator/InfiniteCanvasWorkspace.tsx'),
    'utf8',
  );

  assert.match(confirmRoute, /SUBMIT_STATUS_UNKNOWN/);
  assert.match(confirmRoute, /provider_submit_transport_failed/);
  assert.match(confirmRoute, /manual_reconciliation_required/);
  assert.match(project, /task\.status === "awaiting_reconciliation"/);
  assert.match(project, /已停止自动等待/);
  assert.match(videoApi, /task\.status === "awaiting_reconciliation"/);
  assert.match(standaloneCanvas, /task\.status === "awaiting_reconciliation"/);
  assert.match(standaloneCanvas, /for \(;;\)/);
});

test('new creative workflow skills are available to the in-product selector', () => {
  const skillData = fs.readFileSync(path.join(process.cwd(), 'lib/skillData.ts'), 'utf8');
  const expected = [
    ['odyssey-photo-diptych', 'odyssey-photo-diptych.md'],
    ['starryear-abstract-quartet', 'starryear-abstract-quartet.md'],
    ['starryear-threefold-memory', 'starryear-threefold-memory.md'],
    ['xiaotang-aigc-tvc-sop', 'xiaotang-aigc-tvc-sop.md'],
    ['xiaotang-ai-prompt-architect', 'xiaotang-ai-prompt-architect.md'],
  ];

  for (const [id, file] of expected) {
    assert.match(skillData, new RegExp(id));
    const source = fs.readFileSync(path.join(process.cwd(), 'public/skills', file), 'utf8');
    assert.ok(source.length > 300, `${file} should include a usable workflow prompt`);
  }
});
