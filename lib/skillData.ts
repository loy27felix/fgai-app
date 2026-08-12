// Skill（工作流技能/角色，启用后作为系统提示注入）与 Prompt（提示词片段，插入到输入框）——两者分开
export const WORKFLOW_SKILLS = [
  { id: "screenwriting", title: "DeepWhite 编剧", desc: "短剧剧本方法 + 格式规范", file: "screenwriting.md" },
  { id: "emotion-director", title: "情绪导演 · Seedance", desc: "素材 → 影视级视频提示词(物理化/逐秒)", file: "emotion-director.md" },
  { id: "shotlist", title: "分镜表构建师", desc: "剧本 → 镜头表", file: "shotlist-builder.md" },
  { id: "imageprompt", title: "图像提示词构建", desc: "中英双语静帧", file: "image-prompt-builder.md" },
  { id: "minimal-zine-poster", title: "Minimal Zine 海报", desc: "诗性纸感 · 留白微编辑海报", file: "gc-minimal-zine-poster-v0-3.md" },
  { id: "seedance", title: "Seedance 视频导演", desc: "场景 → 视频 Prompt", file: "seedance-director.md" },
  { id: "seedance-combat", title: "Seedance 二次元打戏", desc: "15 秒打戏 · 攻防/运镜/节奏", file: "seedance-combat-prompt.md" },
  { id: "cinematic-realism", title: "造梦师 · 电影真实感", desc: "真实电影感 · 机位/光线/胶片", file: "zy-cinematic-realism.md" },
  { id: "screenwriter", title: "编剧·三大方法论", desc: "麦基/坎贝尔/亚里士多德", file: "screenwriter.md" },
];

export const PROMPT_GROUPS: { name: string; items: { title: string; prompt: string }[] }[] = [
  { name: "画风", items: [
    { title: "暗黑童话水墨", prompt: "暗黑童话风格，水墨晕染叠加厚涂质感，冷调高对比，胶片颗粒，电影级布光，神秘压抑氛围" },
    { title: "国潮赛博", prompt: "国潮水墨线条融合赛博朋克，霓虹冷光，未来都市背景，高饱和强对比，东方美学" },
    { title: "日系厚涂", prompt: "日系厚涂动画，柔和光影，细腻笔触，清透通透色彩，2.5D 质感，唯美氛围" },
  ]},
  { name: "运镜", items: [
    { title: "缓推聚焦", prompt: "镜头缓慢推进（slow dolly in），逐渐聚焦主体面部，营造紧张与压迫感" },
    { title: "环绕镜头", prompt: "镜头环绕主体 180 度弧形运动（arc shot），立体呈现角色与空间关系" },
    { title: "子弹时间", prompt: "子弹时间（bullet time），时间凝滞，镜头多角度环绕主体缓慢移动" },
  ]},
  { name: "构图", items: [
    { title: "低角度压迫", prompt: "低角度仰拍，主体显得高大具压迫感，广角轻微畸变，强势氛围" },
    { title: "过肩对话", prompt: "过肩镜头（over-the-shoulder），前景虚化肩背，焦点落在对话主体上" },
  ]},
  { name: "负向词", items: [
    { title: "漫剧负面词", prompt: "禁止字幕/水印/品牌 logo；避免多手指、融合肢体、人脸畸变、低龄卡通；保持画风统一与人物一致" },
  ]},
];
