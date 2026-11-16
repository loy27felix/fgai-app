import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { TimelineClip, TimelineTrack } from "@/types/timeline";

test("the timeline plays a trimmed audio clip without video and pauses at its end", async () => {
    const dom = new Window({ url: "http://localhost/" });
    for (const key of ["window", "document", "navigator", "Element", "HTMLElement", "Node"] as const) {
        Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom : dom[key] });
    }
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const { act, useState } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { canvasThemes } = await import("@/lib/canvas-theme");
    const { CanvasTimelinePreview } = await import("@/components/canvas/canvas-timeline-preview");
    const tracks: TimelineTrack[] = [{ id: "audio", kind: "audio", label: "Audio", order: 0 }];
    const clips: TimelineClip[] = [{
        id: "clip", nodeId: "direct-audio", kind: "audio", trackId: "audio", title: "Trimmed audio",
        startMs: 0, durationMs: 160, sourceStartMs: 2000,
        directMedia: { id: "audio", kind: "audio", title: "Audio", url: "data:audio/wav;base64,AA==" },
    }];
    let position = 0;
    function Harness() {
        const [playing, setPlaying] = useState(false);
        const [head, setHead] = useState(0);
        position = head;
        return <CanvasTimelinePreview clips={clips} tracks={tracks} nodes={[]} playheadMs={head} playing={playing} theme={Object.values(canvasThemes)[0]} onPlayheadChange={setHead} onTogglePlay={() => setPlaying(value => !value)} />;
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => root.render(<Harness />));
        const audio = host.querySelector("audio")!;
        let paused = true;
        let startedAt = 0;
        Object.defineProperties(audio, {
            readyState: { value: 4 },
            paused: { get: () => paused },
            play: { value: async () => { startedAt = audio.currentTime; paused = false; } },
            pause: { value: () => { paused = true; } },
        });
        await act(async () => audio.dispatchEvent(new dom.Event("canplay") as unknown as Event));
        await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="播放预览"]')!.click());
        expect(startedAt).toBe(2);
        expect(paused).toBe(false);
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 260)); });
        expect(position).toBe(160);
        expect(paused).toBe(true);
        expect(host.querySelector('[aria-label="播放预览"]')).not.toBeNull();
    } finally {
        await act(async () => root.unmount());
        host.remove();
        dom.happyDOM.abort();
    }
});
