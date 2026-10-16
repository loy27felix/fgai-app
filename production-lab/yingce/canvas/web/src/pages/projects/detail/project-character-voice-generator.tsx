import { useRef, useState } from "react";
import { Alert, App, Button, Input, Progress } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { configuredModelDisplayName } from "@/lib/model-selection";
import { submitBackendGenerationTask } from "@/services/api/generation-task";
import { queryGenerationTask, listGenerationTasks } from "@/services/api/task-center";
import type { ProjectAsset } from "@/services/api/projects";
import { useCanvasGenerationConfirmation } from "@/components/canvas/canvas-generation-confirmation";
import { characterSeedAudioModel, characterVoiceDirection, characterVoiceSamplePrompt, characterVoiceSampleFromTask, isCharacterVoiceSampleTask } from "./project-character-voice-plan";

export function ProjectCharacterVoiceGenerator({ projectId, asset, instructions, onSample }: { projectId: string; asset: ProjectAsset; instructions: string; onSample: (sample: { resourceId: string; name: string; url: string }) => void }) {
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const model = characterSeedAudioModel(config);
    const queryClient = useQueryClient();
    const confirmGeneration = useCanvasGenerationConfirmation(`${projectId}:${asset.id}`);
    const [dialogue, setDialogue] = useState("别着急，我们把事情从头说清楚。我会认真听，也会陪你一起找到答案。");
    const [direction, setDirection] = useState(() => characterVoiceDirection(asset.character?.definition || asset.definition || {}));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const operation = useRef<{ prompt: string; id: string } | undefined>(undefined);
    const tasks = useQuery({
        queryKey: ["project-character-voice-tasks", projectId, asset.id],
        queryFn: async () => {
            const related = (await listGenerationTasks(500, { projectId })).filter((task) => isCharacterVoiceSampleTask(task, asset.id)).slice(0, 6);
            return Promise.all(related.map((task) => queryGenerationTask(task.id)));
        },
        refetchInterval: (query) => (query.state.data?.some((task) => task.status === "queued" || task.status === "running") ? 2500 : false),
        refetchOnWindowFocus: true,
    });
    const active = tasks.data?.some((task) => task.status === "queued" || task.status === "running");
    const generate = async () => {
        if (busy || active || !model || !dialogue.trim()) return;
        setBusy(true);
        setError("");
        try {
            const prompt = characterVoiceSamplePrompt(asset.title, dialogue, direction, instructions);
            const approved = await confirmGeneration([
                {
                    key: asset.id,
                    inputKey: asset.id,
                    title: `${asset.title}-声音样本`,
                    kind: "音频",
                    fields: [
                        ["模型", configuredModelDisplayName(config, model)],
                        ["音频格式", "MP3"],
                        ["生成时长", "按试音台词与表演节奏决定"],
                        ["费用", "公司音频渠道；供应商费用待账单核销"],
                    ],
                    prompt,
                    references: [],
                },
            ]);
            if (!approved) return;
            if (!operation.current || operation.current.prompt !== prompt) operation.current = { prompt, id: crypto.randomUUID() };
            const task = await submitBackendGenerationTask({
                projectId,
                mode: "audio",
                prompt,
                config: { ...config, model, audioModel: model, audioVoice: "prompt", audioFormat: "mp3", audioSpeed: "1", audioInstructions: "", taskWorkflowProvider: "model" },
                clientOperationId: operation.current.id,
                metadata: { operation: "character_voice_sample", assetId: asset.id, characterAssetId: asset.id, assetVersionId: asset.primaryVersionId, outputTitle: `${asset.title}-声音样本`, source: "project-character-voice" },
            });
            queryClient.setQueryData(["project-character-voice-tasks", projectId, asset.id], (current: typeof tasks.data) => [task, ...(current || []).filter((item) => item.id !== task.id)]);
            operation.current = undefined;
            message.success("声音任务已登记，完成后可试听并选择绑定");
            void tasks.refetch();
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : "声音任务提交失败，请检查任务记录");
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className="grid gap-3 rounded-lg border border-border p-3">
            <div className="font-medium">AI 生成角色声音 · Seed Audio</div>
            <p className="m-0 text-xs text-foreground/55">可按角色设定生成声音样本。完成后试听，点击“使用此声音”，再绑定到角色；原图片和声音历史保留。关闭窗口不停止已提交任务。</p>
            {!model && <Alert type="warning" showIcon title="当前没有可用的 Seed Audio 模型，请检查模型渠道配置" />}
            <label className="grid gap-1 text-xs">
                声音特征
                <Input.TextArea value={direction} onChange={(event) => setDirection(event.target.value)} rows={2} maxLength={800} placeholder="例如：英语、成年男性、沉稳低音、略带沙哑；可修改角色预填方向" />
            </label>
            <label className="grid gap-1 text-xs">
                试音台词
                <Input.TextArea
                    value={dialogue}
                    onChange={(event) => {
                        setDialogue(event.target.value);
                        operation.current = undefined;
                    }}
                    rows={3}
                    maxLength={1200}
                />
            </label>
            <Button loading={busy} disabled={!model || tasks.isLoading || tasks.isError || active || !dialogue.trim()} onClick={() => void generate()}>
                {active ? "声音生成中" : "生成声音并试听"}
            </Button>
            <div className="text-xs text-foreground/50">费用沿用公司音频渠道规则，未知供应商费用不按 0 元展示。</div>
            {(error || tasks.error) && <Alert type="error" showIcon title={error || (tasks.error instanceof Error ? tasks.error.message : "任务读取失败")} />}
            {(tasks.data || []).slice(0, 6).map((task) => {
                let sample: ReturnType<typeof characterVoiceSampleFromTask>;
                try {
                    sample = characterVoiceSampleFromTask(task, asset.title);
                } catch {
                    /* Show recovery status below; never submit a replacement automatically. */
                }
                const running = task.status === "queued" || task.status === "running";
                return (
                    <div key={task.id} className="rounded border border-border p-2">
                        <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                            <span>
                                {asset.title}-声音样本 · {new Date(task.createdAt).toLocaleString("zh-CN")}
                            </span>
                            <span>{running ? "生成中" : task.status === "succeeded" ? "已完成" : task.status === "cancelled" ? "已取消" : "失败"}</span>
                        </div>
                        {running && <Progress percent={task.progress || 0} size="small" status="active" />}
                        {sample ? (
                            <>
                                <audio src={sample.url} controls preload="metadata" className="w-full" />
                                <Button size="small" className="mt-2" onClick={() => onSample(sample!)}>
                                    使用此声音
                                </Button>
                            </>
                        ) : (
                            !running && <div className="text-xs text-foreground/55">{task.status === "succeeded" ? "任务已完成，声音资源暂不可读，请到任务中心恢复原结果；不要重复提交。" : task.error || "任务未完成，请先核对原任务记录。"}</div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
