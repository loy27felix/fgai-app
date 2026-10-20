import { useEffect, useMemo, useState } from "react";
import { App, Alert, Button, Checkbox, Input, Spin } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import { ModelPicker } from "@/components/model-picker";
import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { FGPricePreview } from "@/components/fg-price-preview";
import { shortDramaMediaDefault } from "@/lib/short-drama-models";
import { FGSkillControl } from "@/components/fg-skill-control";
import { composeFGImageStylePrompt, fgImageStyles } from "@/services/fg-image-styles";
import { fgSkillCatalog } from "@/services/fg-skill-catalog";
import { skillRuntime } from "@/services/skill-runtime";
import { parseStyleProfile, styleReferenceResourceIds } from "@/lib/canvas/style-profile";
import { AssetLibraryPickerModal } from "@/components/assets/asset-library-picker-modal";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { canvasThemes } from "@/lib/canvas-theme";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { resolveProjectCanvasStyle } from "@/components/canvas/canvas-style-picker-modal";
import { shortDramaSkillProvenance } from "@/lib/prompts/short-drama-skill-context";
import { submitBackendGenerationTask, prepareBackendGenerationTask } from "@/services/api/generation-task";
import { listGenerationTasks } from "@/services/api/task-center";
import { resourceFileUrl, resourceIdFromStorageKey, resourceStorageKey, getResource } from "@/services/api/resources";
import { uploadImage } from "@/services/image-storage";
import { useAssetStore } from "@/stores/use-asset-store";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { confirmProjectAssetCandidate, ignoreProjectAssetCandidate, listProjectAssetsPage, listProjectAssetCandidates, updateProjectAssetVisual, updateProjectCharacter, type ProjectAsset, type ProjectDetail } from "@/services/api/projects";
import { characterTurnaroundConfig } from "./project-character-media";
import { ASSET_PROMPT_SKILL, projectAssetExecutionPrompt, projectAssetGenerationPrompt, projectAssetHasImage, runAssetBatch } from "./project-asset-generation-plan";
import { categoryLabel, categoryLabels } from "./shared";
import { recommendProjectAsset, projectAssetTaskID } from "./project-asset-review";

type Row = { id: string; asset: ProjectAsset; candidateId?: string; prompt: string; references: string[]; selected: boolean; operationId: string; status?: string; error?: string; taskId?: string; selectionReason?: string };
const visualCategories = new Set(["character", "environment", "prop"]);
export function ProjectAssetGenerationModal({ detail, single, onClose, onRefresh }: { detail: ProjectDetail; single?: ProjectAsset; onClose: () => void; onRefresh: () => void }) {
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const theme = canvasThemes[useActiveTheme()];
    const [config, setConfig] = useState(() => {
        const model = detail.project.defaultImageModel || shortDramaMediaDefault(effectiveConfig, "image");
        return characterTurnaroundConfig({ ...effectiveConfig, model, imageModel: model });
    });
    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [pickerId, setPickerId] = useState<string>();
    const [prices, setPrices] = useState<Record<string, number | undefined>>({});
    const style = useMemo(() => resolveProjectCanvasStyle(detail.project.stylePresetId, detail.project.styleProfileJson), [detail.project.stylePresetId, detail.project.styleProfileJson]);
    const change = (id: string, patch: Partial<Row>) => setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    const styleProfile = useMemo(() => parseStyleProfile(detail.project.styleProfileJson), [detail.project.styleProfileJson]);
    const referenceIds = (row: Row) => [...new Set([...row.references, ...styleReferenceResourceIds(styleProfile)])];
    const executionPrompt = (row: Row) => {
        const styleIds = fgImageStyles.filter((skill) => row.prompt.includes(`@[skill:${skill.skillId}]`) || row.prompt.includes(`@${skill.slug}`)).map((skill) => skill.skillId);
        return projectAssetExecutionPrompt(composeFGImageStylePrompt(row.prompt, styleIds) || row.prompt, row.asset.category, style?.prompt || "");
    };
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const tasks = await listGenerationTasks(500, { projectId: detail.project.id, activeOnly: true });
                const activeIds = new Set(
                    tasks.flatMap((task) => {
                        try {
                            return [projectAssetTaskID(task)].filter(Boolean);
                        } catch {
                            return [];
                        }
                    }),
                );
                let assets = single ? [single] : [];
                const candidates: Row[] = [];
                if (!single) {
                    for (let page = 1; ; page++) {
                        const result = await listProjectAssetsPage(detail.project.id, { page, pageSize: 100 });
                        assets.push(...result.assets);
                        if (page * 100 >= result.total) break;
                    }
                    for (let page = 1; ; page++) {
                        const result = await listProjectAssetCandidates(detail.project.id, { page, pageSize: 100, status: "pending_confirmation" });
                        for (const c of result.candidates) {
                            if (!visualCategories.has(c.category)) continue;
                            const definition = JSON.parse(c.detailsJson || "{}");
                            const asset = { id: c.id, title: c.name, category: c.category, definition, mediaType: "text", status: "pending_confirmation", versionCount: 0, usages: [], position: 0, updatedAt: c.updatedAt } as ProjectAsset;
                            const recommendation = recommendProjectAsset(asset, detail.units);
                            candidates.push({
                                id: c.id,
                                asset,
                                candidateId: c.id,
                                prompt: projectAssetGenerationPrompt(asset, style?.prompt || ""),
                                references: [],
                                selected: recommendation.selected,
                                selectionReason: recommendation.reason,
                                operationId: crypto.randomUUID(),
                            });
                        }
                        if (page * 100 >= result.total) break;
                    }
                }
                const confirmed = assets
                    .filter((a) => visualCategories.has(a.category))
                    .map((asset) => {
                        const d = asset.character?.definition || asset.definition || {};
                        return {
                            id: asset.id,
                            asset,
                            prompt: projectAssetGenerationPrompt(asset, style?.prompt || ""),
                            references: Array.isArray(d.generationReferenceIds)
                                ? d.generationReferenceIds.filter((id): id is string => typeof id === "string")
                                : asset.character?.representations[0]?.resourceId
                                  ? [asset.character.representations[0].resourceId]
                                  : asset.storageKey
                                    ? [resourceIdFromStorageKey(asset.storageKey)].filter((id): id is string => Boolean(id))
                                    : [],
                            selected: !activeIds.has(asset.id) && (Boolean(single) || (!projectAssetHasImage(asset) && recommendProjectAsset(asset, detail.units).selected)),
                            selectionReason: single ? undefined : recommendProjectAsset(asset, detail.units).reason,
                            operationId: crypto.randomUUID(),
                            ...(activeIds.has(asset.id) ? { status: "生成中，请在任务中心查看" } : {}),
                        };
                    });
                if (!cancelled) setRows([...candidates, ...confirmed]);
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : "读取资产失败");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [detail.project.id, single, style]);
    const selected = rows.filter((row) => row.selected && !row.status);
    const selectedCandidates = selected.filter((row) => row.candidateId);
    const unselectedProps = rows.filter((row) => row.candidateId && row.asset.category === "prop" && !row.selected && !row.status);
    const ignoreUnselectedProps = async () => {
        if (busy) return;
        setBusy(true);
        let ignored = 0,
            failed = 0;
        await runAssetBatch(
            unselectedProps,
            async (row) => {
                await ignoreProjectAssetCandidate(detail.project.id, row.candidateId!);
            },
            (row, error) => {
                if (error) {
                    failed++;
                    change(row.id, { error: error instanceof Error ? error.message : "忽略失败" });
                } else {
                    ignored++;
                    change(row.id, { status: "已忽略，不单独建资产", selected: false });
                }
            },
        );
        setBusy(false);
        onRefresh();
        message[failed ? "warning" : "success"](`已忽略 ${ignored} 项普通道具${failed ? `，${failed} 项未完成` : ""}，没有发起生成`);
    };
    const quoted = selected.every((row) => typeof prices[row.id] === "number");
    const total = selected.reduce((sum, row) => sum + (prices[row.id] || 0), 0);
    const refresh = () => onRefresh();
    const savePrompts = async () => {
        if (busy) return;
        setBusy(true);
        let failed = 0;
        await runAssetBatch(
            selected.filter((row) => !row.candidateId),
            async (row) => {
                const asset = row.asset;
                const definition = { ...(asset.character?.definition || asset.definition || {}), generationPrompt: row.prompt, generationReferenceIds: row.references };
                const result =
                    asset.category === "character"
                        ? await updateProjectCharacter(detail.project.id, asset.id, { name: asset.title, definition })
                        : await updateProjectAssetVisual(detail.project.id, asset.id, { versionId: asset.primaryVersionId, definition });
                change(row.id, { asset: result.asset });
            },
            (row, error) => {
                if (error) {
                    failed++;
                    change(row.id, { error: error instanceof Error ? error.message : "保存失败" });
                }
            },
        );
        setBusy(false);
        refresh();
        message[failed ? "warning" : "success"](failed ? "部分提示词保存失败，请查看对应条目" : "提示词与参考图已保存，没有提交生成");
    };
    const confirmRow = async (row: Row) => (row.candidateId ? (await confirmProjectAssetCandidate(detail.project.id, row.candidateId)).asset : row.asset);
    const execute = async (generate: boolean) => {
        if (busy) return;
        const chosen = generate ? selected : selectedCandidates;
        if (!chosen.length) return;
        setBusy(true);
        setError("");
        let submitted = 0,
            failed = 0;
        try {
            const provenance = (await shortDramaSkillProvenance()).filter((skill) => skill.name === ASSET_PROMPT_SKILL);
            const catalog = generate && chosen.some((row) => /@\[skill:|@zy-|@lira-|@cinema-|@deepwhite-/.test(row.prompt)) ? await fgSkillCatalog.list() : [];
            await runAssetBatch(
                chosen,
                async (row) => {
                    if (generate && !row.prompt.trim()) throw Error("请填写图片提示词");
                    const styleSkillIds = fgImageStyles.filter((skill) => row.prompt.includes(`@[skill:${skill.skillId}]`) || row.prompt.includes(`@${skill.slug}`)).map((skill) => skill.skillId);
                    const generationPrompt = executionPrompt(row);
                    // Direct image models receive the selected style's visual direction, not a multi-step Skill workflow.
                    // Read selected Skill versions/files for auditable provenance while preserving the editable user prompt.
                    const styleRuntime = generate && styleSkillIds.length ? await skillRuntime.prepare({ profile: "canvas", prompt: row.prompt, skills: catalog, selectedSkillIds: styleSkillIds, capability: "image" }) : undefined;
                    const referenceImages = await Promise.all(
                        referenceIds(row).map(async (id) => {
                            const resource = await getResource(id);
                            const isStyle = styleReferenceResourceIds(styleProfile).includes(id);
                            return {
                                id,
                                name: isStyle ? "画风参考（仅色彩、光影、材质和媒介）" : `${row.asset.title} · 身份或结构参考`,
                                type: resource.mimeType,
                                dataUrl: "",
                                storageKey: resourceStorageKey(id),
                                width: resource.width,
                                height: resource.height,
                                bytes: resource.size,
                            };
                        }),
                    );
                    if (generate) await prepareBackendGenerationTask({ projectId: detail.project.id, mode: "image", prompt: generationPrompt, config, referenceImages });
                    let asset = await confirmRow(row);
                    change(row.id, { asset, candidateId: undefined });
                    if (!generate) return;
                    const definition = { ...(asset.character?.definition || asset.definition || {}), generationPrompt: row.prompt, generationReferenceIds: row.references };
                    asset =
                        asset.category === "character"
                            ? (await updateProjectCharacter(detail.project.id, asset.id, { name: asset.title, definition })).asset
                            : (await updateProjectAssetVisual(detail.project.id, asset.id, { versionId: asset.primaryVersionId, definition })).asset;
                    change(row.id, { asset });
                    const task = await submitBackendGenerationTask({
                        projectId: detail.project.id,
                        mode: "image",
                        prompt: generationPrompt,
                        config,
                        referenceImages,
                        clientOperationId: row.operationId,
                        metadata: {
                            operation: asset.category === "character" ? "character_turnaround" : "project_asset_image",
                            assetId: asset.id,
                            assetVersionId: asset.primaryVersionId,
                            characterAssetId: asset.category === "character" ? asset.id : undefined,
                            resolvedCharacterVersions: asset.character ? [{ assetId: asset.id, versionId: asset.character.versionId }] : [],
                            assetPromptSkill: provenance,
                            assetPromptExecution: { method: "asset-template-compiler-v2", editablePrompt: row.prompt, finalPrompt: generationPrompt, projectStyleRevision: styleProfile?.revision, projectStylePrompt: style?.prompt || "" },
                            imageStyleSkillIds: styleSkillIds,
                            imageStyleExecution: styleRuntime ? { method: "curated-image-direction", ...styleRuntime.metadata, directions: styleSkillIds.map((id) => fgImageStyles.find((skill) => skill.skillId === id)) } : undefined,
                            stylePresetId: style?.id,
                            styleProfileJson: detail.project.styleProfileJson,
                            source: "project-asset-batch",
                        },
                    });
                    change(row.id, { taskId: task.id });
                },
                (row, e) => {
                    if (e) {
                        failed++;
                        change(row.id, { error: e instanceof Error ? e.message : "提交失败", status: generate ? "提交未完成，请核对任务记录" : "确认失败", selected: false });
                    } else {
                        submitted++;
                        change(row.id, { selected: !generate, status: generate ? "已提交生成" : undefined });
                    }
                },
            );
            message[failed ? "warning" : "success"](`已${generate ? "提交" : "确认"} ${submitted} 项${failed ? `，${failed} 项未完成` : ""}`);
            refresh();
        } catch (e) {
            setError(e instanceof Error ? e.message : "批量处理失败");
        } finally {
            setBusy(false);
        }
    };
    return (
        <AppModal
            className="workspace-modal"
            width={1000}
            title={single ? `图片生成设置 · ${single.title}` : "批量确认与生成资产"}
            open
            onCancel={onClose}
            footer={
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <span>
                        已选 {selected.length} 项 · {quoted ? `预估合计 ≈¥${total.toFixed(4)}` : "合计价格待确认"}
                    </span>
                    <div className="flex gap-2">
                        <Button onClick={onClose}>{busy ? "关闭并在后台继续" : "关闭"}</Button>
                        {!single && (
                            <Button disabled={busy || !unselectedProps.length} onClick={() => void ignoreUnselectedProps()}>
                                批量忽略未选道具（{unselectedProps.length}）
                            </Button>
                        )}
                        {!single && (
                            <Button disabled={busy || !selectedCandidates.length} onClick={() => void execute(false)}>
                                仅确认所选（不收费）
                            </Button>
                        )}
                        <Button disabled={busy || !selected.some((row) => !row.candidateId)} onClick={() => void savePrompts()}>
                            保存提示词
                        </Button>
                        <Button type="primary" loading={busy} disabled={loading || !selected.length} onClick={() => void execute(true)}>
                            确认并生成 {selected.length} 项
                        </Button>
                    </div>
                </div>
            }
        >
            <div className="grid gap-4">
                <Alert type="info" showIcon title={`继承项目画风：${style?.title || "尚未设置"}`} description="每项提示词和参考图可在下面核对修改。确认后按所选模型计费，任务进入后台队列，完成后自动绑定为新资产版本。已配图资产默认不选。" />
                {!single && (
                    <Alert
                        type="success"
                        showIcon
                        title="已自动筛选重点资产"
                        description="默认保留角色、场景、重复出场道具和关键剧情道具；普通一次性道具默认不选。筛选不收费、不删除候选，你仍可手动调整，然后一次确认所选。"
                        action={
                            <Button
                                disabled={busy}
                                onClick={() =>
                                    setRows((current) =>
                                        current.map((row) => {
                                            const choice = recommendProjectAsset(row.asset, detail.units);
                                            return { ...row, selected: !row.status && choice.selected && (Boolean(row.candidateId) || !projectAssetHasImage(row.asset)), selectionReason: choice.reason };
                                        }),
                                    )
                                }
                            >
                                重新自动筛选
                            </Button>
                        }
                    />
                )}
                <details>
                    <summary>查看全局画风与世界观</summary>
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs">{style?.prompt || "项目未设置画风，可先在项目设置中补充地区、时代、视觉媒介和角色身份。"}</pre>
                </details>
                {styleReferenceResourceIds(styleProfile).length > 0 && <p className="text-xs text-foreground/65">已继承 {styleReferenceResourceIds(styleProfile).length} 张画风参考图，随每项资产一起提交。只参考光影、色彩和材质。</p>}
                {!styleReferenceResourceIds(styleProfile).length && <p className="text-xs text-foreground/65">当前使用文字画风约束，未添加画风参考图。可在项目设置上传统一的画风样片，提升整组资产的视觉一致性；不会自动引用其他角色的脸或场景。</p>}
                <ModelPicker
                    config={config}
                    value={config.model}
                    capability="image"
                    onChange={(model) => {
                        setPrices({});
                        setConfig(characterTurnaroundConfig({ ...effectiveConfig, model, imageModel: model }));
                    }}
                />
                <ImageSettingsPanel
                    config={config}
                    theme={theme}
                    showCount={false}
                    onConfigChange={(key, value) => {
                        setPrices({});
                        setConfig((c) => ({ ...c, [key]: value }));
                    }}
                />
                <div className="flex flex-wrap gap-2">
                    <Button disabled={busy} onClick={() => setRows((current) => current.map((r) => ({ ...r, selected: !r.status })))}>
                        选择全部可生成资产
                    </Button>
                    <Button disabled={busy} onClick={() => setRows((current) => current.map((r) => ({ ...r, selected: !r.status && !projectAssetHasImage(r.asset) })))}>
                        只选未配图资产
                    </Button>
                    <Button disabled={busy} onClick={() => setRows((current) => current.map((r) => ({ ...r, selected: false })))}>
                        取消选择
                    </Button>
                </div>
                {error && <Alert type="error" title={error} />}{" "}
                {loading ? (
                    <Spin />
                ) : (
                    <div className="grid max-h-[45vh] gap-3 overflow-auto pr-2">
                        {rows.map((row) => (
                            <div key={row.id} className="rounded-lg border border-border p-3">
                                <div className="flex items-center justify-between gap-2">
                                    <Checkbox checked={row.selected} disabled={busy || Boolean(row.status)} onChange={(e) => change(row.id, { selected: e.target.checked })}>
                                        {row.asset.title} · {categoryLabel(row.asset.category)}
                                        {row.candidateId ? " · 待确认" : ""}
                                    </Checkbox>
                                    <span className="text-xs">{row.status}</span>
                                </div>
                                {row.selectionReason && <p className="mt-1 text-xs text-foreground/60">筛选依据：{row.selectionReason}</p>}
                                {projectAssetHasImage(row.asset) && !(row.asset.character?.definition || row.asset.definition || {}).generationPrompt && (
                                    <p className="mt-2 text-xs text-foreground/55">历史图片未记录完整提示词；下方为按现有设定整理的重新生成草稿。</p>
                                )}
                                <Input.TextArea className="mt-2" aria-label={`${row.asset.title} 生图提示词`} autoSize={{ minRows: 5, maxRows: 12 }} value={row.prompt} disabled={busy} onChange={(e) => change(row.id, { prompt: e.target.value })} />
                                <details className="mt-2 text-xs text-foreground/65">
                                    <summary>查看提交提示词预览（含当前项目画风与静态资产规则）</summary>
                                    <p>服务端会核对最新项目画风，最终执行内容保存在任务记录中。</p>
                                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">
                                        {(() => {
                                            try {
                                                return executionPrompt(row);
                                            } catch (e) {
                                                return e instanceof Error ? e.message : "提示词暂不可用";
                                            }
                                        })()}
                                    </pre>
                                </details>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <FGSkillControl references={[]} prompt={row.prompt} onChange={(prompt) => change(row.id, { prompt })} disabled={busy} capability="image" imageStylesOnly />
                                    <Button size="small" disabled={busy} onClick={() => change(row.id, { prompt: projectAssetGenerationPrompt(row.asset, style?.prompt || "", true) })}>
                                        按当前设定重建提示词
                                    </Button>
                                    <Button size="small" disabled={busy} onClick={() => setPickerId(row.id)}>
                                        选择或上传参考图（{row.references.length}）
                                    </Button>
                                    {row.selected && !row.status && (
                                        <FGPricePreview
                                            config={config}
                                            model={config.model}
                                            mode="image"
                                            requirements={{ input: { textCount: 0, imageCount: referenceIds(row).length, videoCount: 0, audioCount: 0, characterCount: 0 } }}
                                            onQuote={(quote) => setPrices((current) => (current[row.id] === quote?.estimatedCny ? current : { ...current, [row.id]: quote?.estimatedCny ?? undefined }))}
                                        />
                                    )}
                                </div>
                                <div className="mt-2 flex gap-2">
                                    {row.references.map((id) => (
                                        <button key={id} type="button" disabled={busy} title="点击移除参考图" onClick={() => change(row.id, { references: row.references.filter((v) => v !== id) })}>
                                            <CachedResourceImage storageKey={resourceStorageKey(id)} src={resourceFileUrl(id)} alt="参考图" className="h-16 w-16 rounded object-cover" />
                                        </button>
                                    ))}
                                </div>
                                {row.error && (
                                    <p role="alert" className="mt-2 text-sm text-red-500">
                                        {row.error}。不自动重复提交；请先核对任务中心。
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
            <AssetLibraryPickerModal
                open={Boolean(pickerId)}
                remoteLibrary
                remoteKind="image"
                acceptRemoteItems
                items={[]}
                categoryLabels={categoryLabels}
                multiple
                title="生图参考图片"
                onClose={() => setPickerId(undefined)}
                upload={{
                    accept: "image/png,image/jpeg,image/webp",
                    description: "上传参考图并保存到素材库",
                    onUpload: async (files) => {
                        const ids: string[] = [];
                        for (const file of Array.from(files)) {
                            const result = await uploadImage(file);
                            ids.push(
                                useAssetStore.getState().addAsset({
                                    kind: "image",
                                    title: file.name,
                                    coverUrl: result.url,
                                    tags: [],
                                    status: "confirmed",
                                    source: "资产生图参考",
                                    data: { dataUrl: result.url, storageKey: result.storageKey, width: result.width, height: result.height, bytes: result.bytes, mimeType: result.mimeType },
                                }),
                            );
                        }
                        return ids;
                    },
                }}
                onConfirm={(_ids, items) => {
                    const row = rows.find((r) => r.id === pickerId);
                    if (!row) return;
                    const ids = (items || []).flatMap((item) => {
                        const a = item.asset;
                        return a?.kind === "image" ? [resourceIdFromStorageKey(a.data.storageKey)].filter((id): id is string => Boolean(id)) : [];
                    });
                    if (!ids.length) throw Error("参考图尚未保存到资源库");
                    change(row.id, { references: [...new Set([...row.references, ...ids])] });
                    setPickerId(undefined);
                }}
            />
        </AppModal>
    );
}
