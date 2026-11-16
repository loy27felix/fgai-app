export type ShotPromptValues = { videoPrompt?: string; imagePrompt?: string; actionBoardPrompt?: string; plotDescription: string; action?: string; dialogue?: string; continuityNotes?: string };

export function shotArtifactPrompt(stage: string, values: ShotPromptValues, projectStyle = "") {
    if (stage === "video") {
        const prompt = values.videoPrompt?.trim();
        if (prompt) return prompt;
        return [values.plotDescription, values.action, values.dialogue && `台词：${values.dialogue}`, values.continuityNotes].filter(Boolean).join("\n");
    }
    if (stage === "previz") return values.actionBoardPrompt?.trim() || [
        "黑白动作预演分镜图，一张图按时间顺序展示关键动作、走位和摄影机变化；每格是同一空间中实际发生的下一拍，保持人物身份、轴线、持物手、通行路径和道具状态。不要彩色定妆图，不添加原文没有的动作。",
        values.plotDescription, values.action, values.continuityNotes,
    ].filter(Boolean).join("\n\n");
    return [values.imagePrompt || values.plotDescription, "本视频真实开场的单帧分镜图，清晰呈现角色站位、景别、空间与关键道具；保留参考人物身份，不继承角色图棚拍背景。", projectStyle && `项目统一画风：${projectStyle}`, values.continuityNotes].filter(Boolean).join("\n\n");
}

export function actionBoardPromptFromBeats(json?: string) {
    try {
        const value = JSON.parse(json || "[]");
        if (Array.isArray(value)) return value.find(item => item?.kind === "artifact_prompt" && item.artifactType === "action_board")?.prompt || "";
    } catch { /* Historical revisions may have no beat payload. */ }
    return "";
}
