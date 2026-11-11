import { expect, test } from "bun:test";
import { resolve } from "node:path";
test("镜头内换装通过实际 React 选择、校验、保存与取消事件链路",()=>{
    const result=Bun.spawnSync([process.execPath,"test","./test/fixtures/shot-costume-timeline-modal.harness.tsx"],{cwd:resolve(import.meta.dir,".."),timeout:20000});
    const output=new TextDecoder().decode(result.stdout)+new TextDecoder().decode(result.stderr);
    expect(result.exitCode,output).toBe(0);expect(output).toContain("1 pass");expect(output).toContain("0 fail");
});
