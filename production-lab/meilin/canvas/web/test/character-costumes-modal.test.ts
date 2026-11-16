import { expect, test } from "bun:test";
import { resolve } from "node:path";
test("服装造型选择与确认通过真实 React 事件链路，测试替身不影响其他组件",()=>{
    const result=Bun.spawnSync([process.execPath,"test","./test/fixtures/character-costumes-modal.harness.tsx"],{cwd:resolve(import.meta.dir,".."),timeout:20000});
    const output=new TextDecoder().decode(result.stdout)+new TextDecoder().decode(result.stderr);
    expect(result.exitCode,output).toBe(0);expect(output).toContain("1 pass");expect(output).toContain("0 fail");
});
