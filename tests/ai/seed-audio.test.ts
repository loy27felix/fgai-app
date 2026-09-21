import assert from "node:assert/strict";
import test from "node:test";

import { buildSeedAudioRequest, isSeedAudioModel, normalizeSeedAudioFormat, SEED_AUDIO_MODEL } from "../../lib/ai/seed-audio";

test("builds the Seed Audio 1.0 request without credentials", () => {
  const request = buildSeedAudioRequest({ prompt: "雨夜里的脚步声", instructions: "低沉、电影感", format: "opus" });
  assert.equal(request.model, SEED_AUDIO_MODEL);
  assert.equal(request.text_prompt, "雨夜里的脚步声\n\n声音指令：低沉、电影感");
  assert.equal(request.audio_config.format, "ogg_opus");
  assert.equal(request.audio_config.sample_rate, 48000);
  assert.deepEqual(request.watermark, {});
  assert.equal(JSON.stringify(request).includes("Api-Key"), false);
});

test("normalizes unsupported Seed Audio UI formats to mp3", () => {
  assert.equal(normalizeSeedAudioFormat("wav"), "wav");
  assert.equal(normalizeSeedAudioFormat("opus"), "ogg_opus");
  assert.equal(normalizeSeedAudioFormat("aac"), "mp3");
  assert.equal(isSeedAudioModel("seed-audio-1.0"), true);
  assert.equal(isSeedAudioModel("other-model"), false);
});
