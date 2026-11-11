import { Dropdown } from "antd";
import { ChevronDown, Images, Video } from "lucide-react";
import type { AiConfig } from "@/stores/use-config-store";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { resolveVideoOperationForModel, supportsMixedVideoFrameImages, type ModelInputSummary } from "@/lib/model-selection";
import type { CanvasNodeMetadata, CanvasVideoEditOperation } from "@/types/canvas";

export function CanvasVideoModePicker({ config, input, operation, imageIds, onChange }: {
    config: AiConfig;
    input: ModelInputSummary;
    operation?: string;
    imageIds: string[];
    onChange: (patch: Partial<CanvasNodeMetadata>) => void;
}) {
    const resolved = resolveVideoOperationForModel(config, config.model, input, operation);
    const operations = modelCapabilityConfigFor(config, config.model).video?.operations || [];
    const hasMedia = input.imageCount + input.characterCount + input.videoCount + input.audioCount > 0;
    const modes = [
        { key: "text_to_video", label: "文生视频", disabled: hasMedia || !operations.includes("text_to_video") },
        { key: "reference_to_video", label: "全能参考", disabled: !hasMedia || !operations.includes("reference_to_video") },
        { key: "image_to_video", label: "首尾帧", disabled: imageIds.length < 1 || (imageIds.length > 2 && !supportsMixedVideoFrameImages(config, config.model)) || input.videoCount > 0 || input.audioCount > 0 || !operations.includes("image_to_video") },
    ];
    return <Dropdown trigger={["click"]} menu={{
        selectedKeys: [resolved], items: modes,
        onClick: ({ key }) => onChange({
            videoEditOperation: key as CanvasVideoEditOperation,
            videoStartFrameNodeId: key === "image_to_video" ? imageIds[0] : undefined,
            videoEndFrameNodeId: key === "image_to_video" ? imageIds[1] : undefined,
            ...(key === "image_to_video" && /seedance.*2[.-]5/i.test(config.model) ? { size: "adaptive" } : {}),
        }),
    }}>
        <button type="button" data-canvas-no-zoom aria-label="视频生成模式" className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[var(--fs-tiny)] hover:bg-foreground/5" title="连接素材后自动选择模型支持的参考模式；文生视频需要先断开媒体连接">
            {resolved === "text_to_video" ? <Video className="size-3" /> : <Images className="size-3" />}
            {modes.find(mode => mode.key === resolved)?.label || "生成模式"}<ChevronDown className="size-3 opacity-60" />
        </button>
    </Dropdown>;
}
