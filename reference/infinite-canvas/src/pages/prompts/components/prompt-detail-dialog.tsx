import { useState } from "react";
import { Copy, FileText, FolderPlus } from "lucide-react";
import { Button, Modal, Space, Tag } from "antd";

import { formatPromptDate, type Prompt } from "@/reference/infinite-canvas/src/services/api/prompts";

export function PromptDetailDialog({ prompt, onClose, onCopy, onSaveAsset }: { prompt: Prompt | null; onClose: () => void; onCopy: (prompt: string) => void; onSaveAsset?: (prompt: Prompt) => void }) {
    const previewMedia = prompt?.previewMedia?.length ? prompt.previewMedia : (prompt?.coverUrl ? [{ kind: "image" as const, url: prompt.coverUrl }] : []);
    const primaryMedia = previewMedia.find((media) => media.kind === "video") || previewMedia[0];
    const extraImages = previewMedia.filter((media) => media.kind === "image" && media.url !== prompt?.coverUrl).slice(0, 6);
    return (
        <Modal title={prompt?.title} open={Boolean(prompt)} onCancel={onClose} footer={null} width={720} centered styles={{ body: { height: "calc(85vh - 55px)", overflow: "hidden" } }}>
            {prompt ? (
                <div className="flex h-full min-h-0 flex-col">
                    <div className="shrink-0 space-y-3 pb-4">
                        {primaryMedia ? <PromptPreviewMedia key={`${prompt.id}:${primaryMedia.url}`} media={primaryMedia} coverUrl={prompt.coverUrl} title={prompt.title} /> : <div className="grid h-48 w-full place-items-center rounded-lg bg-stone-100 text-stone-400 dark:bg-stone-900 dark:text-stone-600 sm:h-56"><FileText className="size-9" /></div>}
                        {extraImages.length ? <div className="grid grid-cols-6 gap-2">{extraImages.map((media) => <img key={media.url} src={media.url} alt="" className="aspect-square w-full rounded-md object-cover" loading="lazy" onError={() => console.warn("[prompt preview image failed]", { promptId: prompt.id })} />)}</div> : null}
                    </div>
                    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto border-y border-stone-200 py-4 pr-2 dark:border-stone-800">
                        <div className="flex flex-wrap gap-1.5">
                            {prompt.tags.map((tag) => (
                                <Tag key={tag} className="m-0">
                                    {tag}
                                </Tag>
                            ))}
                        </div>
                        {prompt.description ? <p className="mt-4 text-sm leading-6 text-stone-500 dark:text-stone-400">{prompt.description}</p> : null}
                        {prompt.preview ? <pre className="mt-4 whitespace-pre-wrap rounded-lg bg-stone-100 p-3 text-xs leading-5 text-stone-600 dark:bg-stone-900 dark:text-stone-300">{prompt.preview}</pre> : null}
                        <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-stone-800 dark:text-stone-300">{prompt.prompt}</p>
                        {prompt.createdAt || prompt.updatedAt ? <div className="mt-4 text-xs text-stone-500 dark:text-stone-400">{prompt.createdAt ? `创建：${formatPromptDate(prompt.createdAt)}` : null}{prompt.createdAt && prompt.updatedAt ? " · " : null}{prompt.updatedAt ? `更新：${formatPromptDate(prompt.updatedAt)}` : null}</div> : null}
                    </div>
                    <div className="shrink-0 pt-4">
                        <Space wrap>
                            <Button type="primary" icon={<Copy className="size-4" />} onClick={() => onCopy(prompt.prompt)}>
                                复制提示词
                            </Button>
                            {onSaveAsset ? (
                                <Button icon={<FolderPlus className="size-4" />} onClick={() => onSaveAsset(prompt)}>
                                    加入我的资产
                                </Button>
                            ) : null}
                        </Space>
                    </div>
                </div>
            ) : null}
        </Modal>
    );
}

function PromptPreviewMedia({ media, coverUrl, title }: { media: Prompt["previewMedia"][number]; coverUrl: string; title: string }) {
    const [videoFailed, setVideoFailed] = useState(false);
    if (media.kind === "video" && !videoFailed) {
        return <video src={media.url} poster={coverUrl || undefined} controls preload="metadata" className="h-48 w-full rounded-lg bg-black object-cover sm:h-56" onError={() => { console.warn("[prompt preview video failed]", { url: media.url }); setVideoFailed(true); }} />;
    }
    if (coverUrl) return <img src={coverUrl} alt={title} className="h-48 w-full rounded-lg object-cover sm:h-56" onError={() => console.warn("[prompt preview image failed]", { title })} />;
    return <div className="grid h-48 w-full place-items-center rounded-lg bg-stone-100 text-sm text-stone-400 dark:bg-stone-900 dark:text-stone-600 sm:h-56">预览媒体暂时不可用</div>;
}
