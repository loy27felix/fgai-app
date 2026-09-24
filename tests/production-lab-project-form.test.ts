import assert from "node:assert/strict";
import test from "node:test";
import { defaultProductionGroup, formatProjectScope, formatVisualStyle, selectionValues } from "../lib/production-lab/project-form";
import { productionLabDisplayName } from "../lib/production-lab/identities";

test("project form options retain custom choices while formatting scope for prompts", () => {
  assert.deepEqual(selectionValues(["北美、拉美", "北美", "菲律宾"]), ["北美", "拉美", "菲律宾"]);
  assert.equal(formatProjectScope({ markets: ["北美", "拉美"], languages: ["英语"], channels: ["YouTube Shorts", "TikTok"] }), "市场：北美、拉美 · 语言：英语 · 渠道：YouTube Shorts、TikTok");
  assert.equal(formatProjectScope({}), "待确认");
  assert.equal(formatVisualStyle(["2D动画"], "暗黑悬疑、女性反击"), "2D动画 / 暗黑悬疑、女性反击");
});

test("selected topic group is suggested only while that group is active", () => {
  assert.equal(defaultProductionGroup("小组2", ["小组1", "小组2"]), "小组2");
  assert.equal(defaultProductionGroup("旧小组", ["小组1", "小组2"]), undefined);
  assert.equal(defaultProductionGroup(undefined, ["小组1"]), undefined);
});

test("known platform account aliases use the confirmed teammate name", () => {
  assert.equal(productionLabDisplayName(" ZIXUHAN@BEVA.COM "), "韩子续");
  assert.equal(productionLabDisplayName("newperson@beva.com"), "newperson");
});
