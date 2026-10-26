import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "antd";
import StoryboardRecoveryPanel from "@/pages/projects/detail/storyboard-recovery-panel";
import type { ProjectDetail } from "@/services/api/projects";
import type { GenerationTask } from "@/services/api/task-center";
const detail={project:{id:"project",status:"active"},shots:[],shotRevisions:[]} as unknown as ProjectDetail;
function render(tasks:GenerationTask[],value=detail){const client=new QueryClient();client.setQueryData(["project-chapter-generation-tasks","project"],tasks);return renderToStaticMarkup(<QueryClientProvider client={client}><App><StoryboardRecoveryPanel detail={value} unitId="chapter" /></App></QueryClientProvider>);}
const task={id:"saved",projectId:"project",type:"canvas_text",status:"succeeded",createdAt:"2026-10-26T10:00:00Z",updatedAt:"2026-10-26T10:02:00Z",clientContext:{chapterId:"chapter",chapterOperation:"storyboard"}} as GenerationTask;
test("shared chapter/workflow panel exposes completed but unimported output without relying on a prior toast or failure cache",()=>{
    const html=render([task]);expect(html).toContain("模型结果已保存");expect(html).toContain("核对并导入已保存分镜");
});
test("a successful child of an incomplete batch explains why no shots exist",()=>{
    const html=render([{...task,clientContext:{...task.clientContext,storyboardBatchId:"batch",batchIndex:1,batchCount:2}}]);
    expect(html).toContain("批次尚未全部完成");expect(html).not.toContain("核对并导入已保存分镜");
});
