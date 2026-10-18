// User-owned delivery contract. Creative Skills supply direction; this contract owns the final form.
export const VIDEO_MODULES = Object.freeze([
  "视频整体概念",
  "参考图绑定",
  "摄影参数与镜头控制",
  "画面整体视觉方向",
  "真实皮肤／主体材质",
  "画面色彩与逻辑",
  "光影",
  "背景人物活动",
  "主角的眨眼与错时表演",
  "分镜／动作时间轴",
  "声音设计",
  "负面约束",
]);

export const VIDEO_PROMPT_CONTRACT = `最终视频 Prompt 必须为中文详细拍摄稿，严格使用以下十二模块，顺序不得变。括号是字段说明，交付时替换为本项目具体内容，禁止复制占位符。每个视频生成单位独立写全十二模块，不用“同上”省略；不额外添加 Skill 的其他顶层投喂格式。Skill 的导演方法、门禁、台词和连续性约束仍然执行。用户指定格式与时长优先。

[项目名称]
[总时长]秒｜[一镜到底／多镜头]｜[类型与表演风格]

【视频整体概念】
类型：题材、媒介、拍摄质感。
表演风格：人物怎样表现。
时长：用户确认的本段秒数，禁止自行缩短或拉长。
画幅与帧率：横竖比例、目标画质、帧率、运动节奏，必须与真实生成参数一致。
剪辑方法：从哪里开始、跟随谁、经过哪些空间、停在哪个画面；一镜到底交代完整摄影机路线与真实通道，多镜头交代切点及前后承接。
时间与天气：时间、季节、天气及其可见表现。
地点：环境、空间边界、出入口、关键道具、通行路线。
整体叙事：起始状态→触发事件→人物行动→变化或发现→结束状态；写清信息揭示与情绪转折。

【参考图绑定】
只引用本次实际绑定素材的 @资产编号／名称，顺序与实际上传顺序一致。逐张说明负责身份、发型、体型、服装、配饰、空间、道具或色调中的哪些部分，哪些只作气质参考；多人分别锁定，不复制三视图排版。运动、遮挡、失焦后身份和持物仍保持。未生成或未绑定的图不得宣称已核验；无图时明确纯文字生成，不虚构图号。优先角色与场景，仅绑定叙事必需道具。

【摄影参数与镜头控制】
镜头：焦距／视角特征，固定或允许变焦。
景深：人物与背景各自清晰程度。
机位：初始位置、高度、与主体距离。
运动路径：前后、侧移、环绕、升降的具体路线；为何移动、何时启动、速度和最终落点。
转向节奏：启动→加速→减速→稳定，保留合理惯性。
稳定性：固定／稳定器／手持；手持按步伐、呼吸、构图修正写幅度。
焦点控制：从谁／什么转向哪个对象、触发时机；短暂失焦须有靠近、转向或遮挡原因并及时恢复。
曝光与白平衡：按需写快门、光圈、ISO、白平衡与曝光，不为凑模板编造参数。

【画面整体视觉方向】
用完整段落统一媒介、真实程度、精致或粗粝程度、观察距离、景深、颗粒和运动质感；说明清晰与柔化的部位和应避免的倾向。

【真实皮肤／主体材质】
写实人物保留毛孔、自然纹路、肤色差异和身份细节；服装道具保留纹理、褶皱、磨损、反光、重量。动画改为相应媒介材质；按风格避免磨皮、美颜、蜡质、过度光滑。

【画面色彩与逻辑】
主色：主要面积。
辅色：环境、服装和道具。
强调色：线索、身份、视觉引导。
饱和度与明暗：肤色、黑白的处理。
连续性：同一光照下转向、遮挡、移动不引发无依据色温、白平衡跳变。

【光影】
主光源：来源、方向、软硬、范围。
环境反射：墙面地面等反射。
面部与身体：受光部位与自然阴影。
空间层次：前中后景明暗。
移动和转头时光照随位置朝向合理变化，光源不随意漂移。

【背景人物活动】
按职责写动作、位置、节奏，错开开始、停顿、结束，允许部分人静止。谁关注主角、谁继续工作、谁服务叙事；不复制主角身份。人数位置变化须有进入、离开或遮挡原因。没有背景人物明确写无，不凭空添加。

【主角的眨眼与错时表演】
眨眼：按情境自然发生，不固定间隔、不同步。
视线：先注意目标，再转头，肩膀上身随后跟随。
转向：脚步重心先调整，身体顺势转动。
停步：缩短步幅，惯性略前移再稳定。
表情：眼神、眉间、嘴唇、下颌、呼吸先后响应。
双人反应：谁先察觉、谁后跟随、反应时差。
道具互动：观察→接触→操作／传递→松手→结果，明确左右手和接替成立的条件。

【[总时长]秒分镜／动作时间轴】
[起始]—[结束]秒｜本段叙事任务
人物动作：位置、朝向、视线、动作先后、互动、结束时位置和状态；接触写左右手、接触点、交接条件和可见结果。
镜头运动：同一时刻摄影机位置、高度、距离、路线、速度、构图变化与焦点交接，通行必须有真实空间。
背景：同一时刻可见环境、背景人物、关键道具和环境动作状态。
重复以上三项直到总时长。时间从0连续覆盖到指定结尾，无空档、重叠或均分凑数；每个区间三项描述同一时刻。下一段从前段结束位置继续，切镜重新建立空间关系，末段明确人、机位和信息落点。不能只写“打斗激烈／运镜流畅／气氛紧张”。

【声音设计】
音乐：默认不生成配乐，后期添加；用户明确要求时才修改。
环境底声：持续空间底噪。
人群声音：来源、语言、清晰度、距离。
人物近声：脚步、衣料、呼吸、动作。
现场细节声：接触、操作、移动、碰撞。
电子声：确需才写来源、次数、音量。
空间关系：摄影机距离与方向变化时声音强弱方向清晰度合理变化。
对白：角色、台词原文、时机；无对白明确写无，不能擅改或遗漏用户锁定台词。

【负面约束】
身份：不换脸、融合、无故变发型服装。
动作：不穿模、不异常手指、不错接触、不颠倒顺序。
空间：不瞬移、换位、反向、丢道具。
摄影：按本片拍法列禁用切镜、变焦、运动、失焦。
画面：避免冲突材质、色彩、光线。
声音：禁用不需要的音乐音效、声源方向错误、声画不同步。
其他：默认不生成字幕、文字、水印、Logo；用户批准的画内文字单独注明。

节奏与动作质量：默认紧凑、有因果的快速动作，开头立即进入冲突，减少空等与无目的慢动作；速度必须写成具体启动、位移、接触、反应和收势。受击写施力方向、接触点、重心变化、环境反馈；魔法写触发动作、来源、传播路径、命中对象和消散，不堆砌遮挡主体的特效。短暂受击顿挫不能变成长时间慢放。动作密度超过时长时提出拆段／删减建议，绝不私改已确认秒数。
每段结尾另存连续性记录（身份、空间、持物、朝向、光线、情绪）供下一段读取，该记录不混进最终投喂正文。`;

/** Checks structure and time coverage, not rendered acting or physical correctness. */
export function validateVideoPrompt(
  prompt,
  { seconds, referenceCodes = [], ratio, resolution } = {},
) {
  const errors = [],
    text = String(prompt || "").replace(/\r\n/g, "\n");
  const headings = [...text.matchAll(/【([^】]+)】/g)];
  const positions = VIDEO_MODULES.map((name, i) =>
    headings.findIndex((h) =>
      i === 9
        ? /^(?:\d+(?:\.\d+)?秒)?分镜／动作时间轴$/.test(h[1])
        : h[1] === name,
    ),
  );
  positions.forEach((p, i) => {
    if (p < 0) errors.push(`缺少【${VIDEO_MODULES[i]}】`);
    else if (i && p <= positions[i - 1])
      errors.push(`【${VIDEO_MODULES[i]}】顺序不对`);
  });
  if (positions[9] >= 0) {
    const h = headings[positions[9]],
      next = headings[positions[9] + 1];
    const timeline = text.slice(
      h.index + h[0].length,
      next?.index ?? text.length,
    );
    const ranges = [
      ...timeline.matchAll(
        /(?:^|\n)\s*(\d+(?:\.\d+)?)\s*[—–~～-]\s*(\d+(?:\.\d+)?)\s*秒\s*[｜|]/g,
      ),
    ];
    if (!ranges.length) errors.push("时间轴没有可识别的时间段");
    let end = 0;
    ranges.forEach((m, i) => {
      const start = Number(m[1]),
        stop = Number(m[2]),
        body = timeline.slice(
          m.index + m[0].length,
          ranges[i + 1]?.index ?? timeline.length,
        );
      if (Math.abs(start - end) > 0.001 || stop <= start)
        errors.push(`${m[1]}—${m[2]}秒时间段有间隙、重叠或顺序错误`);
      for (const label of ["人物动作", "镜头运动", "背景"])
        if (!new RegExp(`${label}：\\s*[^\\s]`).test(body))
          errors.push(`${m[1]}—${m[2]}秒缺少${label}`);
      end = stop;
    });
    if (Number.isFinite(seconds) && Math.abs(end - seconds) > 0.001)
      errors.push(`时间轴结束于${end}秒，应为${seconds}秒`);
    const named = /^(\d+(?:\.\d+)?)秒/.exec(h[1]);
    if (named && Number.isFinite(seconds) && Number(named[1]) !== seconds)
      errors.push("时间轴标题时长与生成参数不一致");
  }
  if (Number.isFinite(seconds)) {
    const first = /^.*\n\s*(\d+(?:\.\d+)?)秒\s*[｜|]/.exec(text.trim());
    if (!first || Number(first[1]) !== seconds)
      errors.push("开头总时长与生成参数不一致");
    const declared = /时长：\s*(\d+(?:\.\d+)?)\s*秒/.exec(text);
    if (!declared || Number(declared[1]) !== seconds)
      errors.push("整体概念时长与生成参数不一致");
  }
  const known = new Set(referenceCodes);
  for (const m of text.matchAll(/@\[asset:([^\]]+)\]/g))
    if (!known.has(m[1])) errors.push(`引用素材未绑定：${m[1]}`);
  if (/\[(?:项目名称|总时长|起始时间|结束时间)\]/.test(text))
    errors.push("提示词含未替换占位符");
  const specification = /画幅与帧率：([^\n]+)/.exec(text)?.[1] || "";
  const writtenRatio = /(\d+\s*[:：]\s*\d+)/
    .exec(specification)?.[1]
    .replace(/[\s：]/g, (m) => (m === "：" ? ":" : ""));
  if (ratio && writtenRatio !== ratio)
    errors.push(`Prompt 画幅与所选${ratio}不一致，请先修改拍摄稿`);
  const writtenResolution = /(\d{3,4}\s*[pP]|[1248]\s*[kK])/
    .exec(specification)?.[1]
    .replace(/\s/g, "")
    .toLowerCase();
  if (
    resolution &&
    writtenResolution &&
    writtenResolution !== String(resolution).toLowerCase()
  )
    errors.push(
      `Prompt 画质写的是${writtenResolution}，与所选${resolution}不一致，请先修改拍摄稿`,
    );
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

export function bindVideoReferences(prompt, references) {
  const indices = new Map(references.map((r, i) => [r.code, i + 1]));
  const text = String(prompt).replace(/@\[asset:([^\]]+)\]/g, (_, id) => {
    if (!indices.has(id)) throw Error("提示词包含未绑定素材，请让导演重新匹配");
    return `@图片${indices.get(id)}`;
  });
  const mapping = references.length
    ? "实际上传顺序：" +
      references.map((r, i) => `@图片${i + 1}＝${r.name}`).join("；") +
      "。"
    : "本次无参考图，按文字设定生成；不声明已锁定参考身份。";
  return text.replace("【参考图绑定】", "【参考图绑定】\n" + mapping);
}
