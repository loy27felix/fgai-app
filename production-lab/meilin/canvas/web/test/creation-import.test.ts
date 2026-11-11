import {expect,test} from 'bun:test';
test('real creation and Agent composers receive pasted and dropped files without generation',async()=>{
    const child=Bun.spawn([process.execPath,'test/helpers/creation-import.worker.tsx'],{cwd:import.meta.dir+'/..',stdout:'pipe',stderr:'pipe'});
    const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
    expect({code,stderr:code?stderr:undefined}).toEqual({code:0,stderr:undefined});
    expect(stdout).toContain('"agentDropIsolation":true');
},30000);
test('asset picker filters the server library by canvas and keeps remote selections',async()=>{
    const child=Bun.spawn([process.execPath,'test/helpers/asset-canvas-filter.worker.tsx'],{cwd:import.meta.dir+'/..',stdout:'pipe',stderr:'pipe'});
    const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
    expect({code,stderr:code?stderr:undefined}).toEqual({code:0,stderr:undefined});
    expect(stdout).toContain('"crossCanvasSelection":true');
},30000);
