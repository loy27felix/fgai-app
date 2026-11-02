import { modelCapabilityConfigFor, videoDurationAllowed } from "@/lib/model-capabilities";
import { dramaDialoguePreserved } from "@/lib/short-drama-dialogue";
import type { AiConfig } from "@/stores/use-config-store";
import type { StoryboardRow } from "@/types/canvas";

export const DRAMA_SKILL_ATTRIBUTION = "该SKILL 由Work-Fisher制作，免费公开，禁止任何盗卖行为";
export type DramaProductionPlan = { model: string; seconds: number; strategy: "story" | "fixed"; allowedSeconds: number[]; promptFormat?: "director-v2"; promptMaxChars?: number };

export function parseDramaProductionPlan(value: unknown): DramaProductionPlan | undefined {
    if (!value || typeof value !== "object") return undefined;
    const plan = value as DramaProductionPlan;
    if (typeof plan.model !== "string" || !plan.model.trim() || ![13, 15, 20, 25, 30].includes(plan.seconds) || !["story", "fixed"].includes(plan.strategy) || !Array.isArray(plan.allowedSeconds) || !plan.allowedSeconds.length) return undefined;
    if (plan.allowedSeconds.some((seconds) => ![13, 15, 20, 25, 30].includes(seconds) || seconds > plan.seconds)) return undefined;
    if (plan.promptFormat !== undefined && plan.promptFormat !== "director-v2") return undefined;
    if (plan.promptMaxChars !== undefined && (!Number.isSafeInteger(plan.promptMaxChars) || plan.promptMaxChars < 1)) return undefined;
    if (plan.strategy === "fixed" && (plan.allowedSeconds.length !== 1 || plan.allowedSeconds[0] !== plan.seconds)) return undefined;
    return plan;
}

export function dramaSegmentDurations(config: AiConfig, model: string) {
    if (!model) return [];
    const profile = modelCapabilityConfigFor(config, model).video;
    return profile ? [13, 15, 20, 25, 30].filter((seconds) => videoDurationAllowed(profile, seconds)) : [];
}

export function createDramaProductionPlan(config: AiConfig, model: string, seconds: number, strategy: DramaProductionPlan["strategy"]): DramaProductionPlan {
    const supported = dramaSegmentDurations(config, model);
    if (!supported.includes(seconds)) throw new Error("请选择目标视频模型支持的片段时长；短剧片段至少 13 秒");
    const promptMaxChars = modelCapabilityConfigFor(config, model).video?.references.promptMaxChars;
    return { model, seconds, strategy, allowedSeconds: strategy === "fixed" ? [seconds] : supported.filter((value) => value <= seconds), promptFormat: "director-v2", ...(promptMaxChars ? { promptMaxChars } : {}) };
}

export function dramaStoryboardContract(plan: DramaProductionPlan, modelName: string) {
    return [
        `【短剧视频片段规划】目标视频模型：${modelName}；${plan.strategy === "fixed" ? "每段固定" : "按剧情划分，每段不超过"} ${plan.seconds} 秒。`,
        `每行是一次完整视频生成的剧情片段，durationSeconds 只可选 ${plan.allowedSeconds.join(" / ")} 秒。不要把 3、4 秒的内部镜头拆成独立行；一行内允许多个有叙事动机的内部镜头。`,
        "先通读全章，按一个主要场景、一段关系变化、明确落点划分；切在决定、揭示、拒绝或新行动处。相邻片段保持因果、人物左右位置、道具交接、轴线和光线连续，不能通过删台词缩短时长。",
        "节奏按可见事件推进：开场第一秒启动本段有效动作、对白或有因果的环境变化；对白、倾听、走位和道具操作可自然重叠。每个时间段必须新增信息、改变行动目标或推进关系，不用重复环顾、无目的慢推、长时间空等填满秒数。保留原作必要悬念与停顿，不能把所有动作强行加速或机械均分时间。",
        "默认动作速率干脆、反应紧凑：起步、出手、闪避、转向以真实重心变化连续完成，打斗不先对视摆姿再交手；受击可用极短的冲击重拍，立即继续位移与反击，不用整段慢动作。运镜由人物目标或新信息触发，提前留出运动空间，写清启动、追随、惯性减速与落点，禁止每段无动机环绕或恒定慢推。",
        "受击与小型魔法特效只服务已确认剧情和能力：逐项写触发者/动作→接触点或发射来源→传播方向与速度→命中反馈→环境余波→消散。按目标风格选择短促火花、飞屑、尘浪、布料/头发扰动、局部光反射等，不用泛泛的‘炫酷特效’；能量贴合主体并有遮挡和光照反馈，不无故遮脸、变身、凭空新增武器或能力。普通生活片不强加魔法。",
        "连续性逐项核对：上一段末态→本段起态→各时间段末态，记录每人相对门窗/家具的位置、朝向、脚下介质、持物手、道具归属/开闭状态、光源方向和正在进行的声音。写清接触→受力→位移→结果；抬警戒带、过门、传物等必须有实际空隙与先后条件。切镜可以省略无意义等待，但不能造成无依据的换手、换位、穿墙、消失或复位。",
        "完整保留原文对白和明确的 OS，不为抽象心理描述虚构 OS。对白过长时在完整句与剧情落点处另开片段；不加速、不删词、不重复。dialogue 必须包含本片段完整台词，一行一位说话人，使用‘角色名：完整原文台词’格式，videoMotionPrompt 同样逐字包含这些台词。",
        "说话人标签也须逐字一致：dialogue 和【声音设计】对白清单沿用原文同一个角色名，不自行翻译、缩写或切换中英文名；例如原文 Cal: Hello.，两处均写 Cal：Hello.，不能一处 Cal 一处卡尔，也不能把 Cal: 再嵌入台词正文。声线设定另列在对白清单之外，时间和表演说明不得并入角色姓名。",
        "角色已确认的性别、外貌、声音性别和绑定样音是跨镜头固定事实；原文或角色设定未明确时，不得在某批次自行锁定为男性或女性，不因老板、医生等职业推断性别。沿用已绑定人物外观和音色，未知项保留未明确，不用本批临时设定覆盖。",
        "script-to-drama-prompt-dev 用于 videoMotionPrompt；按用户时长缩放原 Skill 的 30 秒单元，30 秒通常 6–10 个有效内部镜头，短片段减少镜头，切换须有叙事动机，通常只用 1–2 次有动机的运镜。",
        "short-drama-asset-prompts 只用于角色、场景、道具设定与引用校验；保留原身份、族裔、物种和画风，不将默认亚洲人物、棚拍背景或空景无人要求强加到视频与分镜首帧。引用图分别说明身份与场景用途。",
        "参考绑定优先本片实际出场角色与主场景；只在道具决定剧情、需要身份锁定或明确接触操作时加入道具。分镜图、动作预演、历史生成素材不得因名称相似自动作为人物或场景参考。为每个有效绑定写真实资产ID与用途，系统随后转换成可核对的@资产与对应图片编号。",
        "每个角色先确定一份声线（年龄性别、音区音色、语速音量、句尾习惯），跨片段原样复用；只在出现人声的片段附对应角色声线。每段 2–3 个连续情绪状态，每个近景用 1–2 个可见信号，不写肌肉术语。",
        "videoMotionPrompt 必须是一份可直接提交的完整提示词，格式如下（括号说明须替换成实际内容）：",
        plan.promptMaxChars
            ? `目标视频模型提示词上限 ${plan.promptMaxChars} 字符。完整格式保留全部区块，但每块只写本片必要内容，避免重复和套话，为自动引用附加内容预留约15%空间；不得靠删对白压缩，过长时划分为更多合法片段。`
            : "按实际动作复杂度写提示词，避免重复和占位套话。",
        "采用 FG director-v2 合同，按 references/director-prompt-format.md 的全部区块写实际内容，开头为项目名与‘实际秒数秒｜一镜到底／多镜头｜类型与表演风格’。动作时间轴必须以0开始、连续覆盖到durationSeconds，逐段写‘人物动作：／镜头运动：／背景：’，包含每段结束状态。没有适用人物、素材或声音时说明没有，不编造。",
        "返回前逐个检查动作时间段：人物动作、镜头运动、背景必须各有独立标签及实际内容；即使动作已写成自然段也不能省略‘人物动作：’标签。不适用时明确写‘无’，不要留空或把下一项内容当作上一项。",
        "跨视频衔接要记录上一段末态和本段起态的站位、姿态、手与道具、轴线、光声。可用同空间风景、道具或其他角色反应切入，再回到已经推进后的真实状态，不能借空镜瞬移或复位。imageGenerationPrompt必须是这个真实开场。",
        "如加载武戏技能，只采用已确认打戏方向和该技能的攻防、因果、互动反馈方法；导演-v2输出格式、本次时长、原对白和身份优先于技能原有简写及30秒8段规则。未经确认不得自行增加打法、伤害程度或武器。",
        "切到倾听者、道具或空镜时，使用‘角色名画外音继续’保持同一句台词连续，不让两人同时说话。人物站位不计为镜头，镜头1必须开始实际动作。",
        "imageGenerationPrompt 是本片段真正第一帧，continuityOut 具体记录结尾人物位置、视线、道具状态与下一段入口；timeBeats 写覆盖本片段完整时长的节拍。不要用一句运镜描述替代完整视频提示词。",
        `Skill 署名只放在顶层 skillAttribution 字段：${DRAMA_SKILL_ATTRIBUTION}；不要放入 videoMotionPrompt 或人物台词。`,
    ].join("\n\n");
}

export function validateDramaStoryboard(rows: StoryboardRow[], plan?: DramaProductionPlan) {
    if (!plan) return;
    for (const [index, row] of rows.entries()) {
        if (!plan.allowedSeconds.includes(row.durationSeconds)) throw new Error(`第 ${index + 1} 段时长不符合所选模型与片段规划，未替换原分镜`);
        const prompt = row.videoMotionPrompt.trim();
        if (plan.promptFormat === "director-v2") {
            validateDirectorVideoPrompt(prompt, row.durationSeconds, index);
            if (plan.promptMaxChars && [...prompt].length > plan.promptMaxChars) throw new Error(`第 ${index + 1} 段提示词超过目标视频模型长度上限，未替换原分镜`);
        } else if (!prompt.startsWith("【分镜】") || !prompt.includes("人物站位：") || !prompt.includes("镜头1") || !prompt.includes("【禁止项】") || !prompt.includes("【强制声明】") || !prompt.includes("无背景音乐,仅保留环境音与人声和音效")) {
            throw new Error(`第 ${index + 1} 段缺少完整视频提示词，未替换原分镜`);
        }
        if (!dramaDialoguePreserved(row.dialogue, prompt)) throw new Error(`第 ${index + 1} 段视频提示词遗漏或改写了本段对白，未替换原分镜`);
    }
}

export const DIRECTOR_PROMPT_SECTIONS = ["视频整体概念", "参考图绑定", "摄影参数与镜头控制", "画面整体视觉方向", "真实皮肤／主体材质", "画面色彩与逻辑", "光影", "背景人物活动", "主角的眨眼与错时表演", "声音设计", "负面约束"];

const directorIntervals = () => /^\s*(\d+(?:\.\d+)?)\s*[—–\-~～至]\s*(\d+(?:\.\d+)?)\s*秒\s*[｜|]/gm;
const directorLabels = () => /^(人物动作|镜头运动|背景)[：:][ \t]*/gm;

// Only repair presentation, never invent missing direction. Some completed tasks
// contain the action paragraph before camera/background but omit its label.
export function normalizeDirectorVideoPrompt(prompt: string, seconds: number) {
    const heading = `【${seconds}秒分镜／动作时间轴】`;
    const start = prompt.indexOf(heading);
    const end = prompt.indexOf("【声音设计】", start + heading.length);
    if (start < 0 || end < 0) return prompt;
    const timelineStart = start + heading.length;
    const timeline = prompt.slice(timelineStart, end).replace(
        /^[ \t]*(?:[-*][ \t]+)?(?:\*\*|__)?(人物动作|镜头运动|背景)(?:\*\*|__)?[ \t]*[：:](?:\*\*|__)?[ \t]*/gm,
        "$1：",
    );
    const intervals = [...timeline.matchAll(directorIntervals())];
    let normalized = timeline;
    for (let i = intervals.length - 1; i >= 0; i--) {
        const from = intervals[i].index!;
        const to = intervals[i + 1]?.index ?? timeline.length;
        const block = timeline.slice(from, to);
        const labels = [...block.matchAll(directorLabels())];
        if (labels.length !== 2 || labels[0][1] !== "镜头运动" || labels[1][1] !== "背景") continue;
        // Skip the time range and its narrative title. Only existing prose on
        // following lines can be an omitted action paragraph.
        const bodyStart = block.indexOf("\n", intervals[i][0].length);
        if (bodyStart < 0) continue;
        const action = block.slice(bodyStart + 1, labels[0].index).trim();
        if (!action || /^[\s*_#\-]+$/.test(action) || /^(?:【|人物动作[：:])/.test(action)) continue;
        const actionStart = bodyStart + 1 + block.slice(bodyStart + 1).search(/\S/);
        normalized = normalized.slice(0, from + actionStart) + "人物动作：" + normalized.slice(from + actionStart);
    }
    return prompt.slice(0, timelineStart) + normalized + prompt.slice(end);
}

export function validateDirectorVideoPrompt(prompt: string, seconds: number, index = 0) {
    const fail = (reason: string): never => {
        throw new Error(`第 ${index + 1} 段${reason}，未替换原分镜`);
    };
    if (DIRECTOR_PROMPT_SECTIONS.some((section) => !prompt.includes(`【${section}】`))) fail("缺少完整导演提示词区块");
    const heading = `【${seconds}秒分镜／动作时间轴】`;
    const timeline = prompt.split(heading)[1]?.split("【声音设计】")[0];
    if (!timeline) fail("缺少对应时长的动作时间轴");
    const intervals = [...timeline!.matchAll(directorIntervals())];
    if (!intervals.length) fail("动作时间轴没有有效时间段");
    let previous = 0;
    for (let i = 0; i < intervals.length; i++) {
        const interval = intervals[i];
        const start = Number(interval[1]),
            end = Number(interval[2]);
        if (Math.abs(start - previous) > 0.01 || end <= start || end > seconds) fail(`动作时间轴存在空缺、重叠或超出总时长（第 ${i + 1} 个时间段：${start}—${end}秒；应从 ${previous} 秒承接，总长 ${seconds} 秒）`);
        const block = timeline!.slice(interval.index, intervals[i + 1]?.index);
        const labels = [...block.matchAll(directorLabels())];
        const missing = ["人物动作", "镜头运动", "背景"].filter((label) => !labels.some((match, j) =>
            match[1] === label && /\S/.test(block.slice(match.index! + match[0].length, labels[j + 1]?.index)),
        ));
        if (missing.length) fail(`的第 ${i + 1} 个动作时间段（${start}—${end}秒）缺少${missing.join("、")}内容`);
        previous = end;
    }
    if (Math.abs(previous - seconds) > 0.01) fail("动作时间轴未覆盖结尾");
}

export function dramaPlanFromBeats(value: string): DramaProductionPlan | undefined {
    try {
        const beats: unknown = JSON.parse(value || "[]");
        if (!Array.isArray(beats)) return undefined;
        const plan = beats.find((item) => item?.type === "drama_video_segment")?.productionPlan;
        return parseDramaProductionPlan(plan);
    } catch {
        return undefined;
    }
}
