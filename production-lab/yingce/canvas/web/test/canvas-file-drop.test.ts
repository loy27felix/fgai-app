import {expect,test} from 'bun:test';

test('real canvas viewport and upload hook accept desktop files across child/iframe drag boundaries',async()=>{
    const child=Bun.spawn([process.execPath,'test/helpers/canvas-file-drop.worker.tsx'],{cwd:import.meta.dir+'/..',stdout:'pipe',stderr:'pipe'});
    const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
    expect({code,stderr:code?stderr:undefined}).toEqual({code:0,stderr:undefined});
    expect(stdout).toContain('"externalImageAndVideoDrop":true');
},30000);
