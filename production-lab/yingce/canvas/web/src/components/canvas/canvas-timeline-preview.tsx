import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Music2, Pause, Play } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { resolveMediaUrl } from "@/services/file-storage";
import { formatTimelineTime, getTimelineVisualEndMs } from "@/lib/timeline/timeline-view";
import { createDefaultSubtitleStyle } from "@/types/timeline";
import type { TimelineClip, TimelineTrack } from "@/types/timeline";
import type { CanvasNodeData } from "@/types/canvas";
import { CanvasSubtitleOverlay } from "./canvas-subtitle-overlay";

type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];

type CanvasTimelinePreviewProps = {
    clips: TimelineClip[];
    tracks: TimelineTrack[];
    nodes: CanvasNodeData[];
    playheadMs: number;
    playing: boolean;
    theme: CanvasTheme;
    onTogglePlay: () => void;
    onPlayheadChange: (ms: number) => void;
};

const PREVIEW_WIDTH = 300;
const PREVIEW_HEIGHT = 168;
const AUTO_ADVANCE_GAP_MS = 500;
const containsPlayhead = (clip: TimelineClip, ms: number) => ms >= clip.startMs && ms < clip.startMs + clip.durationMs;

function TimelineAudioClipPreview({ clip, node, playheadMs, playing, onReady }: {
    clip: TimelineClip;
    node?: CanvasNodeData;
    playheadMs: number;
    playing: boolean;
    onReady: (id: string, ready?: "ready" | "unavailable") => void;
}) {
    const ref = useRef<HTMLAudioElement>(null);
    const [url, setUrl] = useState("");
    const storageKey = clip.directMedia?.storageKey || node?.metadata?.storageKey;
    const fallback = clip.directMedia?.url || clip.directMedia?.dataUrl || node?.metadata?.content || "";
    useEffect(() => {
        let active = true;
        const audio = ref.current;
        setUrl("");
        void resolveMediaUrl(storageKey, fallback).then((value) => {
            if (!active) return;
            if (value) setUrl(value);
            else onReady(clip.id, "unavailable");
        }).catch(() => { if (active) onReady(clip.id, "unavailable"); });
        return () => {
            active = false;
            audio?.pause();
            onReady(clip.id);
        };
    }, [clip.id, fallback, onReady, storageKey]);

    const sync = useCallback((audio: HTMLAudioElement, forceSeek = false) => {
        if (!url || audio.readyState < 1) return;
        const elapsed = Math.max(0, playheadMs - clip.startMs);
        const target = ((clip.sourceStartMs || 0) + elapsed) / 1000;
        if (forceSeek || Math.abs(audio.currentTime - target) > (playing ? 0.2 : 0.02)) audio.currentTime = target;
        const fadeIn = clip.fadeInMs ? elapsed / clip.fadeInMs : 1;
        const fadeOut = clip.fadeOutMs ? (clip.durationMs - elapsed) / clip.fadeOutMs : 1;
        audio.volume = Math.min(1, Math.max(0, (clip.volume ?? 1) * Math.min(1, fadeIn, fadeOut)));
        if (playing && audio.paused) {
            void audio.play().catch((error) => {
                if (error?.name !== "AbortError") onReady(clip.id, "unavailable");
            });
        } else if (!playing) audio.pause();
    }, [clip, onReady, playheadMs, playing, url]);
    useEffect(() => { if (ref.current) sync(ref.current); }, [sync]);

    return <audio ref={ref} src={url || undefined} preload="auto" onLoadedMetadata={event => sync(event.currentTarget, true)} onCanPlay={() => onReady(clip.id, "ready")} onError={() => onReady(clip.id, "unavailable")} />;
}

/**
 * 纯视频沿用媒体时钟；有音频轨时使用时间线时钟，使裁剪、重叠和空白区间对齐。
 */
export function CanvasTimelinePreview({ clips, tracks, nodes, playheadMs, playing, theme, onTogglePlay, onPlayheadChange }: CanvasTimelinePreviewProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [videoUrl, setVideoUrl] = useState("");
    const [videoSize, setVideoSize] = useState<{ width: number; height: number } | null>(null);
    // 源内定位目标（秒）；视频换源后 metadata 尚未加载时先记录，loadedmetadata 后再应用。
    const targetSeekSecRef = useRef<number | null>(null);

    const videoClips = useMemo(() => clips.filter((clip) => clip.kind === "video").sort((a, b) => a.startMs - b.startMs), [clips]);
    const audioClips = useMemo(() => {
        const inactive = new Set(tracks.filter(track => track.muted || track.visible === false).map(track => track.id));
        return clips.filter(clip => clip.kind === "audio" && !inactive.has(clip.trackId));
    }, [clips, tracks]);
    const activeAudioClips = audioClips.filter(clip => containsPlayhead(clip, playheadMs));
    const [audioStatus, setAudioStatus] = useState<Record<string, "ready" | "unavailable" | undefined>>({});
    const onAudioReady = useCallback((id: string, status?: "ready" | "unavailable") => {
        setAudioStatus(current => {
            if (current[id] === status) return current;
            const next = { ...current };
            if (status) next[id] = status;
            else delete next[id];
            return next;
        });
    }, []);
    const audioReady = activeAudioClips.every(clip => audioStatus[clip.id]);
    const clockWithAudio = audioClips.length > 0;
    const previewEndMs = getTimelineVisualEndMs([...videoClips, ...audioClips]);
    const playheadRef = useRef(playheadMs);
    playheadRef.current = playheadMs;
    const toggleRef = useRef(onTogglePlay);
    toggleRef.current = onTogglePlay;
    useEffect(() => {
        if (!playing || !clockWithAudio || !audioReady) return;
        let previous = performance.now();
        const timer = window.setInterval(() => {
            const now = performance.now();
            const next = Math.min(previewEndMs, playheadRef.current + now - previous);
            previous = now;
            playheadRef.current = next;
            onPlayheadChange(next);
            if (next >= previewEndMs) {
                window.clearInterval(timer);
                toggleRef.current();
            }
        }, 40);
        return () => window.clearInterval(timer);
    }, [audioReady, clockWithAudio, onPlayheadChange, playing, previewEndMs]);
    const activeVideoClip = useMemo(() => videoClips.find((clip) => playheadMs >= clip.startMs && playheadMs < clip.startMs + clip.durationMs) || null, [playheadMs, videoClips]);
    const activeSubtitleClip = useMemo(() => clips.find((clip) => clip.kind === "subtitle" && playheadMs >= clip.startMs && playheadMs < clip.startMs + clip.durationMs && Boolean(clip.text?.trim())) || null, [clips, playheadMs]);
    const activeNode = useMemo(() => (activeVideoClip ? nodes.find((node) => node.id === activeVideoClip.nodeId) || null : null), [activeVideoClip, nodes]);
    const subtitleStyle = activeNode?.metadata?.subtitleStyle || createDefaultSubtitleStyle();
    const activeHighlight = useMemo(() => {
        if (!activeSubtitleClip || activeSubtitleClip.subtitleEntryIndex === undefined || activeSubtitleClip.subtitleEntryIndex < 0 || !activeNode) return undefined;
        // subtitleEntryIndex 与字幕条目 index 同为 1 基，直接匹配，不再 +1（此前高亮永远匹配不上）。
        return (activeNode.metadata?.subtitleHighlights || []).find((item) => item.entryIndex === activeSubtitleClip.subtitleEntryIndex);
    }, [activeNode, activeSubtitleClip]);

    // 解析当前片段视频地址（与字幕弹窗同一套缓存/回退策略）。
    useEffect(() => {
        const node = activeNode;
        const media = activeVideoClip?.directMedia;
        setVideoUrl("");
        setVideoSize(null);
        if (!node && !media) return;
        let cancelled = false;
        // 直连媒体片段（directMedia，不落画布）与画布节点走同一套稳定资源地址解析策略。
        const storageKey = node?.metadata?.storageKey || media?.storageKey || "";
        const fallback = node?.metadata?.content || media?.url || "";
        void resolveMediaUrl(storageKey, fallback).then((url) => {
            if (!cancelled) setVideoUrl(url);
        });
        return () => {
            cancelled = true;
        };
    }, [activeNode, activeVideoClip]);

    // 播放/暂停与外部跳转（标尺拖动）时同步视频位置；播放前先定位到片段源内起点，
    // 避免裁剪后的片段从原始视频 0s 开始播放；播放期间视频时间反向驱动播放头，不做回跳。
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !activeVideoClip || !videoUrl) return;
        const sourceStartSec = (activeVideoClip.sourceStartMs || 0) / 1000;
        const sourceDurationSec = (activeVideoClip.sourceDurationMs || activeVideoClip.durationMs) / 1000;
        const targetSec = sourceStartSec + Math.max(0, playheadMs - activeVideoClip.startMs) / 1000;
        const clampedTargetSec = Math.min(targetSec, sourceStartSec + Math.max(0, sourceDurationSec - 0.05));
        targetSeekSecRef.current = clampedTargetSec;
        if (video.readyState >= 1 && Math.abs(video.currentTime - clampedTargetSec) > (playing && clockWithAudio ? 0.2 : 0.05)) {
            video.currentTime = clampedTargetSec;
        }
        if (playing && (!clockWithAudio || audioReady)) {
            void video.play().catch(() => undefined);
        } else {
            video.pause();
        }
    }, [activeVideoClip, audioReady, clockWithAudio, playheadMs, playing, videoUrl]);

    // 视频换源后元数据加载完成，应用之前记录的源内定位目标。
    const handleVideoLoadedMetadata = (video: HTMLVideoElement) => {
        if (video.videoWidth > 0 && video.videoHeight > 0) setVideoSize({ width: video.videoWidth, height: video.videoHeight });
        if (targetSeekSecRef.current != null && video.readyState >= 1) {
            const target = Math.min(targetSeekSecRef.current, Math.max(0, (video.duration || 0) - 0.05));
            if (Math.abs(video.currentTime - target) > 0.05) video.currentTime = target;
        }
    };

    const handleTimeUpdate = () => {
        const video = videoRef.current;
        if (!video || !activeVideoClip || !playing || clockWithAudio) return;
        const sourceStartSec = (activeVideoClip.sourceStartMs || 0) / 1000;
        const timelineMs = activeVideoClip.startMs + Math.round((video.currentTime - sourceStartSec) * 1000);
        onPlayheadChange(Math.max(0, timelineMs));
        const clipEndMs = activeVideoClip.startMs + activeVideoClip.durationMs;
        if (timelineMs >= clipEndMs) {
            const next = videoClips.find((clip) => clip.startMs >= clipEndMs - AUTO_ADVANCE_GAP_MS && clip.id !== activeVideoClip.id);
            if (next) {
                onPlayheadChange(next.startMs);
            } else {
                onTogglePlay();
            }
        }
    };

    const previewDisplay = useMemo(() => {
        if (!videoSize || videoSize.height <= 0) return null;
        const ratio = videoSize.width / videoSize.height;
        let width = PREVIEW_WIDTH;
        let height = width / ratio;
        if (height > PREVIEW_HEIGHT) {
            height = PREVIEW_HEIGHT;
            width = Math.round(height * ratio);
        }
        return { width: Math.round(width), height: Math.round(height) };
    }, [videoSize]);

    return (
        <div className="flex items-center gap-3 border-b px-4 py-2" style={{ borderColor: theme.toolbar.border, background: theme.toolbar.panel }}>
            {activeAudioClips.map(clip => <TimelineAudioClipPreview key={clip.id} clip={clip} node={nodes.find(node => node.id === clip.nodeId)} playheadMs={playheadMs} playing={playing && audioReady && audioStatus[clip.id] === "ready"} onReady={onAudioReady} />)}
            <div className="relative grid shrink-0 place-items-center overflow-hidden rounded-lg bg-black" style={{ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }} data-canvas-no-zoom>
                {videoUrl && activeVideoClip ? (
                    <div className="relative" style={previewDisplay ? { width: previewDisplay.width, height: previewDisplay.height } : { width: "100%", height: "100%" }}>
                        <video ref={videoRef} className="block h-full w-full" src={videoUrl} playsInline preload="metadata" onLoadedMetadata={(event) => handleVideoLoadedMetadata(event.currentTarget)} onTimeUpdate={handleTimeUpdate} />
                        {activeSubtitleClip ? <CanvasSubtitleOverlay text={activeSubtitleClip.text || ""} highlight={activeHighlight} style={subtitleStyle} /> : null}
                    </div>
                ) : clockWithAudio ? (
                    <div className="flex flex-col items-center gap-2 text-xs text-white/80"><Music2 className="size-7" /><span>音频预览</span></div>
                ) : (
                    <div className="px-4 text-center text-xs text-white/60">该位置无视频片段</div>
                )}
                {(videoUrl && activeVideoClip) || clockWithAudio ? (
                    <button
                        type="button"
                        className={videoUrl && activeVideoClip ? "absolute inset-0 z-10 grid place-items-center" : "absolute bottom-3 z-10 grid place-items-center"}
                        aria-label={playing ? "暂停预览" : "播放预览"}
                        onClick={(event) => {
                            event.stopPropagation();
                            if (!playing && clockWithAudio && playheadMs >= previewEndMs) onPlayheadChange(0);
                            onTogglePlay();
                        }}
                    >
                        <span className={`grid size-10 place-items-center rounded-full text-white transition-colors ${videoUrl ? "bg-black/45 backdrop-blur hover:bg-black/60" : "bg-white/20 hover:bg-white/30"}`}>
                            {playing ? <Pause className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
                        </span>
                    </button>
                ) : null}
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs">
                    <span className="truncate font-semibold" style={{ color: theme.accent.primary }}>
                        {activeVideoClip?.title || activeAudioClips[0]?.title || (clockWithAudio ? "此处无音频片段" : "无视频片段")}
                    </span>
                    <span className="opacity-45 tabular-nums">{clockWithAudio ? `${formatTimelineTime(playheadMs)} / ${formatTimelineTime(previewEndMs)}` : activeVideoClip ? `${formatTimelineTime(activeVideoClip.startMs)} ~ ${formatTimelineTime(activeVideoClip.startMs + activeVideoClip.durationMs)}` : ""}</span>
                </div>
                {playing && !audioReady ? <p className="mt-2 text-xs opacity-60">正在加载音频…</p> : null}
                {activeAudioClips.some(clip => audioStatus[clip.id] === "unavailable") ? <p className="mt-2 text-xs text-red-500" role="status">部分音频无法播放，请检查原素材。</p> : null}
                <div className="mt-2 max-h-16 min-h-10 overflow-y-auto rounded-lg border px-2 py-2 text-xs leading-5" style={{ borderColor: theme.toolbar.border, background: theme.node.fill }}>
                    {activeSubtitleClip ? activeSubtitleClip.text : <span className="opacity-40">此处无字幕，点选字幕片段后在下方编辑</span>}
                </div>
            </div>
        </div>
    );
}
