# 资产库（1.3）

只检索用户登记库根目录与索引，不扫描全部硬盘。Asset Browser 目录不是性能、内容或许可验收。原始下载、清理后的 `.blend`、LOD/proxy、manifest 与许可分别保存，以 `asset_id + version` 定位。

## 资产单元与复用边界

完整地点是默认可复用单元。赌场、公园、出租屋、街道、办公室等应先作为一个可独立拍摄的 `location_set` 保存；不要为了资产化强制把它们拆成门、椅子、桌子和墙体。地点资产保留空间拓扑、功能分区、固定陈设、尺度、主通道、入口/出口、碰撞集合、可行走区、站位/座位/门轴等语义接口，以及它自身所需的中性材质、实例规则、LOD 和依赖。

小道具只在有实际复用依据时提升为独立资产：用户明确要求保存、已在多个地点重复使用，或它有独立且稳定的形态、尺度、原点和交互接口，单独引用会明显省去重建成本。普通场景椅子、门或固定赌桌默认留在地点资产内。Skill 应根据后续使用需求提出建议，不能用硬性数量或类别规则强制分拆。

同一地点的精确复用必须固定到已登记版本，例如 `LOC_CASINO_A@v001`。用户说“还是上一场那个赌场”时，继承该版本的拓扑和接口；用户说“另一个赌场”时建立新的地点资产。临时舞台、封锁线或本场专用陈设应创建 `project_local_variant`，不能回写共享母资产。需要永久改变母资产布局时，发布新版本或派生地点；现有项目不会自动升级。

静态重复物优先链接集合加 Geometry Nodes/Collection Instance；角色独立动作需要独立 rig 与适当的 Library Override/Append，静态集合实例不能赋每人独立动作。不要为改一个角色 make-local 全库。缺资产或插件时用语义代理并明确记录。

## 地点资产升格门

只有用户表达复用/入库需要时，才在静态场景已认可后讨论地点资产；普通任务不增加入库问卷。先以正文编号列出候选地点和其包含范围，再让用户选择：仅当前项目复用、发布到用户指定的共享资产库，或保留为可编辑草案。默认是项目内资产；发布共享库前还必须核查私有参考、第三方素材、插件与许可证。

升格时，从预演文件抽离一个完整地点 Collection，而不是复制整份场戏。地点包必须排除相机和活动相机、Timeline Marker、分镜、镜头时长、角色、角色路径、Follow Path、骨架、Action、NLA、Drivers、任何其他动画、场次布光/天气/氛围/调色、剧本或连续性状态、提示词、节奏数据和项目绝对路径。地点包可保留空间结构、固定道具、语义接口、碰撞/导航、材质分区、性能代理和资产自身的参考资料。

发布前在空白 Blender 文件独立试载，并进行污染扫描。试载必须确认：单位和朝向正确；根 Collection、依赖、材质、纹理、LOD 与实例规则可解析；空间边界、入口/出口、通道、碰撞集合和导航/站位接口仍存在；没有相机、时间线标记、角色对象、角色路径、动画数据、场次灯光、分镜、提示词或节奏元数据。失败时不得标记为可复用地点资产，应保留为项目草案并记录缺口。

新场戏引用地点资产后，只新建该场的角色、角色路径、动作、镜头、灯光、天气、Marker、镜头节奏和视频提示词。地点资产的接口可以约束走位和构图，但不能把旧场戏的演出带入新场戏。

manifest 使用 [asset-manifest.schema.json](asset-manifest.schema.json)。新地点资产使用 `schema_version: "1.2"`；Schema 继续接受历史 `1.1` 清单。记录来源/下载版许可、单位/朝向/原点、集合、bounds、锚点、LOD 三角、材质/纹理和依赖；`location_contract`、`content_contract`、`promotion` 与 `validation` 可记录地点接口、污染排除、发布范围及独立试载证据。角色另记骨架映射/IK/身高，动作记录 FPS/时长/循环/root_motion 或 in_place/支撑脚区间/接触事件。现成攻击和受击不自动配对，scene 内校正根轨迹、接触帧与反应延迟。

## 图片资产参考登记

用户生成、购买或提供的场景/道具图片属于项目级“图片资产参考”，不等同于可直接使用、可分发或可导入的三维资产。每次剧本或场景确认后，将该批图片登记到当前 `project_revision` 的 `asset_reference_manifest`；不要把它们混入共享 Asset Browser，也不要把二维图片路径伪装成 `.blend` 资产条目。

每一条至少记录：`asset_id`、`image_path`、`source_or_generation_tool`（用户提供、拍摄、购买素材或生成工具）、`project_revision`、`reference_views`（正/侧/背/俯视或氛围视图）、`scale_anchor`（已知尺寸、门高、桌高、人物身高等）、`extract_for_blender`（允许提取的轮廓、部件、比例、材质大色块、可见接触面）和 `do_not_copy`（不得直接复制的角色、品牌、标识、图案、受保护造型或不确定部分）。可额外登记 `license_note`、`owner`、`image_resolution`、`confidence` 与 `linked_scene_ids`。

推荐记录形式：

```yaml
asset_id: REF_CASINO_ENTRANCE_001
image_path: 图片资产/casino_entrance_front.png
source_or_generation_tool: user-generated / image model name
project_revision: r03
reference_views: [front, interior-transition]
scale_anchor: main_door_height=2.4m
extract_for_blender: [facade silhouette, revolving-door structure, queue stanchions, warm-cool material blocks]
do_not_copy: [brand logo, readable signage, recognizable artwork]
license_note: user-owned generated reference; verify any uploaded source image separately
```

建模只提取经登记的结构信息：先用尺度锚点定比例，再建立可识别的主体轮廓、主要部件与接触面；图片中的镜头透视、遮挡、夸张光效和不可见背面不能被当作真实尺寸或布局事实。空间邻接、通道、消防/无障碍约束与镜头可达性仍由场景合同、可靠平面资料和实景调研共同决定。

`do_not_copy` 默认非空。对无明确授权的真实照片、网图、品牌空间、角色或设计，只可借鉴通用结构和类别特征，不能复刻可识别外观、商标、文字、艺术品或专有布局。图片参考不替代原图、原模型、纹理、插件和第三方资产的许可证核查；上传或生成图片也不自动取得三维重建、商用、再分发或训练权利。许可不清楚时，保留图片路径和限制说明，改用中性原创代理或要求用户补充授权。

进入 Blender 前，执行“参考图可用性检查”：图片存在且可打开、不是空白占位、已登记真实输入与输出且审核通过、`project_revision` 与当前场景合同一致、至少有一个尺度锚点或明确的待确认尺度、`extract_for_blender` 与 `do_not_copy` 无冲突。自行生图时预建的同名空白文件只代表待替换位置，不是已生成参考，不能凭文件存在绕过门禁；登记细则见 [参考图驱动的场景资产](reference-image-driven-assets.md)。检查失败时只输出缺口和补图提示词，不开始环境/关键道具建模。

人物图按 [人物图准备](character-image-assets.md) 前期询问/复用，缺失时与场景、道具同批给提示词，用于最终身份和服装。Blender 仍用中性代理，人物图不阻挡代理建模和动画。角色素材记录不改变已采用的变换与镜头。

入库：核查许可依赖→独立场景试载→统一米制锚点→LOD/碰撞代理→测实例/角色求值→缩略图与manifest。许可证允许作品使用不等于允许随Skill重分发源资产。

首批只准备当前镜头需要的环境、道具和代理。复用既有模块；没有详细表演委托，不下载骨骼或近战动作包，不为建库预装大量资产。

来源（下载前核对具体版本）：Kenney Nature/City、Poly Haven、ambientCG明确CC0项可作共享基础库。Quaternius页面与2026-08-28总许可有差异，按随包许可和取得版本核验，未澄清不标可重分发；Standard/Pro/Source不同，不能声称全部动作与blend免费。Blender Studio Snow按具体CC-BY署名，可合规用作作品/再分发但不是最轻量默认角色。BlenderKit逐资产区分CC0/Royalty Free；Mixamo核对Adobe当前条款，受限资产只登记用户路径。

来源清单不表示已下载或已验证Blender5.2；逐包测兼容性和动作性能。
