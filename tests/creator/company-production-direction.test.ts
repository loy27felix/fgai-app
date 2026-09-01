import assert from "node:assert/strict";
import test from "node:test";

import { parseCompanyProductionDirections } from "../../lib/creator/company-production-direction";

test("a direction response always gives the director three selectable routes", () => {
  const directions = parseCompanyProductionDirections("not json", "为互动玩具做一支 15 秒视频");

  assert.equal(directions.length, 3);
  assert.equal(new Set(directions.map((direction) => direction.id)).size, 3);
  assert.ok(directions.every((direction) => direction.title && direction.hook && direction.treatment));
});

test("a direction response keeps the model's distinct routes editable", () => {
  const directions = parseCompanyProductionDirections(JSON.stringify({
    directions: [
      { title: "惊喜发现", hook: "第一次按下按键", treatment: "孩子的近景反应", visualLanguage: "明亮玩具广告" },
      { title: "节奏挑战", hook: "跟着灯光完成旋律", treatment: "连续动作挑战", visualLanguage: "快速剪辑与节拍" },
      { title: "亲子合奏", hook: "家长加入演奏", treatment: "关系与收尾", visualLanguage: "温暖生活纪录片" },
    ],
  }), "互动玩具视频");

  assert.equal(directions[1].title, "节奏挑战");
  assert.match(directions[2].visualLanguage, /温暖/);
});
