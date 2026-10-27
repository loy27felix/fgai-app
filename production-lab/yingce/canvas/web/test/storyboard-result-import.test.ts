import { expect, test } from "bun:test";
import { importSavedChapterStoryboard, chapterStoryboardWasImported } from "@/pages/projects/detail/storyboard-result-import";
import type { GenerationTask } from "@/services/api/task-center";
import type { ProjectUnitWorkspace, ProjectAsset } from "@/services/api/projects";

function fixture() {
    const assets = Array.from({length:7},(_,i)=>({id:`p${i}`,primaryVersionId:`v${i}`,title:`道具${i}`,category:"prop",mediaType:"image"})) as ProjectAsset[];
    const task = {id:"task",projectId:"project",type:"canvas_text",status:"succeeded",prompt:"",attempts:1,createdAt:"2026-10-26T10:00:00Z",updatedAt:"2026-10-26T10:02:00Z",inputJson:JSON.stringify({metadata:{chapterId:"chapter",source:"short-drama-chapter-storyboard",dramaAssetIds:assets.map(a=>a.id)}}),resultJson:JSON.stringify({text:JSON.stringify({rows:[{plotDescription:"展示道具",durationSeconds:15,dialogue:"",characters:[],assetBindings:assets.map(a=>({nodeId:a.id,role:"prop",priority:1})),videoMotionPrompt:"道具展示"}]})})} as GenerationTask;
    const empty = {unit:{id:"chapter",updatedAt:"2026-10-25T10:00:00Z"},shots:[],shotRevisions:[]} as unknown as ProjectUnitWorkspace;
    let current=empty, writes=0;
    const deps = {queryTask:async()=>task,assets:async()=>assets,workspace:async()=>current,replace:async(_p:string,_c:string,shots:any[],expected?:string[])=>{expect(expected).toEqual([]);writes++;current={...empty,shots:[{id:"shot",unitId:"chapter",currentRevisionId:"revision"}] as any,shotRevisions:[{id:"revision",actionBeatsJson:JSON.stringify(shots[0].revision.actionBeats)}] as any};return{shots:current.shots};}};
    return {task,assets,empty,deps,get writes(){return writes;}};
}

test("completed output reaches reference review, normal write and read-back before it is considered imported",async()=>{
    const f=fixture();let reviewed=false;
    const result=await importSavedChapterStoryboard("project","chapter",[f.task],async(rows,assets)=>{reviewed=true;expect(rows.length).toBe(1);expect(assets.length).toBe(7);return{0:assets.slice(0,6).map(a=>a.id)};},[],f.deps);
    expect(reviewed).toBe(true);expect(f.writes).toBe(1);expect(result.shots.length).toBe(1);
    expect(chapterStoryboardWasImported([f.task],"chapter",result)).toBe(true);
});
test("an unrelated newly edited shot is not evidence that the model result was imported",()=>{
    const f=fixture();
    expect(chapterStoryboardWasImported([f.task],"chapter",{shots:[{id:"manual",unitId:"chapter",updatedAt:"2026-10-26T12:00:00Z"}] as any,shotRevisions:[]})).toBe(false);
});
test("an imported collaborator batch is not mistaken for a pending older private task",()=>{
    const f=fixture();
    const data={shots:[{id:"new",unitId:"chapter",currentRevisionId:"r",createdAt:"2026-10-26T12:00:00Z"}] as any,shotRevisions:[{id:"r",actionBeatsJson:JSON.stringify([{type:"chapter_storyboard_import",batchId:"collaborator",taskId:"other",expectedRows:1,createdAt:"2026-10-26T11:00:00Z"}])}] as any};
    expect(chapterStoryboardWasImported([f.task],"chapter",data)).toBe(true);
    expect(chapterStoryboardWasImported([{...f.task,createdAt:"2026-10-26T13:00:00Z"}],"chapter",data)).toBe(false);
});
test("existing work or changed script cannot be silently replaced during recovery",async()=>{
    const f=fixture();f.deps.workspace=async()=>({...f.empty,shots:[{id:"new",unitId:"chapter"}] as any});
    await expect(importSavedChapterStoryboard("project","chapter",[f.task],async()=>undefined,[],f.deps)).rejects.toThrow("发生变化");
    expect(f.writes).toBe(0);
    f.deps.workspace=async()=>({...f.empty,unit:{...f.empty.unit,updatedAt:"2026-10-26T11:00:00Z"}});
    await expect(importSavedChapterStoryboard("project","chapter",[f.task],async()=>undefined,[],f.deps)).rejects.toThrow("原文");
    expect(f.writes).toBe(0);
});
test("reviewed saved prompt edits keep the provider original and still pass the normal import checks",async()=>{
    const f=fixture(), original=f.task.resultJson;
    const document=JSON.parse(JSON.parse(original!).text);document.rows[0].videoMotionPrompt="修正后的时间轴与原剧情";
    const result=await importSavedChapterStoryboard("project","chapter",[f.task],async()=>({0:f.assets.slice(0,6).map(a=>a.id)}),[],f.deps,{task:JSON.stringify(document)});
    expect(f.task.resultJson).toBe(original);expect(f.writes).toBe(1);
    expect(JSON.parse(result.shotRevisions[0].actionBeatsJson)).toContainEqual({type:"storyboard_manual_result_edit",taskIds:["task"]});
    const invalid=fixture();document.rows[0].assetBindings=[{nodeId:"not-in-project",role:"prop",priority:1}];
    // The source snapshot and ordinary reference validation remain authoritative.
    await expect(importSavedChapterStoryboard("project","chapter",[invalid.task],async()=>undefined,[],invalid.deps,{task:JSON.stringify(document)})).rejects.toThrow();
    expect(invalid.writes).toBe(0);
});
