import type { TimelineClip, TimelineProject } from "@/types/timeline";

export function getAudibleTimelineClips(timeline: TimelineProject) {
    const inactive = new Set(timeline.tracks.filter((track) => track.muted || track.visible === false).map((track) => track.id));
    return timeline.clips.filter((clip) => clip.kind === "audio" && clip.durationMs > 0 && !inactive.has(clip.trackId));
}

export function buildTimelineAudioArgs(clips: TimelineClip[], inputs: ReadonlyMap<string, string>, output: string) {
    if (!clips.length) throw new Error("时间线没有可导出的音频片段");
    const indexByNode = new Map(Array.from(inputs.keys(), (id, index) => [id, index]));
    const filters = clips.map((clip, index) => {
        const inputIndex = indexByNode.get(clip.nodeId);
        if (inputIndex === undefined) throw new Error("找不到音频素材：" + (clip.title || clip.nodeId));
        const duration = clip.durationMs / 1000;
        const volume = Math.max(0, Math.min(1, clip.volume ?? 1));
        const fadeIn = clip.fadeInMs || 0;
        const fadeOut = clip.fadeOutMs || 0;
        const gain = "min(1,min(" + (fadeIn > 0 ? "t/" + (fadeIn / 1000) : "1") + "," + (fadeOut > 0 ? "(" + duration + "-t)/" + (fadeOut / 1000) : "1") + "))";
        return [
            `[${inputIndex}:a:0]atrim=start=${(clip.sourceStartMs || 0) / 1000}:duration=${duration}`,
            "asetpts=PTS-STARTPTS",
            "aformat=sample_rates=44100:channel_layouts=stereo",
            `volume='${volume}*max(0,${gain})':eval=frame`,
            `adelay=${Math.round(clip.startMs)}:all=1[clip${index}]`,
        ].join(",");
    });
    const endSeconds = Math.max(...clips.map((clip) => clip.startMs + clip.durationMs)) / 1000;
    const labels = clips.map((_, index) => `[clip${index}]`).join("");
    filters.push(`${labels}amix=inputs=${clips.length}:normalize=0,apad,atrim=duration=${endSeconds}[audio]`);
    return [...Array.from(inputs.values()).flatMap((file) => ["-i", file]), "-filter_complex", filters.join(";"), "-map", "[audio]", "-c:a", "libmp3lame", "-b:a", "192k", output];
}
