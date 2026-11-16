import type { ProjectAsset, ProjectUnit } from "@/services/api/projects";
import type { GenerationTask } from "@/services/api/task-center";

export function recommendProjectAsset(asset: Pick<ProjectAsset, "title" | "category" | "definition">, units: Pick<ProjectUnit, "sourceText">[]) {
    if (asset.category !== "prop") return { selected: true, reason: asset.category === "character" ? "角色需要保持形象一致" : "场景需要保持空间一致" };
    const definition = asset.definition || {};
    const purpose = [definition.narrativeFunction, definition.plotFunction, definition.storyRole, definition.plotImportance, definition.importance, definition.description, definition.role, definition.purpose]
        .filter((v) => typeof v === "string")
        .join(" ");
    const critical =
        definition.continuityRequired === true ||
        definition.importance === "key" ||
        definition.importance === "critical" ||
        /关键道具|核心道具|重要线索|关键线索|决定性|凶器|证物|身份信物|反转关键|key evidence|murder weapon|plot[- ]critical/i.test(purpose);
    if (critical) return { selected: true, reason: "推动剧情或承担关键线索，即使只出现一次也保留" };
    if (definition.importance === "recurring") return { selected: true, reason: "章节分析标记为重复出场，需要保持外观一致" };
    const aliases = Array.isArray(definition.aliases) ? definition.aliases.filter((v): v is string => typeof v === "string" && v.trim().length > 1) : [];
    const names = [...new Set([asset.title.trim(), ...aliases])].filter((v) => v.length > 1);
    let mentions = 0,
        chapters = 0;
    for (const unit of units) {
        const text = unit.sourceText.toLocaleLowerCase();
        // Aliases within one chapter must not multiply the same occurrence.
        const count = Math.max(0, ...names.map((name) => text.split(name.toLocaleLowerCase()).length - 1));
        mentions += count;
        if (count) chapters++;
    }
    if (chapters > 1 || mentions > 1) return { selected: true, reason: `剧本中重复提及 ${mentions} 次，涉及 ${chapters} 个章节` };
    return { selected: false, reason: mentions ? "只出现一次的普通道具，默认不单独建资产" : "未找到重复出场或关键剧情依据，默认不选；可手动保留" };
}

export function projectAssetTaskID(task: GenerationTask) {
    if (task.clientContext?.assetId) return task.clientContext.assetId;
    // Compatibility for cached task responses from older clients.
    try {
        const m = JSON.parse(task.inputJson || "{}").metadata || {};
        return String(m.assetId || m.characterAssetId || "");
    } catch {
        return "";
    }
}

export function projectAssetTaskState(tasks: GenerationTask[], asset: Pick<ProjectAsset, "id" | "updatedAt">) {
    const task = tasks.filter((item) => projectAssetTaskID(item) === asset.id).sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""))[0];
    if (!task) return undefined;
    if (task.status === "queued") return { active: true, text: "排队中", task };
    if (task.status === "running") return { active: true, text: task.mediaStage && task.mediaStage !== "completed" ? "正在保存生成结果" : `生成中${task.progress ? ` · ${Math.min(99, task.progress)}%` : ""}`, task };
    if (task.status === "failed" && Date.parse(task.updatedAt || task.createdAt) > Date.parse(asset.updatedAt)) return { active: false, text: "生成失败，可重新生成", task };
    return undefined;
}
