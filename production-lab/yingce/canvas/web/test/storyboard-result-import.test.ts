import { expect, test } from "bun:test";
import { importSavedChapterStoryboard, chapterStoryboardWasImported } from "@/pages/projects/detail/storyboard-result-import";
import type { GenerationTask } from "@/services/api/task-center";
import type { ProjectUnitWorkspace, ProjectAsset } from "@/services/api/projects";
import {automaticStoryboardReferenceChoices} from "@/pages/projects/detail/chapter-storyboard-production";

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

test("automatic import repairs sound dialogue, selects six references, writes and reads back without a review dialog",async()=>{
 const f=fixture(),raw=JSON.parse(JSON.parse(f.task.resultJson!).text);
 raw.rows[0].dialogue="Evan: Stay.";raw.rows[0].videoMotionPrompt="【声音设计】\n环境底声：雨声。\n对白：\nMia: Go.";
 f.task.resultJson=JSON.stringify({text:JSON.stringify(raw)});const original=f.task.resultJson;
 let actual:any;
 const replace=f.deps.replace;f.deps.replace=async(p,c,shots,ids)=>{actual=shots;return replace(p,c,shots,ids);};
 const result=await importSavedChapterStoryboard("project","chapter",[f.task],automaticStoryboardReferenceChoices,[],f.deps);
 expect(f.writes).toBe(1);expect(result.shots.length).toBe(1);expect(actual[0].revision.videoPrompt).toContain("Evan: Stay.");
 expect(actual[0].revision.videoPrompt).not.toContain("Mia: Go.");expect(actual[0].assetVersionIds.length).toBe(6);expect(f.task.resultJson).toBe(original);
});

test("complete saved format-failed draft is automatically imported and source status remains unchanged",async()=>{
 const f=fixture();f.task.status="failed";f.task.errorCode="invalid_storyboard_result";f.task.textDraft=JSON.parse(f.task.resultJson!).text.replace('"rows":','"rows":\n');f.task.resultJson="{}";
 const result=await importSavedChapterStoryboard("project","chapter",[f.task],automaticStoryboardReferenceChoices,[],f.deps);
 expect(f.writes).toBe(1);expect(chapterStoryboardWasImported([f.task],"chapter",result)).toBe(true);expect(f.task.status).toBe("failed");
});

test("foreground save and refresh recovery completing together do not overwrite or report a false failure",async()=>{
 const f=fixture();const original=f.deps.replace;
 f.deps.replace=async(p,c,shots,ids)=>{await original(p,c,shots,ids);throw Error("simulated concurrent response loss");};
 const result=await importSavedChapterStoryboard("project","chapter",[f.task],automaticStoryboardReferenceChoices,[],f.deps);
 expect(result.shots.length).toBe(1);expect(f.writes).toBe(1);
 await importSavedChapterStoryboard("project","chapter",[f.task],automaticStoryboardReferenceChoices,[],f.deps);
 expect(f.writes).toBe(1);
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

test("a failed format draft imports only after an explicit complete edit and keeps its original task failed",async()=>{
    const f=fixture();f.task.status="failed";f.task.textDraft="{\"rows\":[";
    const corrected=JSON.parse(f.task.resultJson!).text;f.task.resultJson="{}";
    await expect(importSavedChapterStoryboard("project","chapter",[f.task],async()=>undefined,[],f.deps)).rejects.toThrow("尚未全部成功");
    expect(f.writes).toBe(0);
    await importSavedChapterStoryboard("project","chapter",[f.task],async()=>({0:f.assets.slice(0,6).map(a=>a.id)}),[],f.deps,{task:corrected});
    expect(f.writes).toBe(1);expect(f.task.status).toBe("failed");expect(f.task.textDraft).toBe("{\"rows\":[");
});
