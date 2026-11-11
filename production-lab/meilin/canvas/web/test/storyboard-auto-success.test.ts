import {expect,test} from "bun:test";
import {chapterStoryboardFromGenerationTasks,waitForStoryboardPart} from "@/pages/projects/detail/project-chapter-ai";
import {originalEnglishDialogue} from "@/services/api/project-language";
import type {GenerationTask} from "@/services/api/task-center";

function task(dialogue:string,prompt:string,raw?:string):GenerationTask {
 return {id:"automatic",projectId:"project",type:"canvas_text",status:"succeeded",attempts:1,prompt:"",createdAt:"2026-11-03T01:00:00Z",updatedAt:"2026-11-03T01:01:00Z",inputJson:JSON.stringify({metadata:{source:"short-drama-chapter-storyboard",chapterId:"chapter",projectLanguagePolicy:{version:1,spoken:"en-original",screenText:"no-zh"},originalEnglishDialogue:originalEnglishDialogue("艾拉：别走。\nElla: Don't go.")}}),resultJson:JSON.stringify({text:raw||JSON.stringify({rows:[{durationSeconds:15,plotDescription:"艾拉挽留对方",dialogue,videoMotionPrompt:prompt,characters:[],assetBindings:[]}]})})};
}
test("ordinary automatic chapter parsing restores the exact original English cue and sound block without changing provider output",()=>{
 const t=task("艾拉：别走。","【声音设计】\n环境底声：夜风。\n对白：\nWrong actor: Please stay.");const original=t.resultJson;
 const row=chapterStoryboardFromGenerationTasks([t]).rows[0];
 expect(row.dialogue).toBe("Ella：Don't go.");expect(row.videoMotionPrompt).toContain("Ella：Don't go.");
 expect(row.videoMotionPrompt).toContain("环境底声：夜风。");expect(row.videoMotionPrompt).not.toContain("Please stay.");
 expect(t.resultJson).toBe(original);expect(row.sourceTask?.automaticRepairs?.length).toBeGreaterThan(0);
});
test("automatic repair never guesses a rewritten English line or imports an unfinished document",()=>{
 expect(()=>chapterStoryboardFromGenerationTasks([task("Ella: You must stay.","【声音设计】\n对白：Ella: You must stay.")])).toThrow();
 expect(()=>chapterStoryboardFromGenerationTasks([task("","",'{"rows":[{"durationSeconds":15')])).toThrow();
});
test("complete JSON with raw string line breaks and trailing commas imports with identical spoken text",()=>{
 const raw='{"rows":[{"durationSeconds":15,"dialogue":"Ella: Don\'t go.","videoMotionPrompt":"【声音设计】\n对白：\nElla: Don\'t go.","characters":[],"assetBindings":[],},],}';
 expect(chapterStoryboardFromGenerationTasks([task("","",raw)]).rows[0].dialogue).toBe("Ella: Don't go.");
});
test("failed complete draft recovers locally without retrying, changing its status, or charging a new generation",async()=>{
 const original=task("Ella: Don't go.","【声音设计】\n对白：Wrong: Stay.");
 const failed={...original,status:"failed" as const,textDraft:JSON.parse(original.resultJson!).text,resultJson:"{}",errorCode:"invalid_storyboard_result"};let retries=0;
 const got=await waitForStoryboardPart(failed,undefined,{wait:async()=>{throw Error("invalid format");},query:async()=>failed,retry:async()=>{retries++;return failed;}});
 expect(got.status).toBe("succeeded");expect(failed.status).toBe("failed");expect(retries).toBe(0);
 expect(chapterStoryboardFromGenerationTasks([got]).rows[0].videoMotionPrompt).toContain("Ella: Don't go.");
});
test("automatic retry is limited to one definitively failed format batch; upstream uncertainty never retries",async()=>{
 const initial=task("",""),failed={...initial,status:"failed" as const,errorCode:"invalid_storyboard_result",textDraft:'{"rows":['},next={...initial,id:"retry",retryOf:initial.id};let calls=0;
 await expect(waitForStoryboardPart(initial,undefined,{wait:async()=>{throw Error("incomplete");},query:async id=>id===next.id?{...failed,id:next.id,retryOf:initial.id}:failed,retry:async()=>{calls++;return next;}})).rejects.toThrow("incomplete");
 expect(calls).toBe(1);
 calls=0;
 await expect(waitForStoryboardPart(initial,undefined,{wait:async()=>{throw Error("upstream EOF");},query:async()=>({...failed,errorCode:"provider_request_unlogged"}),retry:async()=>{calls++;return next;}})).rejects.toThrow("upstream EOF");
 expect(calls).toBe(0);
});

test("an ended batch with genuinely rewritten English is corrected once using its validation issue",async()=>{
 const wrong=task("Ella: You must stay.","【声音设计】\n对白：Ella: You must stay."),fixed={...task("Ella: Don't go.","【声音设计】\n对白：Ella: Don't go."),id:"fixed"};let repairs=0,waits=0;
 const result=await waitForStoryboardPart(wrong,undefined,{wait:async()=>++waits===1?wrong:fixed,query:async()=>wrong,retry:async()=>{throw Error("must not blindly retry");},repair:async(value,issue)=>{repairs++;expect(value.id).toBe(wrong.id);expect(issue).toContain("无法唯一对应原稿英文");return fixed;}});
 expect(repairs).toBe(1);expect(result.id).toBe("fixed");
});
