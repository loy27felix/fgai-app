import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Checkbox, Input, Progress } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { configuredModelDisplayName } from "@/lib/model-selection";
import { submitBackendGenerationTask } from "@/services/api/generation-task";
import { getProjectLanguage, applyProjectLanguage } from "@/services/api/project-language";
import { useUserStore } from "@/stores/use-user-store";
import { queryGenerationTask, listGenerationTasks } from "@/services/api/task-center";
import type { ProjectAsset } from "@/services/api/projects";
import { useCanvasGenerationConfirmation } from "@/components/canvas/canvas-generation-confirmation";
import { getResource, resourceStorageKey } from "@/services/api/resources";
import type { ReferenceAudio } from "@/types/media";
import { characterVoiceTaskSummaryCandidate, characterSeedAudioModel, characterVoiceDirection, characterVoiceSamplePrompt, characterVoiceSampleFromTask, isCharacterVoiceSampleTask } from "./project-character-voice-plan";

type VoiceSample = { resourceId: string; name: string; url: string };
export function ProjectCharacterVoiceGenerator({ projectId, asset, instructions, referenceSample, onSample }: { projectId: string; asset: ProjectAsset; instructions: string; referenceSample?: VoiceSample | null; onSample: (sample: VoiceSample) => void }) {
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const model = characterSeedAudioModel(config);
    const queryClient = useQueryClient();
    const confirmGeneration = useCanvasGenerationConfirmation(`${projectId}:${asset.id}`);
    const scope = useUserStore(state => state.user?.id || "");
    const language = useQuery({ queryKey: ["project-language", scope, projectId], queryFn: () => getProjectLanguage(projectId) });
    const [dialogue, setDialogue] = useState("别着急，我们把事情从头说清楚。我会认真听，也会陪你一起找到答案。");
    const [direction, setDirection] = useState(() => characterVoiceDirection(asset.character?.definition || asset.definition || {}));
    const [busy, setBusy] = useState(false);
    const [useReference, setUseReference] = useState(true);
    const [error, setError] = useState("");
    const dialogueEdited = useRef(false);
    useEffect(() => { if (language.data?.policy.spoken === "en-original" && !dialogueEdited.current) setDialogue(""); }, [language.data]);
    const operation = useRef<{ prompt: string; id: string } | undefined>(undefined);
    const tasks = useQuery({
        queryKey: ["project-character-voice-tasks", projectId, asset.id],
        queryFn: async () => {
            const related = (await listGenerationTasks(500, { projectId })).filter((task) => characterVoiceTaskSummaryCandidate(task, asset.id)).slice(0, 30);
            return (await Promise.all(related.map((task) => queryGenerationTask(task.id)))).filter(task => isCharacterVoiceSampleTask(task, asset.id)).slice(0, 6);
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
            const { policy } = await getProjectLanguage(projectId);
            if (policy.spoken === "en-original" && /\p{Script=Han}/u.test(dialogue)) throw new Error("本项目使用原英文台词，请粘贴角色的英文原句后试音");
            let reference: ReferenceAudio | undefined;
            if (referenceSample && useReference) {
                const resource = await getResource(referenceSample.resourceId);
                if ((resource.durationMs || 0) > 30000) throw new Error("参考声音最长 30 秒，请先截取清晰的声音样本");
                if (resource.size > 10 * 1024 * 1024) throw new Error("参考声音最大 10 MB，请先缩小样本");
                if (!/^(audio\/(wav|x-wav|mpeg|mp3|pcm|ogg|opus))$/i.test(resource.mimeType || "")) throw new Error("Seed Audio 参考声音请使用 WAV、MP3、PCM 或 OGG Opus；当前样本格式不受支持");
                reference = { id: resource.id, name: referenceSample.name, url: referenceSample.url, storageKey: resourceStorageKey(resource.id), type: resource.mimeType, bytes: resource.size, durationMs: resource.durationMs };
            }
            const prompt = applyProjectLanguage([reference ? "角色音色严格参考@音频1，保留其声音身份、音域与音色质感；只说本次试音台词，不复读样本原台词。" : "", characterVoiceSamplePrompt(asset.title, dialogue, direction, instructions)].filter(Boolean).join("\n"), policy, "audio");
            const approved = await confirmGeneration([
                {
                    key: asset.id,
                    inputKey: asset.id,
                    title: `${asset.title}-声音样本`,
                    kind: "音频",
                    fields: [
                        ["模型", configuredModelDisplayName(config, model)],
                        ["音频格式", "MP3"],
                        ["声音来源", reference ? `参考音频：${reference.name}` : "按文字描述设计新声音"],
                        ["生成时长", "按试音台词与表演节奏决定"],
                        ["费用", "公司音频渠道；供应商费用待账单核销"],
                    ],
                    prompt,
                    references: reference ? [reference.name] : [],
                },
            ]);
            if (!approved) return;
            const operationKey = `${prompt}|${reference?.storageKey || "text-only"}`;
            if (!operation.current || operation.current.prompt !== operationKey) operation.current = { prompt: operationKey, id: crypto.randomUUID() };
            const task = await submitBackendGenerationTask({
                projectId,
                mode: "audio",
                prompt,
                referenceAudios: reference ? [reference] : [],
                config: { ...config, model, audioModel: model, audioVoice: "prompt", audioFormat: "mp3", audioSpeed: "1", audioInstructions: "", taskWorkflowProvider: "model" },
                clientOperationId: operation.current.id,
                metadata: { projectLanguagePolicy: policy, operation: "character_voice_sample", assetId: asset.id, characterAssetId: asset.id, assetVersionId: asset.primaryVersionId, outputTitle: `${asset.title}-声音样本`, source: "project-character-voice" },
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
            <p className="m-0 text-xs text-foreground/55">可按角色设定设计声音；选中上方样音时，可参考其音色生成新台词。完成后试听并选择绑定；原图片和声音历史保留。</p>
            {referenceSample && <Checkbox checked={useReference} onChange={event => setUseReference(event.target.checked)}>参考上方“{referenceSample.name}”的音色生成（最长 30 秒、10 MB）</Checkbox>}
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
                        dialogueEdited.current = true;
                        setDialogue(event.target.value);
                        operation.current = undefined;
                    }}
                    rows={3}
                    placeholder={language.data?.policy.spoken === "en-original" ? "请粘贴该角色在原剧本中的英文台词，不自动翻译或代写" : "请输入试音台词"}
                    maxLength={1200}
                />
            </label>
            <Button loading={busy} disabled={!model || language.isPending || language.isError || tasks.isLoading || tasks.isError || active || !dialogue.trim()} onClick={() => void generate()}>
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
