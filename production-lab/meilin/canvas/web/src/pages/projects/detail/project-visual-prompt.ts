export function projectVisualPrompt(input: { name: string; category: string; definition: Record<string, unknown>; style?: string }) {
    const details = Object.entries(input.definition).filter(([, value]) => value !== null && value !== "" && value !== undefined).map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`).join("\n");
    if (!details) throw new Error("请先编辑并保存场景或道具的外观设定");
    const subject = input.category === "environment" ? "场景环境设定图，明确空间布局、建筑、材质、时间和光线，画面中不添加人物" : "道具设定图，完整展示同一件道具的形态、结构、材质和细节，主体清晰，背景简洁，不添加人物";
    return [`制作可供后续镜头参考的${subject}。`, `名称：${input.name}`, details, input.style ? `项目画风：\n${input.style}` : "", "忠于已有设定，不绘制分镜、字幕、文字标签或水印。"].filter(Boolean).join("\n");
}
