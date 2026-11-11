// 第三期：时间线导出运行时。把 buildTimelineRenderPlan 产出的步骤交给 runTimelineRenderPlan 在 ffmpeg.wasm 中执行，
// 复用 canvas-video-merge.ts 的 loadFFmpeg（本地同源加载 core/wasm），媒体读写与清理逻辑保持一致。
import { fetchFile } from "@ffmpeg/util";
import { nanoid } from "nanoid";

import { loadFFmpeg } from "@/lib/canvas/canvas-video-merge";
import { getMediaBlob } from "@/services/file-storage";
import type { TimelineProject } from "@/types/timeline";
import { buildTimelineAudioArgs, getAudibleTimelineClips } from "./timeline-audio-args";
import { runTimelineRenderPlan, type TimelineExportProgress, type TimelineExportResult } from "./timeline-export-runner";
import { buildTimelineRenderPlan, type TimelineRenderContext, type TimelineRenderSource } from "./timeline-to-ffmpeg";

export type { TimelineExportProgress, TimelineExportResult } from "./timeline-export-runner";

export type TimelineExportOptions = {
    onProgress?: (progress: TimelineExportProgress) => void;
    context?: Partial<TimelineRenderContext>;
};

type TimelineSourceLocation = Pick<TimelineRenderSource, "nodeId" | "storageKey" | "url">;

async function fetchSourceBlob(source: TimelineSourceLocation, mediaLabel = "视频"): Promise<Blob> {
    if (source.storageKey) {
        const stored = await getMediaBlob(source.storageKey);
        if (stored) return stored;
    }
    if (source.url) {
        const response = await fetch(source.url);
        if (!response.ok) throw new Error(mediaLabel + "资源请求失败（" + response.status + "）");
        return response.blob();
    }
    throw new Error("找不到素材 " + source.nodeId + " 的媒体文件");
}

export async function exportTimelineAudio(timeline: TimelineProject, sources: ReadonlyMap<string, TimelineSourceLocation>, onProgress: (percent: number, detail: string) => void): Promise<Blob> {
    const clips = getAudibleTimelineClips(timeline);
    const sourceIds = new Set(clips.map((clip) => clip.nodeId));
    if (!sourceIds.size) throw new Error("时间线没有可导出的音频片段");
    const prefix = "timeline-audio-" + nanoid();
    const outputName = prefix + ".mp3";
    const inputs = new Map<string, string>();
    onProgress(0, "加载剪辑工具");
    const ffmpeg = await loadFFmpeg();
    try {
        for (const nodeId of sourceIds) {
            const source = sources.get(nodeId);
            if (!source) throw new Error("找不到音频素材：" + (clips.find((clip) => clip.nodeId === nodeId)?.title || nodeId));
            const file = prefix + "-" + inputs.size;
            inputs.set(nodeId, file);
            onProgress(10 + Math.round(((inputs.size - 1) / sourceIds.size) * 40), "读取音频素材");
            await ffmpeg.writeFile(file, await fetchFile(await fetchSourceBlob(source, "音频")));
        }
        onProgress(55, "合成剪辑音频");
        if ((await ffmpeg.exec(buildTimelineAudioArgs(clips, inputs, outputName))) !== 0) throw new Error("音频合成失败，请确认源素材可以播放");
        const output = await ffmpeg.readFile(outputName);
        if (typeof output === "string" || !output.byteLength) throw new Error("音频合成未返回文件");
        return new Blob([output as BlobPart], { type: "audio/mpeg" });
    } finally {
        await Promise.all([...inputs.values(), outputName].map((file) => ffmpeg.deleteFile(file).catch(() => undefined)));
    }
}

/** 导出时间线为 MP4：写媒体 → 按计划逐步执行 → 返回成片与降级提示（下载由调用方处理） */
export async function exportTimelineToMp4(timeline: TimelineProject, sources: TimelineRenderSource[], options: TimelineExportOptions = {}): Promise<TimelineExportResult> {
    const { onProgress, context } = options;
    onProgress?.({ phase: "loading", percent: 0, detail: "加载 FFmpeg" });
    const ffmpeg = await loadFFmpeg(({ phase, progress }) => onProgress?.({ phase: phase === "loading" ? "loading" : "reading", percent: progress, detail: phase === "loading" ? "加载 FFmpeg" : "读取素材" }));
    const plan = buildTimelineRenderPlan(timeline, sources, context);
    return runTimelineRenderPlan(ffmpeg, timeline, sources, plan, {
        readSource: async (source) => fetchFile(await fetchSourceBlob(source)),
        onProgress,
    });
}
