import {expect,test} from "bun:test";
import {readStoryboardBatchFailureMessages} from "@/pages/projects/detail/storyboard-batch-diagnostics";
import type {GenerationTask} from "@/services/api/task-center";

const summary:GenerationTask={id:"failed-1",projectId:"project-1",type:"canvas_text",status:"failed",prompt:"",attempts:1,createdAt:"2026-10-28",updatedAt:"2026-10-28",clientContext:{chapterId:"chapter-11",chapterOperation:"storyboard"}};

test("列表没有error时读取所选批次详情，展示断流原因且不发生成请求",async()=>{
 const calls:string[]=[];
 const messages=await readStoryboardBatchFailureMessages("project-1","chapter-11",[summary,{...summary,id:"running-1",status:"running"},{...summary,id:"other",projectId:"other-project"}],undefined,async id=>{
  calls.push(id);return {...summary,error:"stream error: stream ID 5; INTERNAL_ERROR; received from peer"};
 });
 expect(calls).toEqual(["failed-1"]);
 expect(messages[summary.id]).toContain("响应连接中断");
 expect(messages[summary.id]).not.toContain("任务未完成");
});

test("详情请求失败时说明读取失败，其他批次仍能显示，不显示跨章节内容",async()=>{
 const tasks=[summary,{...summary,id:"failed-2"},{...summary,id:"failed-3"}];
 const messages=await readStoryboardBatchFailureMessages("project-1","chapter-11",tasks,undefined,async id=>{
  if(id==="failed-1")throw Error("transport unavailable");
  if(id==="failed-2")return {...summary,id,status:"cancelled"};
  return {...summary,id,clientContext:{chapterId:"different-chapter"},error:"DO NOT SHOW OTHER CHAPTER"};
 });
 expect(messages["failed-1"]).toContain("读取失败");
 expect(messages["failed-2"]).toContain("已取消");
 expect(messages["failed-3"]).toContain("归属不一致");
 expect(JSON.stringify(messages)).not.toContain("DO NOT SHOW");
});
