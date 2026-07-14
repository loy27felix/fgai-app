import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBgmShotContext } from '../lib/bgm';

test('BGM context follows scene and shot order and includes directing beats', () => {
  const context = buildBgmShotContext('ep-1', [
    { id: 'scene-2', episode_id: 'ep-1', idx: 2 },
    { id: 'scene-1', episode_id: 'ep-1', idx: 1 },
  ], [
    { id: 'b', scene_id: 'scene-1', no: '2', title: 'turn', duration_s: 5, script_beat: { 动作: '回头', 情绪: '警觉' } },
    { id: 'a', scene_id: 'scene-1', no: '1', title: 'enter', duration_s: 4, script_beat: { 画面: '走进空屋' } },
    { id: 'c', scene_id: 'scene-2', no: '3', duration_s: 6, video_prompt: { text: 'slow push in' } },
  ]);
  assert.match(context, /^镜头 1 \| 4s/);
  assert.ok(context.indexOf('镜头 1') < context.indexOf('镜头 2'));
  assert.ok(context.indexOf('镜头 2') < context.indexOf('镜头 3'));
  assert.match(context, /动作：回头/);
  assert.match(context, /情绪：警觉/);
  assert.match(context, /视频意图：slow push in/);
});
