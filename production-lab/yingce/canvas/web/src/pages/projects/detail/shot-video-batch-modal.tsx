import { useEffect, useRef, useState } from "react";
import { App, Alert, Button, Checkbox, Select } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import { fgModelQuoteRequest, type Quote } from "@/components/fg-price-preview";
import { modelCompatibilityError } from "@/lib/model-selection";
import { formatShotOrdinal } from "@/lib/shot-label";
import { prepareBackendGenerationTask } from "@/services/api/generation-task";
import { createGenerationTask, type CreateTaskInput } from "@/services/api/task-center";
import { createUnitWorkflow, getProjectUnitWorkspace, linkShotAsset, listProjectAssetsPage, type ProjectAsset, type ProjectDetail, type ShotAssetReference } from "@/services/api/projects";
import { http } from "@/services/api/request";
import { modelDisplayName, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { buildShotAssetReferenceContext, ensureShotAssetMentionPrompt, inferShotVisualAssets } from "./workflow-shot-references";
import { currentRevision } from "./workflow-shared";
import { shotArtifactPrompt } from "./shot-artifact-prompt";
import { prepareShotVideoExecution } from "./shot-video-execution";

type Row = { shotId: string; title: string; revisionId: string; referenceKey: string; autoAssets: ProjectAsset[]; request: CreateTaskInput; quote: Quote; quoteRequest: NonNullable<ReturnType<typeof fgModelQuoteRequest>>; seconds: number; names: string[]; taskId?: string; error?: string };
const referenceKey = (refs: ShotAssetReference[], id: string) => JSON.stringify(refs.filter(ref => ref.shotId === id && ref.status === "linked").map(ref => [ref.id, ref.assetVersionId, ref.role]).sort());

export function ShotVideoBatchModal({ open, detail, unitId, config, onClose, onRefresh }: { open: boolean; detail: ProjectDetail; unitId: string; config: AiConfig; onClose: () => void; onRefresh: () => Promise<void> }) {
    const { message } = App.useApp();
    const userId = useUserStore(state => state.user?.id);
    const [ids, setIds] = useState<string[]>([]);
    const [useVoiceSamples, setUseVoiceSamples] = useState(false);
    const [rows, setRows] = useState<Row[]>([]);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState("");
    const [budget, setBudget] = useState<{ remaining: number | null; unknown: number } | null>(null);
    const alive = useRef(true);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    const shots = detail.shots.filter(shot => shot.unitId === unitId).sort((a, b) => a.position - b.position);
    const readBudget = async () => {
        const result = await http.get<{ users: { id: string; monthly_cny: number | string | null; used: number; unknown: number }[] }>("/fg/budgets/users");
        const user = result.users.find(user => user.id === userId);
        if (!user || !Number.isFinite(user.used)) throw new Error("无法确认当前账户月度额度");
        const limit = Number(user.monthly_cny);
        const value = { remaining: limit > 0 ? Math.max(0, limit - user.used) : null, unknown: user.unknown };
        setBudget(value);
        return value;
    };
    const prepare = async () => {
        setBusy(true); setRows([]); setStatus("正在校验镜头、参考素材与人民币报价…");
        try {
            const workspace = await getProjectUnitWorkspace(detail.project.id, unitId);
            const assets: ProjectAsset[] = [];
            for (let page = 1; ; page++) {
                const result = await listProjectAssetsPage(detail.project.id, { page, pageSize: 100 });
                assets.push(...result.assets);
                if (assets.length >= result.total || !result.assets.length) break;
            }
            const workflow = workspace.workflows.find(item => item.instance.unitId === unitId) || (await createUnitWorkflow(detail.project.id, unitId)).workflow;
            const step = workflow.steps?.find(step => step.stepKey === "video");
            if (!step || step.status === "failed") throw new Error("视频阶段不可用，请先处理阶段错误");
            const prepared: Row[] = [];
            let skipped = 0;
            for (const id of ids) {
                if (!alive.current) return;
                const shot = workspace.shots.find(shot => shot.id === id);
                if (!shot) throw new Error("镜头已被删除，请刷新章节");
                if (workspace.tasks.some(task => task.clientContext?.shotId === id && task.clientContext?.artifactType === "video" && ["queued", "running"].includes(task.status))) { skipped++; continue; }
                const revision = currentRevision({ ...detail, ...workspace }, shot);
                if (!shot.currentRevisionId || !revision?.videoPrompt?.trim()) throw new Error(`${shot.title} 没有已保存的视频提示词`);
                const existing = workspace.shotReferences.filter(ref => ref.shotId === id && ref.status === "linked" && ref.role === "reference");
                const autoAssets = existing.length ? [] : inferShotVisualAssets(assets, [revision.plotDescription, revision.action, revision.videoPrompt].join("\n"));
                if (autoAssets.length > 6) throw new Error(`${shot.title} 匹配的参考资产超过6项，请先人工核对`);
                const refs = [...workspace.shotReferences, ...autoAssets.map(asset => ({ id: `auto:${asset.id}`, shotId: id, assetVersionId: asset.primaryVersionId!, role: "reference", status: "linked", createdAt: "", asset }))];
                const boundContext = buildShotAssetReferenceContext({ ...detail, ...workspace, assets, shotReferences: refs }, id);
                const prompt = shotArtifactPrompt("video", { ...revision, videoPrompt: ensureShotAssetMentionPrompt(revision.videoPrompt, boundContext.mentionReferences) });
                const execution = prepareShotVideoExecution(prompt, boundContext, { dialogue: revision.dialogue, useVoiceSamples, projectAssets: assets });
                const context = execution.context;
                const seconds = (revision.durationMs || shot.durationMs) / 1000;
                const modelConfig = { ...config, videoSeconds: String(seconds) };
                const input = { textCount: 1, imageCount: context.referenceImages.length, audioCount: context.referenceAudios.length, videoCount: 0, characterCount: 0 };
                const operation = input.imageCount ? "reference_to_video" : "text_to_video";
                const requirements = { capability: "video" as const, input, videoOperation: operation, videoSeconds: String(seconds), options: { size: config.size, vquality: config.vquality, videoSeconds: seconds } };
                const error = modelCompatibilityError(modelConfig, modelConfig.model, requirements);
                if (error) throw new Error(`${shot.title}：${error}`);
                const request = await prepareBackendGenerationTask({ projectId: detail.project.id, mode: "video", prompt: execution.prompt, config: modelConfig, referenceImages: context.referenceImages, referenceAudios: context.referenceAudios, clientOperationId: crypto.randomUUID(), metadata: { ...execution.metadata, workflowStepId: step.id, domainProjectId: detail.project.id, unitId, shotId: id, shotRevisionId: shot.currentRevisionId, artifactType: "video", role: "output", source: "short-drama-workflow", videoEditOperation: operation, resolvedCharacterVersions: context.resolvedCharacterVersions, artifactMetadata: { ...execution.metadata, model: config.model, aspectRatio: config.size, resolution: config.vquality, durationSeconds: seconds, actualPrompt: execution.prompt } } });
                const quoteRequest = fgModelQuoteRequest(modelConfig, modelConfig.model, "video", requirements);
                if (!quoteRequest) throw new Error("批量生成只支持已配置人民币报价的 FG 系统模型");
                const quote = await http.post<Quote>("/fg/models/quote", quoteRequest);
                if (quote.estimatedCny === null || !Number.isFinite(quote.estimatedCny)) throw new Error(`${shot.title} 报价暂不可用，未提交生成`);
                prepared.push({ shotId: id, title: formatShotOrdinal(shot.position), revisionId: shot.currentRevisionId, referenceKey: referenceKey(workspace.shotReferences, id), autoAssets, request, quote, quoteRequest, seconds, names: context.assetReferences.map(asset => asset.title) });
            }
            await readBudget();
            setRows(prepared); setStatus(`已准备 ${prepared.length} 个镜头，跳过 ${skipped} 个正在生成的镜头。检查参考素材与报价后确认提交。`);
        } catch (error) { setStatus(error instanceof Error ? error.message : "批量校验失败"); }
        finally { setBusy(false); }
    };
    const total = rows.filter(row => !row.taskId).reduce((sum, row) => sum + row.quote.estimatedCny!, 0);
    const submit = async () => {
        if (busy || !rows.length) return;
        setBusy(true);
        try {
            let changed = false;
            for (const row of rows.filter(row => !row.taskId)) {
                const quote = await http.post<Quote>("/fg/models/quote", row.quoteRequest);
                if (quote.estimatedCny === null || !Number.isFinite(quote.estimatedCny)) throw new Error(`${row.title} 最新报价不可用，未提交新任务`);
                if (quote.estimatedCny > row.quote.estimatedCny! + 0.000001) changed = true;
                row.quote = quote;
            }
            setRows([...rows]);
            if (changed) throw new Error("报价已上涨，请检查更新后的金额，再次确认提交");
            const remaining = await readBudget();
            if (remaining.remaining !== null && total > remaining.remaining) throw new Error("本批预计金额超过当前剩余额度，未提交新任务");
            const workspace = await getProjectUnitWorkspace(detail.project.id, unitId);
            for (const row of rows.filter(row => !row.taskId)) {
                if (!alive.current) break;
                const current = workspace.shots.find(shot => shot.id === row.shotId);
                if (current?.currentRevisionId !== row.revisionId || referenceKey(workspace.shotReferences, row.shotId) !== row.referenceKey) throw new Error(`${row.title} 脚本或参考已变化，请重新检查报价`);
                const operationId = (row.request.input?.metadata as { clientOperationId?: string })?.clientOperationId;
                if (workspace.tasks.some(task => task.clientContext?.shotId === row.shotId && task.clientContext?.artifactType === "video" && ["queued", "running"].includes(task.status) && task.clientOperationId !== operationId)) throw new Error(`${row.title} 已有其他视频任务，请先核对任务中心`);
                try {
                    for (const asset of [...row.autoAssets]) {
                        await linkShotAsset(detail.project.id, row.shotId, { assetVersionId: asset.primaryVersionId!, role: "reference" });
                        row.autoAssets = row.autoAssets.filter(item => item.id !== asset.id);
                        row.referenceKey = referenceKey((await getProjectUnitWorkspace(detail.project.id, unitId)).shotReferences, row.shotId);
                    }
                    const task = await createGenerationTask(row.request);
                    row.taskId = task.id; row.error = undefined;
                    setRows([...rows]); setStatus(`${row.title} 已提交 · ${task.id.slice(0, 8)}，生成在后台继续`);
                } catch (error) {
                    row.error = error instanceof Error ? error.message : "提交状态待确认";
                    setRows([...rows]);
                    throw new Error(`${row.title}：${row.error}；后续已停止。再次提交会复用本行操作ID，请勿重建批次重复提交。`);
                }
            }
            await onRefresh();
        } catch (error) { setStatus(error instanceof Error ? error.message : "批量提交失败"); message.warning("部分任务可能已提交，请核对下方任务ID和任务中心"); }
        finally { setBusy(false); }
    };
    return <AppModal open={open} title="批量生成镜头视频" width={760} onCancel={onClose} footer={<><Button onClick={onClose}>关闭</Button><Button loading={busy} disabled={!ids.length || busy || rows.some(row => row.taskId)} onClick={() => void prepare()}>检查参考与人民币报价</Button><Button type="primary" loading={busy} disabled={busy || !rows.some(row => !row.taskId) || !budget} onClick={() => void submit()}>确认提交未提交镜头 · 约 ¥{total.toFixed(4)}</Button></>}>
        <div className="grid gap-3">
            <Alert type="info" showIcon description={`使用当前视频模型、画幅和分辨率，保留每镜已保存的时长。已有后台任务自动跳过；没有引用时按角色、主场景和必要道具匹配。生成后仍可在任务中心查看。`} />
            <Select mode="multiple" disabled={busy || rows.some(row => row.taskId)} value={ids} maxTagCount="responsive" placeholder="选择镜头" options={shots.map(shot => ({ value: shot.id, label: `${formatShotOrdinal(shot.position)} · ${shot.title}` }))} onChange={value => { setIds(value); setRows([]); }} />
            <Button size="small" disabled={busy || rows.some(row => row.taskId)} onClick={() => { setIds(shots.map(shot => shot.id)); setRows([]); }}>选择本章全部镜头</Button>
            <Checkbox checked={useVoiceSamples} disabled={busy || rows.some(row => row.taskId)} onChange={event => { setUseVoiceSamples(event.target.checked); setRows([]); }}>使用已绑定角色的声音样本（仅参考音色，只演本镜头台词；默认关闭，勾选后才发送样音）</Checkbox>
            {!useVoiceSamples && <Alert type="warning" showIcon description="本批不发送已绑定声音样本，仅按各镜头文字声线生成，声音可能与角色样本不同。" />}
            {budget && <div>本月剩余额度：{budget.remaining === null ? "不限额" : `¥${budget.remaining.toFixed(4)}`}{budget.unknown ? ` · ${budget.unknown} 笔金额待确认，最终按后台准入判断` : ""}</div>}
            <div role="status" className="text-xs">{status}</div>
            <div className="max-h-[45dvh] space-y-2 overflow-y-auto">{rows.map(row => <div key={row.shotId} className="rounded border border-border p-3 text-xs"><strong>{row.title} · {row.seconds}s · 约 ¥{row.quote.estimatedCny!.toFixed(4)}</strong><p>模型：{modelDisplayName(config, row.request.model || "")}</p><p>参考：{row.names.join("、") || "未匹配图片，纯文本生成"}</p><details><summary>检查完整视频 Prompt</summary><pre className="whitespace-pre-wrap">{row.request.prompt}</pre></details>{row.taskId && <p>任务ID：{row.taskId} · 已提交</p>}{row.error && <p>{row.error}</p>}</div>)}</div>
            {rows.length > 0 && rows.every(row => row.taskId) && <Button onClick={() => { setRows([]); setIds([]); setStatus(""); }}>结束本批次</Button>}
        </div>
    </AppModal>;
}
