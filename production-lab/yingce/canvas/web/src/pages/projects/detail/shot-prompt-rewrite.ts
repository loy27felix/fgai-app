import { runShortDramaText } from "@/services/short-drama-text";
import { runBackendCanvasGenerationTask } from "@/lib/canvas/canvas-project-generation";
import { shortDramaSkillContext, shortDramaSkillProvenance } from "@/lib/prompts/short-drama-skill-context";
import { validateDirectorVideoPrompt } from "@/lib/short-drama-production";
import { skillRuntime } from "@/services/skill-runtime";
import type { Skill } from "@/services/api/skills";
import type { AiConfig } from "@/stores/use-config-store";
import type { GenerationTask } from "@/services/api/task-center";
import { getProjectLanguage, applyProjectLanguage, lockDialogueToOriginal, assertLockedEnglishPrompt } from "@/services/api/project-language";
import { getProjectUnitWorkspace } from "@/services/api/projects";

export async function rewriteShotVideoPrompt(input: { projectId: string; unitId?: string; shotId: string; config: AiConfig; notes: string; seconds: number; facts: Record<string, unknown>; skills: Skill[]; skillIds: string[]; actionDirection?: string; onFallback: (message: string) => void; onTask: (task: GenerationTask) => void }) {
    const { policy } = await getProjectLanguage(input.projectId);
    if (policy.spoken === "en-original" && !input.unitId) throw new Error("当前镜头未关联原剧本章节，请先核对来源");
    const current = input.facts.current as Record<string, unknown>;
    const lockedDialogue = policy.spoken === "en-original" ? lockDialogueToOriginal(String(current.dialogue || ""), (await getProjectUnitWorkspace(input.projectId, input.unitId!)).unit.sourceText) : undefined;
    const facts = lockedDialogue === undefined ? input.facts : { ...input.facts, current: { ...current, dialogue: lockedDialogue } };
    const prepared = await skillRuntime.prepare({ profile: "shortDrama", skills: input.skills, selectedSkillIds: input.skillIds, prompt: [
        shortDramaSkillContext(Boolean(input.actionDirection?.trim())),
        "只重写当前片段的视频提示词，直接返回完整 director-v2 文本，不要 JSON、解释或 Markdown 代码围栏。所有区块写实际内容，时间轴从0连续覆盖到指定总秒数，每段有‘人物动作：／镜头运动：／背景：’。保留原剧情、完整对白、角色身份及真实@资产标记，不编造素材ID。",
        "默认节奏紧凑：第一秒启动有效事件；动作起步、出手与反应干脆；对白、倾听和走位重叠推进。运镜由动作或新信息触发，写启动、惯性、减速和落点；只在命中瞬间短促重拍，随后继续行动。",
        "逐项对齐前段结尾、本段开头与下一段入口：人物站位/朝向/脚下介质、持物手、道具状态、光源、声音。空镜可以承接画外行动，不能让人物瞬移、复位、换手或丢失道具。原有小魔法与受击特效写触发→接触点/来源→方向速度→命中反馈→环境余波→消散，不新增未经确认的能力。",
        `【事实数据】${JSON.stringify({ seconds: input.seconds, ...facts })}`,
        ...(lockedDialogue === undefined ? [] : [`【锁定的英文原台词】\n${lockedDialogue || "无对白"}\n只能逐字使用以上台词。修改意见只调整表演、运镜、时长与空间，不改变台词措辞或说话人。`]),
        input.actionDirection?.trim() ? `【确认的打戏方向】${input.actionDirection.trim()}` : "未确认武戏方向，不新增打斗机制或伤害细节。",
        `【本次修改意见】${input.notes.trim()}`,
    ].join("\n\n") });
    const provenance = await shortDramaSkillProvenance(Boolean(input.actionDirection?.trim()));
    const result = await runShortDramaText(input.config, config => runBackendCanvasGenerationTask({ projectId: input.projectId, nodeId: `rewrite:${input.shotId}`, mode: "text", prompt: applyProjectLanguage(prepared.prompt, policy), config, metadata: { source: "short-drama-prompt-rewrite", domainProjectId: input.projectId, shotId: input.shotId, projectLanguagePolicy: policy, ...prepared.metadata, builtinDramaSkills: provenance }, onTaskCreated: input.onTask }), input.onFallback);
    const text = result.text?.trim() || "";
    validateDirectorVideoPrompt(text, input.seconds);
    if (lockedDialogue !== undefined) assertLockedEnglishPrompt(lockedDialogue, text);
    return { text, provenance, lockedDialogue };
}
