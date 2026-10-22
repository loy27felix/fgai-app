import {expect,test} from 'bun:test';
test('character voice generation submits the selected reference and rejects unusable samples',async()=>{
 const child=Bun.spawn([process.execPath,'test/helpers/character-voice-reference.worker.tsx'],{cwd:import.meta.dir+'/..',stdout:'pipe',stderr:'pipe'});
 const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
 expect({code,stderr:code?stderr:undefined}).toEqual({code:0,stderr:undefined});
 expect(stdout).toContain('"selectedSampleSubmitted":true');
},30000);
