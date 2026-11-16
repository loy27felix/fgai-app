import { http } from "@/services/api/request";
import { GenerationTaskFailure, type GenerationTask } from "@/services/api/task-center";
import { modelOptionName, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";

export type PersonalGPTStatus = { configured: boolean };
export const getShortDramaGPTStatus = () => http.get<PersonalGPTStatus>("/settings/personal-gpt");

export function shortDramaDefaultTextModel(config: AiConfig, configured: boolean) {
    const models = selectableModelsByCapability(config, "text");
    const sol = models.find(model => modelOptionName(model) === "gpt-6.1-sol");
    const sonnet = models.find(model => /^claude-sonnet-5[.-]5(?:-|$)/i.test(modelOptionName(model)));
    return (configured ? sol || sonnet : sonnet) || "";
}

export function confirmedPersonalGPTQuotaFailure(error: unknown) {
    if (!(error instanceof GenerationTaskFailure)) return false;
    const task = error.task;
    // A disconnect, generic 429, or partially streamed response is not proof of a rejected request.
    if (task.status !== "failed" || task.billing?.status === "uncertain" || task.textDraft?.trim()) return false;
    return ["insufficient_quota", "quota_not_enough", "quota_exceeded"].includes(task.errorCode || "")
        || task.error?.trim() === "模型服务额度不足，请检查渠道余额或配额";
}

export async function runShortDramaText<T>(
    config: AiConfig,
    run: (config: AiConfig) => Promise<T>,
    onFallback?: (message: string, failedTask: GenerationTask) => void,
    readStatus: () => Promise<PersonalGPTStatus> = getShortDramaGPTStatus,
) {
    const selected = config.textModel || config.model;
    const status = await readStatus();
    const model = !selected || (modelOptionName(selected) === "gpt-6.1-sol" && !status.configured)
        ? shortDramaDefaultTextModel(config, status.configured) : selected;
    if (!model) throw new Error("短剧文本模型不可用，请检查 Sonnet 5.5 或个人 GPT 配置");
    try {
        return await run({ ...config, model, textModel: model });
    } catch (error) {
        if (modelOptionName(model) !== "gpt-6.1-sol" || !confirmedPersonalGPTQuotaFailure(error)) throw error;
        const fallback = shortDramaDefaultTextModel(config, false);
        if (!fallback) throw new Error("个人 GPT 额度不足，Sonnet 5.5 当前不可用；原任务已保留，请检查模型目录");
        onFallback?.("个人 GPT 额度不足，已切换 Sonnet 5.5，按公司额度计费", (error as GenerationTaskFailure).task);
        // A separate native task quotes and accounts for Sonnet; never mutate the GPT task's billing route.
        return run({ ...config, model: fallback, textModel: fallback });
    }
}
