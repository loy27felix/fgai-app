# Video Prompt Format

This format distills the reference video's useful structure: a global production anchor followed by a time-coded sequence. Each beat connects **character action + camera movement + background state**; visual direction, references, sound, and constraints keep the beats coherent. The reference's 25-second crime-drama one-take is only an example, not a default duration, genre, camera setup, or prompt limit.

The clip presents subject + scene + camera as the minimal prompt anchor, then expands it with director-facing decisions: action timeline, character design and blocking, scene geography, camera language, light, color, texture, emotional progression, sound, and relevant exclusions.

## 1. Production brief

Fill known fields; leave unknowns open or make them explicit assumptions.

```text
目标模型/模式：
用途与成片内容：
画幅 / 比例：
总时长 / 片段时长：
参考素材及其对应角色、场景或风格：
交付语言与格式：
对白、环境声、音效、音乐：生成 / 后期 / 不需要
```

## 2. Global anchors

These apply across the whole clip or sequence. Avoid repeating every detail in every beat; repeat only the identity and geography locks needed for continuity.

```text
【创意与因果】
一句话说明画面要表达什么。
按“起因 → 行动 → 反应/变化 → 结束状态”列出不可颠倒的事件。

【主体与参考】
角色/主体的身份、外观、服装、关键道具；每份参考素材绑定到具体对象。

【场景与空间】
地点、入口/出口、前后景、角色初始位置、移动方向、关键物体位置。

【视觉方向】
写实/动画等媒介，质感，色彩范围，时间与天气，环境气氛。

【情绪与表演】
情绪从哪里开始，如何推进、转折和收束；用动作、视线、节奏、构图或声音表达。

【光线】
主光方向和软硬、环境光、明暗变化；只写会影响画面的选择。

【材质与皮肤】
需要写实人物时再指定皮肤和服装的真实纹理；其他风格按目标媒介设置。

【摄影】
景别、机位高度、主体与镜头的相对位置、运动路径、速度、焦点交接。
说明是否一镜到底或允许切镜。焦距、帧率、快门等数值仅在目标模型支持且确有需要时填写。

【声音】
对白原文、环境底噪、动作音效、音乐及其进入/退出点；注明生成或后期。

【限制】
只列与本场景有关、且彼此不冲突的约束，例如不加字幕、保留画外空间或禁止角色换位。
```

## 3. Time-coded beat sheet

Use consistent intervals that cover the requested duration. Each beat needs a visible action, a feasible camera instruction, and an end state that leads into the next beat.

```text
00:00–00:03｜[节拍名]
人物/主体：起始位置、动作、视线或互动；本段结束时的位置与状态。
镜头：机位与主体关系、景别、运动方向和速度、焦点落点。
场景：背景人物、道具或环境如何变化；哪些元素保持不变。
声音：对白/环境声/音效/音乐，或“无新增声音”。

00:03–00:06｜[节拍名]
人物/主体：承接上一段结束状态，动作的原因和结果。
镜头：承接上一段机位；说明跟随、转向、绕行或停留。
场景：空间关系和背景反应。
声音：本段声音及与前段的衔接。
```

### Compact prompt form

When the target model prefers prose, convert the beat sheet into one compact prompt:

```text
[画幅、时长、场景与总体视觉方向。锁定主体身份、服装、道具和初始空间关系。]
[摄影机从哪里观察主体，以什么速度、沿什么可行路径运动；说明镜头是连续还是切换。]
按时间顺序推进：[时间段一：可见动作、镜头、背景、结束状态]；[时间段二：承接前态的动作、镜头、背景、结束状态]；[继续至结尾，并明确最后画面。]
[光线与色彩。]
[情绪推进及对应的表演、镜头或节奏变化。]
[对白与声音设计，注明生成或后期。]
[少量、场景相关的负面约束。]
```

## 4. One-take camera path

For a continuous take, add the camera's starting point, route, turns, occlusions, height changes, and final position. Make the route physically possible and keep the subject's screen direction understandable. If the lens must pass a person, doorway, vehicle, or barrier, state how it clears that obstacle. Do not add a complicated orbit just to make the prompt sound cinematic.

## 5. Multi-clip continuity ledger

Use this when a sequence will be generated as separate clips. Keep one row per clip and reuse stable reference identifiers.

| Clip | Duration | Opening state/reference | Main change | Closing state | Handoff to next clip |
|---|---:|---|---|---|---|
| C01 |  |  |  |  |  |
| C02 |  |  |  |  |  |

Record character position and facing, wardrobe/props, scene geography, screen direction, lighting/color, and any ongoing sound that must match. Make separate copy-ready prompts for each clip; do not rely on the model to remember a previous generation.

## 6. Final prompt check

- The time ranges cover the full duration without accidental gaps or conflicting overlaps.
- Every beat starts from the preceding beat's visible end state.
- Character identity, screen direction, props, and geography remain stable.
- Camera movement can physically reach each described position.
- Lighting, palette, action, and sound support the same mood and story.
- The emotional progression is visible in behavior or audiovisual choices rather than left as an abstract label.
- Negative constraints are relevant and do not contradict requested action.
- Any model-specific syntax, reference-image support, duration, and prompt limits have been checked for the chosen tool.
