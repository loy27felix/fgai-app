import { expect, test } from "bun:test";
import { buildTimelineAudioArgs, getAudibleTimelineClips } from "@/lib/timeline/timeline-audio-args";
import type { TimelineClip, TimelineProject } from "@/types/timeline";

test("audio export trims repeated sources, preserves gaps and skips inactive tracks", () => {
    const clip: TimelineClip = { id: "first", kind: "audio", nodeId: "source", trackId: "audio", startMs: 200, durationMs: 800, sourceStartMs: 500, volume: 0.75, fadeInMs: 100 };
    const timeline: TimelineProject = {
        version: 2,
        durationMs: 3000,
        tracks: [
            { id: "audio", label: "Audio", kind: "audio", order: 0 },
            { id: "muted", label: "Muted", kind: "audio", order: 1, muted: true },
            { id: "hidden", label: "Hidden", kind: "audio", order: 2, visible: false },
        ],
        clips: [
            clip,
            { ...clip, id: "second", startMs: 1200, durationMs: 500, sourceStartMs: 1500, fadeOutMs: 150 },
            { ...clip, id: "muted", nodeId: "muted-source", trackId: "muted", startMs: 2200 },
            { ...clip, id: "hidden", nodeId: "hidden-source", trackId: "hidden", startMs: 2200 },
        ],
    };
    const clips = getAudibleTimelineClips(timeline);
    expect(clips.map((item) => item.id)).toEqual(["first", "second"]);
    const args = buildTimelineAudioArgs(clips, new Map([["source", "input"]]), "output.mp3");
    expect(args.slice(0, 3)).toEqual(["-i", "input", "-filter_complex"]);
    expect(args[3]).toContain("[0:a:0]atrim=start=0.5:duration=0.8");
    expect(args[3]).toContain("[0:a:0]atrim=start=1.5:duration=0.5");
    expect(args[3]).toContain("adelay=1200:all=1");
    expect(args[3]).toContain("amix=inputs=2:normalize=0,apad,atrim=duration=1.7");
    expect(args.at(-1)).toBe("output.mp3");
});
