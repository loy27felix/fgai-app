import { expect, test } from "bun:test";
import { shotArtifactPrompt, actionBoardPromptFromBeats } from "@/pages/projects/detail/shot-artifact-prompt";

test("自由编辑的视频提示词直接提交，不拼入旧剧本动作和对白", () => {
    const prompt = "只拍主角站起走向楼梯。对白：无。";
    expect(shotArtifactPrompt("video", { videoPrompt: prompt, plotDescription: "旧剧情", action: "旧动作", dialogue: "Old: Old dialogue.", continuityNotes: "旧衔接" })).toBe(prompt);
});

test("分镜首帧采用全局画风，动作预演独立使用黑白动作要求", () => {
    const values = { plotDescription: "小林在门右侧", imagePrompt: "雨夜门廊开场", action: "右手抬起警戒带，小雨接住后通过", continuityNotes: "灯在左手" };
    const storyboard = shotArtifactPrompt("storyboard", values, "暖色手绘动画");
    const previz = shotArtifactPrompt("previz", values, "暖色手绘动画");
    expect(storyboard).toContain("暖色手绘动画");
    expect(storyboard).not.toContain("黑白动作预演");
    expect(previz).toContain(values.action);
    expect(previz).toContain("黑白动作预演");
    expect(previz).not.toContain("暖色手绘动画");
});
test("完整导演提示词不重复追加第二份动作对白；自定义预演可以往返保存", () => {
    const prompt = "项目\n15秒｜多镜头\n【视频整体概念】\n小林：走。";
    expect(shotArtifactPrompt("video", { plotDescription: "画面", videoPrompt: prompt, dialogue: "小林：走。", action: "已经在正文里" })).toBe(prompt);
    const custom = "只画手的交接，不增加动作";
    const stored = JSON.stringify([{ kind: "production_plan" }, { kind: "artifact_prompt", artifactType: "action_board", prompt: custom }]);
    expect(actionBoardPromptFromBeats(stored)).toBe(custom);
    expect(shotArtifactPrompt("previz", { plotDescription: "画面", actionBoardPrompt: actionBoardPromptFromBeats(stored) })).toBe(custom);
});
