import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VIDEO_MODULES,
  validateVideoPrompt,
  bindVideoReferences,
} from "./video-prompt-contract.mjs";
const draft = () =>
  `神殿反击\n20秒｜多镜头｜奇幻动作\n` +
  VIDEO_MODULES.map(
    (h, i) =>
      `【${i === 9 ? "20秒" + h : h}】\n` +
      (i === 0
        ? "时长：20秒。"
        : i === 9
          ? "0—8秒｜发现\n人物动作：男主右手拉开锁链。\n镜头运动：镜头后退一米。\n背景：守卫举火把。\n8—20秒｜反击\n人物动作：男主转身松开右手锁链。\n镜头运动：切至正面建立位置。\n背景：石门沿原轨道合拢。"
          : "本片具体设定。"),
  ).join("\n");
test("twelve modules and simultaneous timeline cover the exact approved duration", () =>
  assert.equal(validateVideoPrompt(draft(), { seconds: 20 }).ok, true));
test("rejects a missing background within any individual time interval", () =>
  assert.match(
    validateVideoPrompt(draft().replace("背景：守卫举火把。", ""), {
      seconds: 20,
    }).errors.join(),
    /0—8秒缺少背景/,
  ));
test("rejects gaps, shortened duration, reordered modules and unbound asset references", () => {
  const bad =
    draft().replace("8—20秒", "9—15秒").replace("【光影】", "【不存在】") +
    "\n@[asset:foreign]";
  const errors = validateVideoPrompt(bad, {
    seconds: 20,
    referenceCodes: ["own"],
  }).errors.join();
  assert.match(errors, /间隙/);
  assert.match(errors, /应为20秒/);
  assert.match(errors, /缺少【光影】/);
  assert.match(errors, /素材未绑定/);
});
test("does not accept stock template placeholders or a misleading headline duration", () =>
  assert.equal(
    validateVideoPrompt(draft().replace("20秒｜", "15秒｜") + "[项目名称]", {
      seconds: 20,
    }).ok,
    false,
  ));
test("actual upload order compiles stable asset tokens into model-readable references", () => {
  const text = draft() + "\n@[asset:hero]看向@[asset:temple]。";
  const bound = bindVideoReferences(text, [
    { code: "temple", name: "神殿" },
    { code: "hero", name: "男主" },
  ]);
  assert.match(bound, /@图片1＝神殿；@图片2＝男主/);
  assert.match(bound, /@图片2看向@图片1/);
  assert.doesNotMatch(bound, /@\[asset:/);
  assert.throws(
    () => bindVideoReferences(text, [{ code: "hero", name: "男主" }]),
    /未绑定素材/,
  );
});
test("ratio and resolution cannot contradict the generation settings", () => {
  const text = draft().replace(
    "时长：20秒。",
    "时长：20秒。\n画幅与帧率：9:16，480P，24fps。",
  );
  assert.equal(
    validateVideoPrompt(text, {
      seconds: 20,
      ratio: "9:16",
      resolution: "480p",
    }).ok,
    true,
  );
  assert.match(
    validateVideoPrompt(text, {
      seconds: 20,
      ratio: "16:9",
      resolution: "720p",
    }).errors.join(),
    /画幅/,
  );
  assert.match(
    validateVideoPrompt(text, {
      seconds: 20,
      ratio: "16:9",
      resolution: "720p",
    }).errors.join(),
    /画质/,
  );
});
