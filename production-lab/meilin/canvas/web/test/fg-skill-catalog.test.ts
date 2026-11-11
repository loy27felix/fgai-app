import {expect,test} from 'bun:test';
import {createFGSkillCatalog} from '../src/services/fg-skill-catalog';
import {createSkillRuntime} from '../src/services/skill-runtime';
import type {Skill,SkillList} from '../src/services/api/skills';

const skill=(id:string,isAdded=false)=>({skillId:id,skillName:id,isAdded,description:'制作流程',versionId:'v1',version:'1',status:1}) as Skill;

test('catalog includes uninstalled public skills, all pages, and personal skills without installing',async()=>{
 const reads:string[]=[];
 const catalog=createFGSkillCatalog({
  list:async input=>{reads.push(`${input?.scope}:${input?.page}`);return {skills:input?.scope==='public'?[skill(input.page===1?'story':'shots')]:[skill('private')],hasMore:input?.scope==='public'&&input.page===1} as SkillList;},
  added:async()=>({skills:[skill('story',true)]}),
  add:async()=>{throw new Error('catalog read must not install');},
 });
 const values=await catalog.list();
 expect(values.map(s=>s.skillId).sort()).toEqual(['private','shots','story']);
 expect(values.find(s=>s.skillId==='story')?.isAdded).toBe(true);
 expect(reads).toEqual(['public:1','created:1','public:2']);
});

test('only selected skills are installed and their real files reach runtime context',async()=>{
 const added=[skill('installed',true)];const writes:string[]=[];
 const catalog=createFGSkillCatalog({list:async()=>{throw new Error('unused');},added:async()=>({skills:added}),add:async id=>{writes.push(id);const saved=skill(id,true);added.push(saved);return {skill:saved};}});
 const selected=await catalog.activate(['shots','installed','shots'],[skill('shots'),skill('unused'),...added]);
 expect(writes).toEqual(['shots']);
 const runtime=createSkillRuntime({getFile:async()=>({file:{file:{path:'SKILL.md',kind:'markdown',mimeType:'text/markdown',size:15,sha256:'test'},content:'先拆解分镜再确认',binary:false}}),listFiles:async()=>({files:[]})});
 const result=await runtime.prepare({profile:'creation',prompt:'@[skill:shots] 给故事做分镜',skills:selected});
 expect(result.provenance.skillIds).toEqual(['shots']);
 expect(result.prompt).toContain('先拆解分镜再确认');
});

test('failed installation is not presented as a loaded skill',async()=>{
 const catalog=createFGSkillCatalog({list:async()=>{throw new Error('unused');},added:async()=>({skills:[]}),add:async()=>{throw new Error('服务器拒绝加载');}});
 await expect(catalog.activate(['shots'],[skill('shots')])).rejects.toThrow('服务器拒绝加载');
});

test('unavailable skill and more than four choices fail before installing',async()=>{
 let writes=0;
 const catalog=createFGSkillCatalog({list:async()=>{throw new Error('unused');},added:async()=>({skills:[]}),add:async()=>{writes++;return {skill:skill('shots',true)};}});
 await expect(catalog.activate(['missing'],[skill('shots')])).rejects.toThrow('技能已下架');
 await expect(catalog.activate(['1','2','3','4','5'],['1','2','3','4','5'].map(id=>skill(id)))).rejects.toThrow('最多选择 4 个');
 expect(writes).toBe(0);
});
