import test from "node:test";
import assert from "node:assert/strict";
import { canAccessProductionLab } from "../lib/production-lab/access-policy";

test("production lab is available to authenticated platform roles and can be disabled", () => {
  assert.equal(canAccessProductionLab("superadmin", undefined), true);
  assert.equal(canAccessProductionLab("admin", undefined), true);
  assert.equal(canAccessProductionLab("user", undefined), true);
  assert.equal(canAccessProductionLab(undefined, undefined), false);
  assert.equal(canAccessProductionLab("superadmin", "false"), false);
});
