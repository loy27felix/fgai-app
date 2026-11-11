import { App, Button, Upload } from "antd";
import { ImagePlus, Trash2 } from "lucide-react";
import { useState } from "react";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { styleReferenceResourceIds, withStyleReferenceResources, MAX_STYLE_REFERENCE_IMAGES, type StyleProfileSnapshot } from "@/lib/canvas/style-profile";
import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import { uploadImage } from "@/services/image-storage";
import { useAssetStore } from "@/stores/use-asset-store";

export function StyleReferenceImages({ profile, onChange }: { profile: StyleProfileSnapshot; onChange: (patch: Partial<StyleProfileSnapshot>) => void }) {
    const { message } = App.useApp();
    const [uploading, setUploading] = useState(false);
    const ids = styleReferenceResourceIds(profile);
    const update = (next: string[]) => onChange(withStyleReferenceResources(profile, next));
    return (
        <div className="space-y-4">
            <div>
                <h3 className="text-sm font-semibold">画风参考图（选填）</h3>
                <p className="mt-2 text-sm leading-6 text-foreground/65">可以上传 1–6 张参考图，统一光影、色彩、材质和视觉媒介。也可以不上传，只使用项目文字画风。参考图不替换角色身份、服装或场景设定。</p>
            </div>
            <Upload
                accept="image/png,image/jpeg,image/webp"
                showUploadList={false}
                disabled={uploading || ids.length >= MAX_STYLE_REFERENCE_IMAGES}
                beforeUpload={async (file) => {
                    if (uploading || ids.length >= MAX_STYLE_REFERENCE_IMAGES) return Upload.LIST_IGNORE;
                    setUploading(true);
                    try {
                        const image = await uploadImage(file);
                        const id = resourceIdFromStorageKey(image.storageKey);
                        if (!id) throw Error("图片尚未保存到资源库，请重试");
                        useAssetStore
                            .getState()
                            .addAsset({
                                kind: "image",
                                title: file.name,
                                coverUrl: image.url,
                                tags: ["画风参考"],
                                status: "confirmed",
                                source: "项目画风",
                                data: { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType },
                            });
                        update([...ids, id]);
                    } catch (error) {
                        message.error(error instanceof Error ? error.message : "参考图上传失败");
                    } finally {
                        setUploading(false);
                    }
                    return Upload.LIST_IGNORE;
                }}
            >
                <Button icon={<ImagePlus className="size-4" />} loading={uploading} disabled={ids.length >= MAX_STYLE_REFERENCE_IMAGES}>
                    上传画风参考图 · {ids.length}/6
                </Button>
            </Upload>
            {ids.length ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {ids.map((id, index) => (
                        <div key={id} className="overflow-hidden rounded-lg border border-border">
                            <CachedResourceImage storageKey={`resource:${id}`} src={resourceFileUrl(id)} alt={`画风参考 ${index + 1}`} className="aspect-video w-full object-cover" />
                            <div className="flex items-center justify-between p-2 text-xs">
                                <span>画风参考 {index + 1}</span>
                                <Button type="text" size="small" aria-label={`移除画风参考 ${index + 1}`} icon={<Trash2 className="size-3.5" />} onClick={() => update(ids.filter((value) => value !== id))} />
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-foreground/45">未上传参考图，生成时使用文字画风。</p>
            )}
        </div>
    );
}
