import { expect, test } from "bun:test";
import { resolve } from "node:path";
test("media cache leases, bounded memory and account transitions", () => {
    const r=Bun.spawnSync([process.execPath,"test","./test/fixtures/resource-cache-leases.harness.ts"],{cwd:resolve(import.meta.dir,".."),timeout:20000});
    expect(r.exitCode,new TextDecoder().decode(r.stdout)+new TextDecoder().decode(r.stderr)).toBe(0);
},25000);
