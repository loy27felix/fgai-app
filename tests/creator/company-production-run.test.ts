import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceCompanyProductionStage,
  createCompanyProductionState,
  nextCompanyProductionStage,
} from "@/lib/creator/company-production-run";

test("a production keeps every approval gate in order before rendering", () => {
  let state = createCompanyProductionState({ title: "Dark Pop 女团 MV", assemble: true });

  assert.equal(state.stage, "research");
  assert.equal(nextCompanyProductionStage(state), "research");

  state = advanceCompanyProductionStage(state, "research");
  assert.equal(state.stage, "script");
  state = advanceCompanyProductionStage(state, "script");
  assert.equal(state.stage, "visuals");
  state = advanceCompanyProductionStage(state, "visuals");
  assert.equal(state.stage, "plan");
  state = advanceCompanyProductionStage(state, "plan");
  assert.equal(state.stage, "render");
});

test("a production without final assembly completes after all video segments", () => {
  let state = createCompanyProductionState({ title: "产品分镜", assemble: false });
  for (const stage of ["research", "script", "visuals", "plan", "render"] as const) {
    state = advanceCompanyProductionStage(state, stage);
  }

  assert.equal(state.stage, "complete");
  assert.equal(nextCompanyProductionStage(state), null);
});

test("a production cannot skip an approval gate", () => {
  const state = createCompanyProductionState({ title: "不能跳步", assemble: true });

  assert.throws(() => advanceCompanyProductionStage(state, "plan"), /请先确认调研阶段/);
});
