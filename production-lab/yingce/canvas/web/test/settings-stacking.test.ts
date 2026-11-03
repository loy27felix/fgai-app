import {test,expect} from "bun:test";
test("generation settings inherit the actual modal z-index even above the old fixed layer",async()=>{
 const child=Bun.spawn([process.execPath,"test/helpers/settings-stacking.worker.tsx"],{cwd:import.meta.dir+"/..",stdout:"pipe",stderr:"pipe"});
 const [code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
 expect({code,error:code?err:undefined}).toEqual({code:0,error:undefined});expect(out).toContain('"nestedModalSettingsVisible":true');
},30000);
