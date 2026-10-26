import { useState } from "react";
import { App, Checkbox } from "antd";
import { CachedResourceImage } from "@/components/cached-resource-image";
import type { ProjectAsset } from "@/services/api/projects";
import type { StoryboardRow } from "@/types/canvas";
import { storyboardRowReferencePlan } from "./chapter-storyboard-production";

type Review = { index: number; title: string; assets: ProjectAsset[]; selected: string[] };
function ReferenceSelection({ reviews, onChange }: { reviews: Review[]; onChange: (choices: Record<number, string[]>) => void }) {
    const [choices, setChoices] = useState<Record<number, string[]>>(Object.fromEntries(reviews.map(review => [review.index, review.selected])));
    return <div className="max-h-[60vh] space-y-5 overflow-auto">
        <p>模型结果已保存，无需重新生成。请为下面片段选择最多 6 项图片参考；角色身份优先，普通道具可用文字描述。若确实需要超过 6 个出场角色，建议导入后拆分镜头再生成。</p>
        {reviews.map(review => <section key={review.index}>
            <strong>{review.title} · 已选 {choices[review.index].length}/6</strong>
            <div className="mt-2 grid grid-cols-2 gap-2">{review.assets.map(asset => {
                const representation = asset.character?.representations.find(item => item.role === "turnaround_sheet") || asset.character?.representations.find(item => item.mediaType === "image");
                const storageKey = representation ? `resource:${representation.resourceId}` : asset.mediaType === "image" ? asset.storageKey : undefined;
                return <label className="flex items-center gap-2 rounded border border-border p-2" key={asset.id}>
                    <Checkbox checked={choices[review.index].includes(asset.id)} onChange={event => {
                        const next = { ...choices, [review.index]: event.target.checked ? [...choices[review.index], asset.id] : choices[review.index].filter(id => id !== asset.id) };
                        setChoices(next); onChange(next);
                    }} />
                    <div className="h-12 w-14 shrink-0"><CachedResourceImage storageKey={storageKey} alt={asset.title} className="h-full w-full object-contain" variant="thumbnail" /></div>
                    <span className="text-xs">{asset.title}<small className="block opacity-60">{asset.category === "character" ? "角色" : asset.category === "environment" ? "场景" : "道具 / 素材"}</small></span>
                </label>;
            })}</div>
        </section>)}
    </div>;
}

export function useStoryboardReferenceReview() {
    const { modal, message } = App.useApp();
    return (rows: StoryboardRow[], assets: ProjectAsset[]) => {
        const reviews = rows.flatMap((row, index): Review[] => {
            const plan = storyboardRowReferencePlan(row, assets);
            return plan.needsReview ? [{ index, title: `片段 ${index + 1}`, assets: plan.candidates, selected: plan.selectedIds }] : [];
        });
        if (!reviews.length) return Promise.resolve(undefined);
        return new Promise<Record<number, string[]>>((resolve, reject) => {
            let choices = Object.fromEntries(reviews.map(review => [review.index, review.selected]));
            modal.confirm({ title: "核对本集参考资产", width: 760, centered: true,
                content: <ReferenceSelection reviews={reviews} onChange={next => { choices = next; }} />,
                okText: "确认参考并导入分镜", cancelText: "稍后核对，保留生成结果",
                onOk: async () => {
                    if (Object.values(choices).some(ids => ids.length > 6)) {
                        void message.warning("每段最多选择 6 项参考，请取消多余勾选后再确认");
                        throw new Error("参考资产超过 6 项");
                    }
                    resolve(choices);
                },
                onCancel: () => reject(new Error("已保留生成结果，可稍后重试导入；没有重新生成或扣费")),
            });
        });
    };
}
