import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasNodeContent, type CanvasNodeContentProps } from "../src/components/canvas/canvas-node-content";
import { BatchPreviewImage } from "../src/components/canvas/canvas-node-media-content";
import { canvasThemes } from "../src/lib/canvas-theme";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const video: CanvasNodeData = {
    id: "video",
    type: CanvasNodeType.Video,
    title: "视频版本",
    position: { x: 0, y: 0 },
    width: 320,
    height: 180,
    metadata: { content: "https://example.com/result.mp4", status: "success", isBatchRoot: true, mediaStackKind: "video", batchChildIds: ["a", "b"], primaryImageId: "a" },
};
const props: CanvasNodeContentProps = {
    node: video,
    theme: canvasThemes.dark,
    renderLOD: "full",
    isEditingContent: false,
    textareaRef: { current: null },
    isBatchRoot: true,
    batchCount: 2,
    batchPreviewNodes: [{ ...video, id: "b" }],
    batchExpanded: false,
    batchOpening: false,
    batchRecovering: false,
    onContentChange: () => {},
    onStopEditing: () => {},
    mentionReferences: [],
};

test("folded video stack uses video preview and play control, never an image with the movie URL", () => {
    const markup = renderToStaticMarkup(<CanvasNodeContent {...props} />);
    expect(markup).not.toContain('src="https://example.com/result.mp4"');
    expect(markup).toContain("播放 视频版本");
    expect(markup).toContain("group/batch");
});

test("rear video cards use a passive video poster without loading an img from mp4 or showing a play control", () => {
    const markup = renderToStaticMarkup(<BatchPreviewImage node={video} theme={canvasThemes.dark} />);
    expect(markup).not.toContain('src="https://example.com/result.mp4"');
    expect(markup).toContain("group/video-preview");
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("<video");
});

test("image batches retain image previews", () => {
    const image = { ...video, type: CanvasNodeType.Image, metadata: { content: "https://example.com/photo.png" } };
    const markup = renderToStaticMarkup(<CanvasNodeContent {...props} node={image} batchPreviewNodes={[image]} />);
    expect(markup).toContain("group/batch");
    expect(markup).not.toContain("group/video-preview");
});

test("overview LOD keeps folded videos on the video poster path", () => {
    const markup = renderToStaticMarkup(<CanvasNodeContent {...props} renderLOD="preview" />);
    expect(markup).toContain("group/batch");
    expect(markup).toContain("group/video-preview");
    expect(markup).not.toContain('src="https://example.com/result.mp4"');
});
