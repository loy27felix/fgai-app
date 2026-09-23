import test from "node:test";
import assert from "node:assert/strict";
import { canAccessProductionLab } from "../lib/production-lab/access-policy";

test("production lab is available only to superadmins and can be disabled by the server", () => {
  assert.equal(canAccessProductionLab("superadmin", undefined), true);
  assert.equal(canAccessProductionLab("admin", undefined), false);
  assert.equal(canAccessProductionLab("user", undefined), false);
  assert.equal(canAccessProductionLab(undefined, undefined), false);
  assert.equal(canAccessProductionLab("superadmin", "false"), false);
});
