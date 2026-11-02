import { useEffect, useRef, useState } from "react";
import { App, Alert, Button, Checkbox, Input, Select } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import { ModelPicker } from "@/components/model-picker";
import { SkillRuntimePicker, useSkillRuntimeCatalog } from "@/components/skills/skill-runtime-picker";
import { createDramaProductionPlan, dramaSegmentDurations } from "@/lib/short-drama-production";
import { shortDramaMediaDefault } from "@/lib/short-drama-models";
import { resolveProjectCanvasStyle } from "@/components/canvas/canvas-style-picker-modal";
import { createProjectAssetCandidates, getProjectUnitWorkspace, replaceProjectUnitShots, type ProjectDetail } from "@/services/api/projects";
import { getShortDramaGPTStatus, shortDramaDefaultTextModel } from "@/services/short-drama-text";
import { useEffectiveConfig } from "@/stores/use-config-store";
import type { GenerationTask } from "@/services/api/task-center";
import { chapterStoryboardAssets, chapterStoryboardCharacters, loadChapterStoryboardAssets, storyboardRowsToProjectShots } from "./chapter-storyboard-production";
import { extractChapterAssets, generateChapterStoryboard } from "./project-chapter-ai";
import { runChapterBatch } from "./chapter-batch-runner";
import { useStoryboardReferenceReview } from "./storyboard-reference-review";

export function ChapterBatchModal({ detail, open, onClose, onRefresh, onTask }: { detail: ProjectDetail; open: boolean; onClose: () => void; onRefresh: () => void; onTask: (unitId: string, kind: "characters" | "storyboard", task: GenerationTask) => void }) {
    const { message } = App.useApp();
    const reviewReferences = useStoryboardReferenceReview();
    const config = useEffectiveConfig();
    const { skills, loading } = useSkillRuntimeCatalog();
    const [ids, setIds] = useState<string[]>([]);
    const [kind, setKind] = useState<"characters" | "storyboard">("characters");
    const [textModel, setTextModel] = useState("");
    const [videoModel, setVideoModel] = useState("");
    const [seconds, setSeconds] = useState(15);
    const [skillIds, setSkillIds] = useState<string[]>([]);
    const [action, setAction] = useState("");
    const [replace, setReplace] = useState(false);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState("");
    const [failures, setFailures] = useState<string[]>([]);
    const alive = useRef(true);
    const stop = useRef(false);
    useEffect(() => { alive.current = true; return () => { alive.current = false; stop.current = true; }; }, []);
    useEffect(() => {
        if (!open) return;
        setVideoModel(detail.project.defaultVideoModel || shortDramaMediaDefault(config, "video"));
        void getShortDramaGPTStatus().then(status => { if (alive.current) setTextModel(shortDramaDefaultTextModel(config, status.configured)); }).catch(error => message.error(error instanceof Error ? error.message : "文本模型读取失败"));
    }, [open]);
    const durations = dramaSegmentDurations(config, videoModel);
    const selectedSeconds = durations.includes(seconds) ? seconds : durations.includes(15) ? 15 : durations[0];
    const run = async () => {
        if (busy) return;
        const style = resolveProjectCanvasStyle(detail.project.stylePresetId, detail.project.styleProfileJson);
        if (kind === "storyboard" && !style?.prompt.trim()) return message.warning("请先设置全局画风");
        stop.current = false;
        setBusy(true);
        setFailures([]);
        let completed = 0;
        let skipped = 0;
        try {
            const assets = kind === "storyboard" ? await loadChapterStoryboardAssets(detail.project.id) : [];
            const outcomes = await runChapterBatch(ids, { stopped: () => stop.current || !alive.current, process: async (id, index) => {
                const workspace = await getProjectUnitWorkspace(detail.project.id, id);
                if (stop.current || !alive.current) return "skipped";
                if (workspace.tasks.some(task => (task.status === "queued" || task.status === "running") && task.clientContext?.chapterOperation === kind)) return "skipped";
                if (kind === "storyboard" && workspace.shots.length && !replace) return "skipped";
                const sourceText = workspace.unit.sourceText.replace(/<[^>]*>/g, " ").trim();
                if (!sourceText) return "skipped";
                setProgress(`${index + 1}/${ids.length} · ${workspace.unit.title}`);
                const options = { onTaskUpdate: (task: GenerationTask) => onTask(id, kind, task), onFallback: (text: string) => message.warning(text) };
                const input = { projectId: detail.project.id, projectName: detail.project.name, chapterId: id, chapterTitle: workspace.unit.title, sourceText, config: { ...config, model: textModel, textModel } };
                if (kind === "characters") {
                    const result = await extractChapterAssets({ ...input, projectStyle: style?.prompt || "" }, options);
                    const candidates = [
                        ...result.characters.map(asset => ({ unitId: id, name: asset.name, category: "character" as const, details: { ...asset } })),
                        ...result.scenes.map(asset => ({ unitId: id, name: asset.name, category: "environment" as const, details: { ...asset } })),
                        ...result.props.map(asset => ({ unitId: id, name: asset.name, category: "prop" as const, details: { ...asset } })),
                    ];
                    if (candidates.length) await createProjectAssetCandidates(detail.project.id, candidates, "chapter_character_extract");
                } else {
                    const snapshot = { ...detail, ...workspace, assets };
                    const result = await generateChapterStoryboard({ ...input, projectStyle: { presetId: style!.id, title: style!.title, prompt: style!.prompt, profileJson: detail.project.styleProfileJson }, characters: chapterStoryboardCharacters(snapshot, id), assets: chapterStoryboardAssets(snapshot), skills, selectedSkillIds: skillIds, productionPlan: createDramaProductionPlan(config, videoModel, selectedSeconds, "fixed"), actionDirection: action.trim() || undefined }, options);
                    const choices = await reviewReferences(result.rows, assets);
                    const shots = storyboardRowsToProjectShots(result.rows, snapshot, result.productionPlan, choices);
                    const saved = await replaceProjectUnitShots(detail.project.id, id, shots, workspace.shots.map(shot => shot.id));
                    const verified = await getProjectUnitWorkspace(detail.project.id, id);
                    if (saved.shots.length !== shots.length || verified.shots.length !== shots.length || saved.shots.some(shot => !verified.shots.some(item => item.id === shot.id))) throw new Error("分镜已提交，但列表尚未确认，请读取已保存结果，不要重新生成");
                }
                onRefresh();
                return "completed";
            }, onOutcome: outcome => {
                if (outcome.status === "completed") completed++;
                if (outcome.status === "skipped") skipped++;
                if (outcome.status === "failed" && alive.current) setFailures(current => [...current, `${detail.units.find(unit => unit.id === outcome.id)?.title || outcome.id}：${outcome.error}`]);
            } });
            setProgress(`已完成 ${completed} 章，跳过 ${skipped} 章，失败 ${outcomes.filter(item => item.status === "failed").length} 章${stop.current ? "；已停止后续提交" : ""}`);
        } catch (error) {
            message.error(`已完成 ${completed} 章，后续已停止：${error instanceof Error ? error.message : "批量任务失败"}`);
        } finally { if (alive.current) setBusy(false); onRefresh(); }
    };
    return <AppModal open={open} title="批量处理剧情章节" width={640} onCancel={onClose} footer={<><Button onClick={onClose}>{busy ? "关闭窗口，继续处理" : "关闭"}</Button>{busy ? <Button onClick={() => { stop.current = true; setProgress(value => `${value} · 本章完成后停止`); }}>停止后续提交</Button> : <Button type="primary" disabled={!ids.length || !textModel || (kind === "storyboard" && !selectedSeconds)} onClick={() => void run()}>开始处理 {ids.length} 章</Button>}</>}>
        <div className="grid gap-3">
            <Select value={kind} disabled={busy} onChange={setKind} options={[{ value: "characters", label: "提取角色、场景与必要道具" }, { value: "storyboard", label: "生成分镜与视频提示词" }]} />
            <Select mode="multiple" disabled={busy} value={ids} onChange={setIds} maxTagCount="responsive" showSearch optionFilterProp="label" placeholder="选择章节" options={detail.units.map((unit, index) => ({ value: unit.id, label: `第${index + 1}章 · ${unit.title}` }))} />
            <Button size="small" disabled={busy} onClick={() => setIds(detail.units.map(unit => unit.id))}>选择全部章节</Button>
            {!busy && <ModelPicker config={config} value={textModel} capability="text" onChange={setTextModel} fullWidth />}
            {kind === "storyboard" && <><ModelPicker config={config} value={videoModel} capability="video" onChange={setVideoModel} fullWidth /><Select disabled={busy} value={selectedSeconds} onChange={setSeconds} options={durations.map(value => ({ value, label: `每段固定 ${value} 秒，保持所选时长` }))} /><SkillRuntimePicker skills={skills} loading={loading} value={skillIds} onChange={setSkillIds} profile="shortDrama" /><Input.TextArea disabled={busy} value={action} onChange={event => setAction(event.target.value)} placeholder="有打戏时填写并确认：打法、能力、强度、环境与禁用项；填写后使用武戏导演 Skill" /><Checkbox disabled={busy} checked={replace} onChange={event => setReplace(event.target.checked)}>允许替换选中章节的现有分镜（包含关联产物；默认跳过已有分镜）</Checkbox></>}
            <Alert type="info" showIcon description="逐章处理，保留原文；文本按实际模型用量计费。个人 GPT 不扣公司额度；无 Key 或明确额度不足时使用 Sonnet 5.5。可关闭窗口继续，离开章节页面后停止提交后续章节，已提交任务继续在后台运行。" />
            {progress && <div role="status">{progress}</div>}
            {failures.length > 0 && <Alert type="warning" showIcon message="以下章节未完成，其余章节继续处理；原任务保留，不自动重复提交" description={failures.map((text, index) => <div key={index}>{text}</div>)} />}
        </div>
    </AppModal>;
}
