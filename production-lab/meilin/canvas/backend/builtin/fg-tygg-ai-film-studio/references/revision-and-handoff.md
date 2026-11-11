# 版本、项目状态与交接（1.1）

项目资料保存在用户指定的**项目根目录**；Skill 安装目录只保存规则和工具。项目根目录必须含 `PROJECT.md` 与 `project-state.json`，其余资料按职责放入 `canon/`、`story/`、`revisions/`、`assets/`、`blender/` 和 `exports/`。不保存完整聊天记录、密钥或与项目无关的本机资料。

所有项目内来源、产物、参考图和 Blender 文件路径都以项目根目录为基准的相对路径记录，并使用 `/` 分隔符。绝对路径只能在本机执行时临时解析，不能写入 SceneSpec、状态文件、提示词或交接资料。共享资产库可以有外部位置，但项目只记录其稳定 `asset_id`、精确版本和已登记的库引用；不能把本机用户名或机器路径当成资产身份。

## 项目状态

`project-state.json` 是机器读取的唯一当前状态入口；`PROJECT.md` 只提供给人快速恢复上下文。每次继续项目时，先读取状态、当前场次、相关已确认 Canon、相邻场连续性和未决问题，再开始本轮提问或制作。用户未明确项目归属时，先用正文中的稳定编号确认是继续、下一场、分支还是新项目。

3.1另记录`project_kind`、本轮`work_scope`、章节进度索引、`last_checkpoint`与`resume_context`；见 [项目恢复规则](project-documentation.md) 和 [模板](production-document-templates.md)。必须区分已有剧本待制作与尚未写出的剧情；每章分别记录写作、预演、提示词和AI成片状态。旧文件名可经索引复用，不因缺少推荐目录结构而重新访谈或擅自补造事实。

规则3.1的新完整视频项目另用 `creative_documents` 索引访谈、具名人物、摄影色调、剧本和完整分镜，用 `stage_reviews` 或等价字段分别记录静态与动画的展示及用户反馈。结构见 [文档模板](production-document-templates.md) 和 [阶段确认](production-approval-gates.md)。这些是流程记录，不改变既有SceneSpec Schema，不要求旧项目回补虚构访谈。

```yaml
project_state:
  project_id: PX_001
  project_root: "."
  title: "雨夜重逢"
  approved_revision: r002       # 最后一个经用户确认、可作为正式来源的版本
  working_revision: r003        # 当前可修改的草案；不得静默当成已确认版本
  revision_id: r003             # 兼容旧合同，出现时必须等于 working_revision
  parent_revision: r002
  active_scene_id: SC_020
  development_stage: storyboard_review
  approval_status: pending_user
  source_of_truth:
    - {path: "canon/character-bible.md", scope: character, status: confirmed}
    - {path: "canon/location-bible.md", scope: location, status: confirmed}
    - {path: "revisions/r002/scene-spec.json", scope: approved_previs, status: confirmed}
  accepted_decisions: []
  delegated_choices: []
  open_questions: []
  artifacts:
    - id: BLEND_PREVIS_R003
      kind: blend
      path: "blender/previs_r003.blend"
      revision_id: r003
      status: working
      depends_on: ["revisions/r003/scene-spec.json"]
    - id: VIDEO_PROMPTS_R002
      kind: video_prompt_package
      path: "revisions/r002/prompt-package.md"
      revision_id: r002
      status: approved
      depends_on: ["revisions/r002/scene-spec.json"]
  drift:
    status: none                # none | detected | reconciling | resolved
    items: []
```

旧版 `source_of_truth: [director-plan.md, storyboard.md]` 仍可读取，但路径一律按项目根目录解释；写入或重写时应升级为带 `path`、`scope` 与事实状态的记录。用户确认及已明确委托采用的内容可在其授权范围内成为交付来源；标清确认/委托依据与所用 revision，不重复审批受托决定。`proposed` 与 `inferred` 不得伪装成 Canon。

产物状态使用下列值：

- `planned`：尚未生成。
- `working`：属于 `working_revision`，可审阅但尚未获得用户确认。
- `approved`：属于 `approved_revision`，可作为后续正式来源。
- `superseded`：有保留价值的旧版本，不能继续作为当前来源。
- `stale`：所依赖字段已改变，相关内容过期；按本轮用途定点更新，不自动触发整项重建或审核。
- `drifted`：实际 Blender/导出文件与已登记合同不一致，必须先处理差异。
- `unverified`：文件或数据存在，但尚未通过所需审核。
- `missing`：登记的文件找不到，不能假定其内容有效。

旧的 `current` 状态仅为兼容读取；下一次写入时必须根据 revision 归一为 `working` 或 `approved`。

## 修订与失效传播

`approved_revision` 与 `working_revision` 不能混用。新的创作、用户修改或分支建立 `working_revision`；没有已批准版本时，第一份草案为 `r0001`。版本目录保存本轮实际使用或更新的摘要、镜头、SceneSpec、资产引用、提示词和变更/交接记录；未变资料可按明确来源引用，验证报告仅在执行检查时保存。用户认可当前模型与动画后，从现有记录确定该 revision 并提升为 `approved_revision`，直接进入 `prompt_export`，不增加创作 revision，也不为补齐文档运行技术复核。不覆盖旧版本，不把未确认草案当成正式来源。

用户改动故事、人物目标、地点拓扑、关键道具、场次节奏、镜头、路径、动画或参考图时：

1. 在 `working_revision` 的 `change-log.md` 记录请求、原因、变更字段、影响范围和保留依据。
2. 同步项目摘要、对应 Canon/连续性资料，以及实际使用变更字段的场次计划、分镜、SceneSpec和正文；已采用快照保留，并由现行入口说明被覆盖的字段与新依据。
3. 依据真实依赖将使用变更字段的产物标为 `stale`，记录具体范围；不能只因文件来自同一项目或引用了同一整份文档就使全部内容失效。只改文本表达、标签或不参与预演的外观细节时，未改的Blender对象、动作和相机继续有效。
4. 只更新本次需要的失效产物；未重建的可选轨迹、审片图或技术证据保持 `stale`/`unverified`。用户认可修改后的模型与动画即可将其版本标为 `approved`，不要求所有可选产物重新审核。旧资料不能冒充修改后的提示词来源。

资产版本变更遵循相同规则：同一地点在连续剧情中必须精确复用原 `asset_id + asset_version`；新版资产不会自动替换旧项目。仅本场所需的临时改动应登记为项目本地变体，并只影响使用该变体的场次。

文本或绑定修订可独立记录`prompt_revision`或等价字段，并保留所采用的动画/外观版本；不因此递增或重做动画。不能只修最终正文而让现行Canon和分镜继续提供相反事实，具体同步见 [现行事实与历史快照](project-documentation.md#现行事实与历史快照)。未采用的替代方案被取消时，同步撤销其派生补图、动画修改及恢复待办；原文件可保留为历史，当前入口继续指向实际采用的动画、提示词和素材，不按最新文件或最高版本号推断采用。

处理反馈先区分纠错、创意更改、局部接受和整体采用。用户明确纠正直接落实；成因未明也先修复已能确定的错误，不让用户重复说明。按文字、引用、外观、动作、结构或摄影定位影响范围，强化一项体验时保留其他已采用要求。交接记录本次改动、关联资料同步、保留依据与真实检查范围，按用户认可的版本和范围结束修订，不自动进行下一轮生成或精修。

## Blender 漂移与交接

已知用户手动修改了 Blender 且影响当前提示词资料时，记录实际差异，只同步相关镜头、时间、路径/朝向、道具归属或连续性字段。优先依据用户说明和现有记录，必要时做最小范围只读查询；不要在用户确认后自动扫描全场寻找漂移。分流规则见 [用户确认与视频提示词交付](user-review-and-prompt-handoff.md)。

```yaml
drift:
  status: detected
  items:
    - id: DRIFT_001
      artifact_id: BLEND_PREVIS_R003
      scope: [SH_030, CHR_A, ASTUSE_CASINO_01]
      detected_from: "blender/previs_r003.blend"
      differences: ["SH_030.camera.lens_mm", "CHR_A.path_time_map"]
      effect: ["storyboard", "scene_spec", "video_prompt_package"]
      resolution: pending # reconcile_to_working_revision | accept_as_exception | discard
```

不能用已知过期的字段冒充当前最终提示词。将实际改动采纳为新方向时，只写回受影响的分镜、SceneSpec、状态与提示词；用户对该版本的确认无需再由 AI 审核。保留为用户认可的例外时记录范围和原因；放弃改动只能由用户决定，不能擅自覆盖其 Blender 文件。未执行的技术检查或缺少参考视频不属于文档漂移，不阻挡提示词交付。

`revisions/r####/handoff.md` 必须列明项目 ID、项目根相对路径、approved/working revision、活动场次、所用资产的 ID/版本/实例、仍然有效的来源、失效或漂移产物、已验证范围和未决问题。交接不能只给出聊天摘要，也不能引用未登记的本机绝对路径。

连续剧情的本段交接还要更新章节地图与Canon连续性：最后发生了什么、人物/道具结束状态、观众与人物已知信息、后续哪些已写未制作、哪些尚未写、下一次从哪些文件和阶段恢复。只做本段就报告本段交付完成，不自动标全剧完成或启动下一章。

## 交付状态分开记录（3.1）

`prompt_export` 是工作阶段，不能代表视频、外观图和上传全部完成。分别保存 `text_status`、`reference_video_status`、`appearance_assets_status`、`upload_binding_status`、`generation_status` 及对应实际文件/待办；定义和停止条件见 [视频交付](reference-video-delivery.md)。没有材料仍可给条件稿，但已约定的参考视频/人物图未完成不能称整项任务完成。用户仅要提示词或明确不需要相关附件时按该范围结束。

同一动画版本的必要导出不增加创作 revision，不触发复核；实际采用的图、素材标签和生成单位记录独立变化。人物外观调整按依赖范围更新，不使未改的 Blender 路径和代理模型自动失效。旧记录 `prompt_ready` 读作图片 `planned`；`registered` 仅为登记状态，审核用 `review_status` 单列，避免混用。
