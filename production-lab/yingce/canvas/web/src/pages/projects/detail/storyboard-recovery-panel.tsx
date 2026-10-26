import { useState } from "react";
import { App, Alert, Button } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listGenerationTasks } from "@/services/api/task-center";
import type { ProjectDetail } from "@/services/api/projects";
import { completeStoryboardBatch } from "@/lib/chapter-storyboard-batches";
import { useStoryboardReferenceReview } from "./storyboard-reference-review";
import { importSavedChapterStoryboard, latestChapterStoryboard, chapterStoryboardWasImported } from "./storyboard-result-import";

export default function StoryboardRecoveryPanel({ detail, unitId }: { detail: ProjectDetail; unitId: string }) {
    const { modal, message } = App.useApp(), client = useQueryClient();
    const [busy, setBusy] = useState(false), [error, setError] = useState("");
    const review = useStoryboardReferenceReview();
    const tasks = useQuery({ queryKey: ["project-chapter-generation-tasks", detail.project.id], queryFn: () => listGenerationTasks(1000, { projectId: detail.project.id }), refetchInterval: query => query.state.data?.some(task => task.status === "running" || task.status === "queued") ? 2000 : false });
    const latest = latestChapterStoryboard(tasks.data || [], detail.project.id, unitId);
    const batch = latest && completeStoryboardBatch(latest, tasks.data || []);
    const shots = detail.shots.filter(shot => shot.unitId === unitId);
    const imported = batch && chapterStoryboardWasImported(batch, unitId, detail);
    if (tasks.isError) return <Alert type="warning" showIcon title="分镜任务状态暂时读取失败" action={<Button onClick={() => void tasks.refetch()}>重读状态</Button>} />;
    if (!latest || imported) return null;
    if (!batch) return <Alert type="info" showIcon title="本章分镜批次尚未全部完成" description="后台单个请求成功不代表整章已完成。已返回结果仍保留，请等待或核对失败批次，不要重复生成整章。" action={<Button size="small" onClick={() => void tasks.refetch()}>刷新批次状态</Button>} />;
    const run = async () => {
        if (busy) return;
        if (shots.length && !await new Promise<boolean>(resolve => modal.confirm({ title: `用已保存结果替换本章 ${shots.length} 个现有镜头？`, content: "会替换本章镜头、脚本版本、引用和关联产物；不会调用模型或扣费。若要保留现有编辑，请取消。", okText: "核对并替换", okButtonProps: { danger: true }, onOk: () => resolve(true), onCancel: () => resolve(false) }))) return;
        setBusy(true); setError("");
        try {
            const workspace = await importSavedChapterStoryboard(detail.project.id, unitId, tasks.data || [], review, shots.map(shot => shot.id));
            client.setQueryData(["project",detail.project.id,"unit-workspace",unitId], workspace);
            await client.invalidateQueries({ queryKey: ["project",detail.project.id] });
            void message.success(`已导入并读取确认 ${workspace.shots.length} 段分镜，没有重新生成`);
        } catch (e) { setError(e instanceof Error ? e.message : "导入未完成，保存结果仍保留"); }
        finally { setBusy(false); }
    };
    return <Alert className="shrink-0" type={error ? "warning" : "info"} showIcon title="模型结果已保存，尚未完成分镜导入" description={error || "后台“成功”表示模型返回完成。可直接核对并导入这批结果，无需重新生成或再次扣费。"} action={<Button size="small" loading={busy} disabled={detail.project.status === "archived"} onClick={() => void run()}>核对并导入已保存分镜</Button>} />;
}
