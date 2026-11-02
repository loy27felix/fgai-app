import { useEffect, useState } from "react";
import { App, Alert, Button, Input, Select, Space, Tag } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listGenerationTasks, queryGenerationTask, retryGenerationTask } from "@/services/api/task-center";
import type { ProjectDetail } from "@/services/api/projects";
import { completeStoryboardBatch, storyboardBatchInfo, storyboardBatchTasks } from "@/lib/chapter-storyboard-batches";
import { useStoryboardReferenceReview } from "./storyboard-reference-review";
import { importSavedChapterStoryboard, latestChapterStoryboard, chapterStoryboardWasImported } from "./storyboard-result-import";
import { chapterTaskIdentity } from "./project-chapter-ai";
import { readStoryboardBatchFailureMessages } from "./storyboard-batch-diagnostics";

export default function StoryboardRecoveryPanel({ detail, unitId }: { detail: ProjectDetail; unitId: string }) {
    const { modal, message } = App.useApp(), client = useQueryClient();
    const [busy, setBusy] = useState(false), [error, setError] = useState("");
    const [editing,setEditing]=useState(false), [edits,setEdits]=useState<Record<string,string>>({}), [editId,setEditId]=useState("");
    const [editRow,setEditRow]=useState(0);
    const [selectedBatch,setSelectedBatch]=useState("");
    useEffect(()=>{setSelectedBatch("");setEditing(false);setEdits({});setEditId("");setError("");},[detail.project.id,unitId]);
    const review = useStoryboardReferenceReview();
    const tasks = useQuery({ queryKey: ["project-chapter-generation-tasks", detail.project.id], queryFn: () => listGenerationTasks(1000, { projectId: detail.project.id }), refetchInterval: query => query.state.data?.some(task => task.status === "running" || task.status === "queued") ? 2000 : false });
    const batches=new Map<string,typeof tasks.data>();
    for(const task of [...(tasks.data||[])].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))) {
        const identity=chapterTaskIdentity(task);
        if(task.projectId!==detail.project.id || identity?.chapterId!==unitId || identity.kind!=="storyboard")continue;
        try { const id=storyboardBatchInfo(task)?.id||task.id;batches.set(id,[...(batches.get(id)||[]),task]); } catch { /* Invalid metadata is not a selectable batch. */ }
    }
    const scopedTasks=selectedBatch ? batches.get(selectedBatch)||[] : tasks.data||[];
    const latest = latestChapterStoryboard(scopedTasks, detail.project.id, unitId);
    const batch = latest && completeStoryboardBatch(latest, scopedTasks);
    const shots = detail.shots.filter(shot => shot.unitId === unitId);
    const imported = batch && chapterStoryboardWasImported(batch, unitId, detail);
    const failedParts = latest ? storyboardBatchTasks(latest, scopedTasks).filter(task => task.status === "failed" || task.status === "cancelled") : [];
    const failureDetails = useQuery({
        queryKey: ["chapter-storyboard-failures", detail.project.id, unitId, ...failedParts.map(task => `${task.id}:${task.updatedAt}`)],
        queryFn: ({signal}) => readStoryboardBatchFailureMessages(detail.project.id, unitId, failedParts, signal),
        enabled: failedParts.length > 0 && !imported,
    });
    if (tasks.isError) return <Alert type="warning" showIcon title="分镜任务状态暂时读取失败" action={<Button onClick={() => void tasks.refetch()}>重读状态</Button>} />;
    if (!latest || imported) return null;
    const batchSelector=batches.size>1?<Select className="mb-2 w-full" aria-label="选择已保存分镜批次" value={selectedBatch||storyboardBatchInfo(latest)?.id||latest.id} options={[...batches].map(([value,items])=>({value,label:`${new Date(items![0].createdAt).toLocaleString()} · ${items!.filter(task=>task.status==="succeeded").length}/${storyboardBatchInfo(items![0])?.count||1} 批已返回`}))} onChange={id=>{setSelectedBatch(id);setEditing(false);setEdits({});setError("");}}/>:null;
    if (!batch) {
        const parts = storyboardBatchTasks(latest, scopedTasks);
        const expected = storyboardBatchInfo(latest)?.count || 1;
        const failed = parts.filter(task => task.status === "failed" || task.status === "cancelled");
        const retry = async () => {
            if (busy || !failed.length) return;
            if (!await new Promise<boolean>(resolve => modal.confirm({ title: `仅重试 ${failed.length} 个失败批次？`, content: "已成功的批次保留，不会重跑整章。失败批次重新调用模型，按正常规则计费。", okText: "确认重试失败批次", onOk: () => resolve(true), onCancel: () => resolve(false) }))) return;
            setBusy(true); setError("");
            try { for (const task of failed) await retryGenerationTask(task.id); }
            catch (e) { setError(e instanceof Error ? e.message : "重试未完成"); }
            finally { await tasks.refetch(); setBusy(false); }
        };
        return <div>{batchSelector}<Alert type={failed.length || error ? "warning" : "info"} showIcon title={failed.length ? "分镜部分批次失败，已完成结果保留" : "本章分镜批次尚未全部完成"} description={<Space orientation="vertical">{shots.length > 0 && <span>本章已有 {shots.length} 段分镜，本轮失败不会影响已保存镜头。</span>}<span>已完成 {parts.filter(task => task.status === "succeeded").length}/{expected} 批。整章全部返回并通过内容校验后才能导入，请勿重复生成整章。</span><Space wrap>{parts.map(task => <Tag key={task.id} color={task.status === "succeeded" ? "green" : task.status === "failed" ? "red" : "blue"}>第{storyboardBatchInfo(task)?.index || 1}批：{task.status === "succeeded" ? "已返回，待整章校验" : task.status === "failed" || task.status === "cancelled" ? "失败" : "生成中"}</Tag>)}</Space>{parts.length<expected&&<span>有 {expected-parts.length} 批尚未找到提交记录，请核对任务中心，当前不会把部分结果当成整章导入。</span>}{failed.map(task => <span key={task.id}>第{storyboardBatchInfo(task)?.index || 1}批：{failureDetails.data?.[task.id] || (failureDetails.isFetching ? "正在读取失败原因…" : "请打开任务中心查看失败原因")}</span>)}{error && <span>{error}</span>}</Space>} action={<Space><Button size="small" onClick={() => { void tasks.refetch(); if (failedParts.length) void failureDetails.refetch(); }}>刷新批次状态</Button>{failed.length > 0 && <Button size="small" loading={busy} onClick={() => void retry()}>仅重试失败批次</Button>}</Space>} /></div>;
    }
    const run = async () => {
        if (busy) return;
        if (shots.length && !await new Promise<boolean>(resolve => modal.confirm({ title: `用已保存结果替换本章 ${shots.length} 个现有镜头？`, content: "会替换本章镜头、脚本版本、引用和关联产物；不会调用模型或扣费。若要保留现有编辑，请取消。", okText: "核对并替换", okButtonProps: { danger: true }, onOk: () => resolve(true), onCancel: () => resolve(false) }))) return;
        setBusy(true); setError("");
        try {
            const workspace = await importSavedChapterStoryboard(detail.project.id, unitId, scopedTasks, review, shots.map(shot => shot.id), undefined, edits);
            client.setQueryData(["project",detail.project.id,"unit-workspace",unitId], workspace);
            await client.invalidateQueries({ queryKey: ["project",detail.project.id] });
            void message.success(`已导入并读取确认 ${workspace.shots.length} 段分镜，没有重新生成`);
        } catch (e) { setError(e instanceof Error ? e.message : "导入未完成，保存结果仍保留"); }
        finally { setBusy(false); }
    };
    const openEditor=async()=>{
        setBusy(true);
        try { const full=await Promise.all(batch.map(task=>queryGenerationTask(task.id)));setEdits(Object.fromEntries(full.map(task=>[task.id,JSON.parse(task.resultJson||"{}").text||""])));setEditId(full[0].id);setEditing(true); }
        catch(e){setError(e instanceof Error?e.message:"读取保存结果失败");}finally{setBusy(false);}
    };
    let editDocument: {rows:Array<Record<string,unknown>>} | undefined;
    try { editDocument=JSON.parse((edits[editId]||"").replace(/^\s*```(?:json)?\s*|\s*```\s*$/g,"")); } catch { /* Incomplete structured output cannot be repaired by fabricating rows. */ }
    const editableRows=Array.isArray(editDocument?.rows)?editDocument.rows:[];
    const currentRow=editableRows[editRow];
    const changePrompt=(value:string)=>{
        if(!editDocument || !currentRow)return;
        const rows=editableRows.map((row,index)=>index===editRow?{...row,videoMotionPrompt:value}:row);
        setEdits(values=>({...values,[editId]:JSON.stringify({...editDocument,rows})}));
    };
    return <>{batchSelector}<Alert className="shrink-0" type={error ? "warning" : "info"} showIcon title="模型结果已保存，尚未完成分镜导入" description={error || "后台“成功”表示模型返回完成。可直接核对并导入这批结果，无需重新生成或再次扣费。"} action={<Space><Button size="small" loading={busy} disabled={detail.project.status === "archived"} onClick={() => void run()}>核对并导入已保存分镜</Button><Button size="small" disabled={busy} onClick={()=>void openEditor()}>核对 / 修正保存结果</Button></Space>} />
        <AppModal open={editing} title="核对已保存分镜 · 不调用模型" width={1000} onCancel={()=>setEditing(false)} footer={<><Button onClick={()=>setEditing(false)}>返回</Button><Button type="primary" loading={busy} onClick={()=>void run()}>完整校验后导入</Button></>}>
            <p className="mb-3 text-sm">选择批次和镜头，修正提示词中的时间轴等错误。保留剧情、人物和对白；每段从 0 连续覆盖到该段总秒数。全部批次通过校验后才会导入，原任务结果保留。修改暂存在当前窗口，关闭页面前请完成核对。</p>
            {error&&<Alert type="warning" title={error}/>}
            <Select className="my-3 w-full" value={editId} options={batch.map(task=>({value:task.id,label:`第 ${storyboardBatchInfo(task)?.index||1} 批`}))} onChange={id=>{setEditId(id);setEditRow(0);}}/>
            <Select className="mb-3 w-full" value={editRow} options={editableRows.map((row,index)=>({value:index,label:`镜头 ${index+1} · ${row.durationSeconds || "?"} 秒`}))} onChange={setEditRow}/>
            {currentRow ? <><p className="mb-2 text-sm">剧情：{String(currentRow.plotDescription || "")}</p><p className="mb-2 whitespace-pre-wrap text-sm">原台词：{typeof currentRow.dialogue==="string"?currentRow.dialogue:JSON.stringify(currentRow.dialogue||"")}</p><Input.TextArea value={String(currentRow.videoMotionPrompt||"")} onChange={e=>changePrompt(e.target.value)} autoSize={{minRows:14,maxRows:26}} aria-label="已保存镜头的视频提示词"/></> : <Alert type="warning" title="本批返回结构不完整，无法安全列出镜头；请核对任务详情，不要修改原章节"/>}
        </AppModal></>;
}
