# 创作与制作文档模板（规则 3.2.6）

用于新项目，把用户看得到、可修改的创作决定留下来。按当前阶段创建有内容的文档，不预建空白档案。短片可将相邻表合并为一个文件，但下面的信息和可见交付不能省略。文件位置由项目决定，以下是相对路径建议。

所有模板及启动问题文档均以 [已明确的项目根目录](project-documentation.md#项目目录前置条件) 为存放边界。用户未指定且无已绑定目录时，先在聊天中询问目录，不在当前工作目录创建这些文件；目录明确后再写入对应项目，入口或状态记录实际目录与用户来源。

## 1. 访谈记录与创作简报

默认在聊天正文交付问题和三个候选，`canon/创作访谈.md`同步记录。正文呈现受限且允许文档交互时，按 [文档交付方式](interactive-development.md#会话规则冲突的处理) 将完整问题、三个候选和作答方法写入项目文档，并在正文给出链接供用户查看回答。记录当前触发原因，不改写成用户禁止正文选项。

| 问题编号/主题 | 已有输入或实际提问及A/B/C原文 | 用户字母回复/自由补充/资料出处 | 解析后的采用值与委托范围 | 状态/版本 |
|---|---|---|---|---|
| Q01… | 只记录实际展示的问题与三个候选；事实项不编选项 | 保留字母与原话，便于恢复选项含义 | 区分已选、组合、助手建议与待定 | confirmed / delegated / proposed / open / not_applicable |

区分文档准备`prepared_in_document`、正文完整展示`presented_in_chat`、授权文档模式下已发链接`document_link_delivered`、用户已回复及已采用。文档完整且链接已实际交付时，可作为该模式的问题入口；不能记为正文展示或用户已阅。文件存在、单一推荐或排队打开都不等于用户已回答，未答项保持open。`revisions/<revision>/创作简报.md` 汇总用途/体验、故事边界、主要人物、时长画幅、摄影色调、声音、资产、负载与交付范围，以及尚待决定的事项。主角姓名、镜头稳定性、长镜头偏好、色调不能在无来源时标为已定。

交互约定可存入`canon/沟通约定.md`或现有访谈文件，并以`creative_documents.interaction_contract`索引；记录用户实际要求，不要求为了文件名拆分。机器入口可另存`interview_question_states`，按题记录`status`、`options_ref`、`presentation_mode`、`presentation_status`、`three_options_presented_in_chat`、`answer_form`、`user_evidence`和`adopted_value`。文档模式保留真实文档路径，`three_options_presented_in_chat`为false；自由回答仍可确认创作事实。临时会话限制和用户对文档方式的授权分开保存，再次调用不把旧限制当作当前事实。

## 2. 人物与素材身份

`canon/人物设定.md`：

| 内部ID | 姓名/固定称谓 | 别名/称呼 | 关系与目标 | 外貌服装/说话特点 | 图片ID | 代理识别色 | 状态来源 |
|---|---|---|---|---|---|---|---|

主要角色必须有可读、稳定的姓名或用户选择的固定称谓。若用户委托设计名字，提出并记录；有意匿名的“乘客”“店员”可保留，但不能默认用A/B替代所有人物。CHR编号只在工程中使用。人物多状态图沿用同一ID与姓名，不增加新人物。

## 3. 摄影与色调设定

`canon/screen-language.md`：

| 维度 | 实际采用值 | 适用范围/例外 | 用户依据 |
|---|---|---|---|
| 视觉媒介与参考 | 写实、动画或其他；具体借鉴什么 | 不继承参考的无关人物与剧情 | 回答/委托 |
| 摄影视点与景别偏好 | 主观/观察距离，人物与环境如何分配画面 | 镜头例外 | 回答/委托 |
| 基础运镜与手持 | 固定/移动原则；无/轻/中/强及可观察描述 | 启用镜号/事件 | 回答/委托 |
| 镜头长度与切镜 | 长镜头、一镜到底、混合或密集剪辑 | 切点动机、不可剪断事件 | 回答/委托 |
| 色彩与影调 | 主/辅色、冷暖、饱和度、反差、肤色与暗部 | 场次渐变或剧情性变化 | 回答/委托 |
| 光线与质感 | 主光来源和方向、软硬、材质、颗粒/清晰度/景深 | 与结构图展示光线的区别 | 回答/委托 |
| 声音原则 | 对白、环境音、音效、音乐、旁白、字幕 | 哪些时刻静默或重音 | 回答/委托 |
| Blender与成片分工 | 相机大运动、代理中性色；成片外观和小表演由图片/文字规定 | 哪些手持微动只在成片要求 | 采用方案 |

这是可执行的视觉设定，不需要固定器材品牌，也不等于预演必须实现最终灯光。统一基调与有动机的场次变化可以共存。

## 4. 剧本与节拍

`story/<场次>_剧本.md` 写地点/时段、具名人物、可见行为、必要台词及声音。`revisions/<revision>/节拍与动作.md` 可与剧本合并：

| 节拍/时段 | 人物目标与触发 | 行动→反应→结果 | 观众新增信息与情绪变化 | 声音/停顿 | Blender表达 | 最终视频补足 |
|---|---|---|---|---|---|---|

不同题材选择合适叙事结构，不固定12节拍、反转位置或动态结尾。对白按预期语气估读并注明估计，已有朗读或音轨则记录实际依据；安排必要动作、换气与反应，允许它们与对白、运镜自然交叠，不机械相加，也不以字幕能放下推断台词能说完。

## 5. 必须展示的分镜表

`revisions/<revision>/分镜表.md`。下表逐行写实值，不能以“按剧本”“planned_per_director_plan”代替。信息过宽可拆成两张同镜号关联表；用户不需要查看内部JSON才能理解。

本表与同范围剧本在同一次方案回复中主动展示，不等用户单独索要；允许一次确认两者。长剧按本轮选定章节交付配套剧本和分镜，不顺带制作后续全部章节。

| 镜号/时间/时长 | 景别与机位 | 起止构图/人物位置 | 剧情动作与反应 | 运镜/手持强度 | 信息与情绪任务 | 对白/声音/切点 | 光线色调及例外 |
|---|---|---|---|---|---|---|---|

配套简述整段节奏：哪里铺垫、哪里揭示、何处停留、为何切走，摄影方案如何支撑用户想要的体验。不要仅列焦距或坐标。

多人或多主体镜头在有关行写清发起者、对象、接收者及镜头观察主体。涉及运镜转场时，区分移动耗时、关键内容可读区间和随后表达/反应的时间；画外声音或声音跨镜写清归属。信息放入现有动作、运镜、对白与切点栏即可，不为每句对白新建一镜、一个时间段或独立表演检查表。

长镜头示例格式：同一 `SH_010` 下用 `BT_01、BT_02` 标内部节拍，写“连续镜头，不切”；分段生成的技术边界不自动成为艺术切点。用户可以说“第3镜手持更强”“第4与第5镜合成长镜头”，之后同步受影响行和方案。

完整分镜表必须在对话/可见文档面板中实际呈现给用户，并给永久文件链接；长作品分场次展示当前要制作的部分，不将看不到的后续镜头记为已确认。

## 6. 展示与确认记录

采用 [阶段确认](production-approval-gates.md) 的字段，记录展示产物、版本、用户回复、批准范围和下一步。将静态模型与动画拆成两条，不用“制作已批准”一项代替。

项目入口 `PROJECT.md` 更新当前阶段、最新文档链接和实际待办。`project-state.json` 可用 `creative_documents` 指向访谈、视觉设定、剧本、分镜；使用 `stage_reviews` 或现有等价记录。写出状态并不自动证明展示完成，须有实际会话依据。

提示词阶段读取这些已定资料及已认可预演；发现明确遗漏时只补该项，不重新访谈整个项目。修改Skill不自动迁移或重做用户项目。

## 7. 作品范围、章节进度和再次调用

下列内容可合并到已有文件，信息须有实际来源。新连续项目在首轮问答后就登记，不等完片后补写。

`story/sequence-map.md`：

| 章节/场次ID与顺序 | 剧情摘要与原文定位 | 写作状态 | 参考制作状态 | 提示词交付状态 | AI成片状态 | 当前范围/下一动作 |
|---|---|---|---|---|---|---|

写作状态可为`missing/outline/source_supplied/draft/approved`；参考制作状态可为`not_started/static_in_progress/static_approved/animation_in_progress/animation_approved/reference_exported`。交付为`pending/partial/delivered`，AI成片为`not_started/generated/user_approved`。这些不是可互相推断的同一个阶段：已有剧本不代表已建模，有视频文件不代表用户已认可，提示词交付不代表AI影片已生成。

项目入口可采用以下可选字段，不要求旧项目批量迁移：

```yaml
project_kind: serial_story
work_scope:
  action: produce_existing_script # continue_current / write_next / revise / branch
  scene_ids: [SC_010]
  source_script_ref: story/original-script.md
  source_range: "第一章"
  rewrite_scope: "仅按本轮明确修改，不改后续原文"
creative_documents:
  world: canon/world-bible.md
  characters: canon/人物设定.md
  creator_preferences: canon/creator-preferences.md
  screen_language: canon/screen-language.md
  sequence_map: story/sequence-map.md
  continuity: canon/continuity-ledger.md
last_checkpoint:
  scene_id: SC_010
  completed_scope: reference_handoff
  active_revision: r0003
  source_refs: [story/original-script.md, revisions/r0003/分镜表.md]
  open_work: []
resume_context:
  next_existing_script_scene: SC_020
  next_unwritten_scene: null
  next_action: produce_existing_script
  action_status: suggested_not_started
  read_first: [story/sequence-map.md, canon/continuity-ledger.md, canon/人物设定.md, canon/screen-language.md]
```

`canon/world-bible.md`记时代、世界规则、地点与时间线、已知灾难/科技/魔法等事实及出处；`creator-preferences`记剧情体验、题材尺度、主题、不可改点和范围；`screen-language`记摄影、色彩、光线与声音；不能把某场强手持、某次慢节奏或某个角色状态扩成永远不变的全剧命令。

`canon/continuity-ledger.md`：

| 场次与采用版本 | 时间/地点 | 各人物位置、状态和已知信息 | 道具归属/损坏 | 观众已知/未兑现伏笔 | 下一场必须继承/允许变化 | 来源 |
|---|---|---|---|---|---|---|

本段交付回复附项目入口/进度文档链接，让用户知道下次可直接指向该目录。只写实际推进的章节；`project_complete`不能由单个`reference_handoff_complete`自动得出。

## 8. 角色设定板与代理参数

镜头需要可见手—物操作时，按 [简化手部IK](contact-hand-ik.md) 在分镜对应镜号及SceneSpec的`contact_hand_plan`记录模式、左右手、对象、时段、控制来源和连续显示方式。它与基础尺寸分开，不把某一镜需要手扩成全片手部表演。

人物文档同时关联`character_id`、设定图版本、左1/3头部＋右2/3正侧背版式、同一人的状态关系，以及预演参数记录。新代理参数以 [尺寸与弯曲标准](character-proxy-standard.md) 为准：H、W、D、圆柱长、头中心、来源、4骨骼链和支撑面。后续章节复用已有值，不按每轮随机重建体型。

## 9. 多主体交互与当前采用素材

多主体动作按需在现有节拍表补充这些字段，不为无关镜头强制建新表：

| 事件ID/时段 | 发起者→目标/类别 | 准备与生效时刻 | 距离/方向与结果 | 其他参与者当前行动 | 后续状态/占位 |
|---|---|---|---|---|---|

逐角色路线记录“触发—意图—行动—响应—结束状态”；事件表派生处置方式及数量、出手次数。可见道具责任另记“视频中的结构/运动、仅文字表达、外观来源”。

集中素材清单字段：资产ID、源路径、采用版本、交付文件名、大小/哈希、计划或实际标签、用途与状态。当前制作版本、用户已采用版本和上传绑定状态分别填写。
