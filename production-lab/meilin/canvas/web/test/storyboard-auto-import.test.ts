import {test,expect} from "bun:test";
test("the mounted chapter recovery panel imports a usable saved batch without clicking review",async()=>{
 const child=Bun.spawn([process.execPath,"test/helpers/storyboard-auto-import.worker.tsx"],{cwd:import.meta.dir+"/..",stdout:"pipe",stderr:"pipe"});
 const [code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
 expect({code,error:code?err:undefined}).toEqual({code:0,error:undefined});expect(out).toContain('"automaticallyImportedWithoutClicks":true');
},30000);
