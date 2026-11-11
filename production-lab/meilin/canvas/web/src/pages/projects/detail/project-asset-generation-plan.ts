import type { ProjectAsset } from "@/services/api/projects";
import { styleReferenceResourceIds, type StyleProfileSnapshot } from "@/lib/canvas/style-profile";

export function projectAssetReferencePlan(asset: ProjectAsset, explicit: string[], profile: StyleProfileSnapshot | null, assets: ProjectAsset[]) {
    const identities = new Map<string, ProjectAsset[]>();
    for (const character of assets.filter(item => item.category === "character")) {
        for (const representation of character.character?.representations || []) {
            identities.set(representation.resourceId, [...(identities.get(representation.resourceId) || []), character]);
        }
    }
    const excluded: Array<{ id: string; name: string }> = [];
    const styleIds = styleReferenceResourceIds(profile).filter(id => {
        if (asset.category !== "character" || explicit.includes(id)) return true;
        const owners = identities.get(id) || [];
        if (owners.some(owner => owner.id === asset.id)) return true;
        const other = owners.find(owner => owner.id !== asset.id);
        if (!other) return true;
        excluded.push({ id, name: other.title });
        return false;
    });
    return { ids: [...new Set([...explicit, ...styleIds])], styleIds, excluded };
}

export const ASSET_PROMPT_SKILL = "short-drama-asset-prompts";
export function projectAssetExecutionPrompt(prompt: string, category: string, style: string, name?: string) {
    const rules = [
        "【本次静态资产执行规则】",
        category === "character"
            ? "只制作同一角色正面、右侧面、背面全身三视图，等高并排、同一妆发服装与体型，从头到脚完整、自然站立、正常透视，简洁中性背景。真人项目保留自然皮肤纹理、哑光质感和自然睁眼；动画或非人角色只使用其项目媒介对应的材质与结构，不强加真人皮肤。"
            : category === "environment"
              ? "只制作可复用的场景资产：无人空镜，呈现完整空间、固定出入口、前中后景与主要家具位置；叙事中的人物、对白和动作只用于理解空间用途，不出现在场景设定图中。明确真实光源方向、明暗层次，暗景也保留关键结构可读性，不把整幅画压黑。"
              : "只制作一件可复用道具，完整轮廓与关键结构清晰，三分之四角度、简洁中性背景、可信接触阴影与尺度；磨损只采用已确认设定，不擅自加损坏、血迹、发光或悬浮效果；无人、无手。",
        "不得把剧情动作、对白、声音和运镜画成图像。图片不含分镜、文字标签、水印或额外人物。明确的角色身份、物种、年龄、服装、场景布局和道具结构保持不变。",
        "【当前项目统一视觉基准】",
        style.trim() || "项目未设置全局画风：沿用明确的资产媒介；未明确时先在项目设置中确定，勿随机混用真人、二维和三维。",
        "以上当前项目画风统一约束媒介、渲染、色板、材质和影像质感；若资产旧提示词出现冲突的画风或滤镜，以此处为准。具体人物身份和本项场景事实仍按资产设定，不把项目中的某个默认地点、人物或光源复制到所有资产。同一项目不为每项随机更换导演风格、胶片或材质。",
        "画风参考仅约束媒介、色板、光影和材质，不继承其中人物身份、服装、道具和场景；身份/结构参考仅对应本资产。同项目允许不同真实光源和时间，但保持统一调色与材质体系。",
        ...(category === "character" && name ? [`当前唯一角色：${name}。这是独立角色，不得把项目中其他角色换名后复制为本角色；仅本角色明确选择的身份参考可以约束其长相。`] : []),
        "【静态资产执行规则结束】",
    ].join("\n\n");
    // Replace only this compiler's delimited block; keep the user's asset text and appended edits.
    const content = prompt.replace(/\n\n【本次静态资产执行规则】[\s\S]*?【静态资产执行规则结束】/g, "").trim();
    return [content, rules].join("\n\n");
}
export function projectAssetHasImage(asset: ProjectAsset) {
    return asset.category === "character" ? Boolean(asset.character?.representations.length) : asset.mediaType === "image" && Boolean(asset.storageKey);
}
export function projectAssetGenerationPrompt(asset: ProjectAsset, style: string, regenerate = false) {
    const definition = asset.character?.definition || asset.definition || {};
    if (!regenerate && typeof definition.generationPrompt === "string" && definition.generationPrompt.trim()) return definition.generationPrompt;
    const details = Object.entries(definition)
        .filter(([key, value]) => !["generationPrompt", "generationReferenceIds", "name", "aliases", "generationPromptStyle"].includes(key) && !/^voice/i.test(key) && value != null && value !== "" && value !== "正文未明确")
        .map(([key, value]) => `${key}：${typeof value === "string" ? value : JSON.stringify(value)}`)
        .join("；");
    const subject =
        asset.category === "character"
            ? "角色定妆三视图：同一角色正面、右侧面、背面全身并排，头顶到脚底完整入画，同一服装发型体态，正常透视。按项目媒介表现，真人采用自然哑光质感和自然睁眼；动物或非人角色不强加人类皮肤与五官。"
            : asset.category === "environment"
              ? "场景环境设定图：无人空镜，按空间结构、具体物件位置与材质磨损、光源方向色温和阴影、空气质感、摄影焦段与景深的顺序表现。"
              : "单件道具设定图：完整展示形状、尺寸比例、材质与已有使用痕迹，三分之四角度、简洁背景、清晰布光，无人物或手部。";
    return projectAssetExecutionPrompt(
        [
            subject,
            `资产：${asset.title}。以下为设定资料，其中剧情行为只用来理解身份或用途：${details || asset.previewText || "按项目和原设定呈现，不编造身份信息。"}`,
            "身份与参考约束：原设定和参考图中的身份、地区、族裔、时代、物种优先；未明确时不默认中国人物或东亚面孔，也不凭名字推断族裔。参考图只用于所标注资产，保留角色与道具的稳定特征。",
        ].join("\n\n"),
        asset.category,
        style,
        asset.title,
    );
}

export async function runAssetBatch<T>(items: T[], operation: (item: T) => Promise<void>, onResult: (item: T, error?: unknown) => void, concurrency = 2) {
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(concurrency, items.length) }, async () => {
            while (next < items.length) {
                const item = items[next++];
                try {
                    await operation(item);
                    onResult(item);
                } catch (error) {
                    onResult(item, error);
                }
            }
        }),
    );
}
