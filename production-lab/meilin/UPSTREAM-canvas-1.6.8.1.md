# 自由画布上游同步：v1.6.8.1（待发布）

核验日期：2026-10-14。上游 `ddcat-ai/open-ai-canvas` main 从 FG 基线 `e70fe1b9c93d6af3b807a87ed15bb621af78095c`（1.3.4 已同步）到 `5d826822c902754a56b44dee9f3daba19bc194f8`（v1.6.8.1），26 个非合并提交、624 个文件。以三方合并方式应用到 `production-lab/meilin/canvas/`，未直接覆盖 FG 目录；本记录只表示源码合并与非付费验证，不表示已部署。

## 上游主要变化

- 图片参数合同（#760）：插件声明统一图片参数、尺寸与定价；后台分辨率档位编辑；Agent 比例 preset 映射与图片参数异常恢复。
- 生图／视频工作台（`/toolbox/image`、`/toolbox/video`）与电商出品工作台，内置 118 个工具目录；后台“工作台工具”管理页。
- 影视剧作工坊内置 Skill（`backend/builtin/影视剧作工坊/`，约 13 万行，含 Python 工具）。
- 个人资料与登录日志：头像（上传／系统头像）、密码与邮箱修改、Linux.do 重验证；管理员“用户登录日志”。
- 千问 AI 平台（QianWenAI MAAS）图像协议插件；模型选择器最近 10 次调用红绿状态条（#768）。
- 修复：SSRF 与 Quality checks（v1.6.6.1）、Agent 工具合同描述压缩、审批暂停恢复、媒体准入参数结构化纠错、创作页提交闸门、Live2D 首帧闪现（#773）、灵感库内置提示词中文化（#763）、旧工作台 v51 迁移账本兼容。

## FG 保留与适配

- 数据库迁移：FG 原生 50–53 已占用（画布回收、保留期、项目归档、canvas_mutation_receipts），上游 51–54 顺延为 54–57（个人资料安全、头像预设、登录日志、工作台工具），`CurrentSchemaVersion=57`。上游“旧工作台 v51 账本”恢复路径在 FG 不适用，对应测试跳过并注明原因。
- 登录：保留所有工作区路由必须登录，不采用上游游客模式；新增工作台路由同样要求登录并受功能开关控制（默认关闭）。
- 账号：网关 `policy.mjs` 新增拦截 `/api/auth/profile/(password|email|linuxdo)`；设置页“个人信息”在 FG 只保留头像，密码／邮箱改为提示由 FG 平台管理。
- 积分与支付：功能开关面板不显示 `creditsEnabled`；不引入兑换码页面；系统更新页仍用 FG 发布页。
- 模型能力：保留 FG 官方参数（3K 档、Seedream／Gemini 4K 预设上限 8192/16777216 像素、GPT 参考图像素约束、Volcengine 纯音频参考开关、视频音频默认值），上游声明式参数仅在 `parameters` 存在时生效。
- 品牌与导航：保留 FG 侧栏、超级工作台命名、GlassAgent 动态球、WeToken 渠道标签；新增工作台入口按开关插入。

## 验证（Windows 开发机，非付费）

- 后端：`go build ./...`、`go vet ./internal/...` 通过；Linux（CGO）全量 `go test` 除 FG 早已移除的支付插件二进制相关用例外全部通过。Windows 工作区 CRLF 导致的影视剧作工坊 Python 树哈希差异已在 LF 下复测通过。
- 前端：`tsc --noEmit`、`eslint`、`bun run build:fg` 通过；`bun test` 2363 通过、10 失败，其中 5 个为基线已有的镜像发布脚本用例，5 个为 Windows CRLF 下的源码字符串断言（LF 下已核对通过）。
- 网关：`policy.test.mjs`、`fg-public-entry.test.mjs` 通过。

## 迁移演练（本机临时 PostgreSQL 17，非生产数据）

- 用 FG main（17facfa）的 `migrate-schema up` 建到 schema 53，叠加网关 `fg-schema.sql` 与按网关写法插入的成员、超级管理员、会话样例。
- 合并后 `migrate-schema up`：53 → 57（54 personal_profile_security、55 user_avatar_presets、56 user_login_logs、57 workbench_tools_and_presets）；再次执行保持 57，`verify` 通过。
- 原有用户与会话字段值不变；新增头像列为可空，`tasks` 新增 `workbench_kind`；FG 触发器 `fg_call_group_snapshot` 保留；网关原有 `INSERT … ON CONFLICT` 写用户仍成功。
- 旧版（schema 53）程序读到 57 会报告 `ready=false`，回滚必须恢复升级前数据库备份与旧镜像，不能只换回旧镜像。
- 尚未在生产快照上演练：在 Mac 上先 `pg_dump` 备份并 `pg_restore --list` 校验，再在隔离容器内恢复快照执行新 `migrate-schema up`。

## 本地浏览器验收（合并后后端 + Vite，演练库）

- 后端在 schema 57 上 `health/ready` 通过（需 Redis）；内置工作台工具目录已写入。
- 设置页“个人信息”只显示头像，账户安全提示由 FG 平台管理；明暗主题与 375px 窄屏无横向溢出。
- 管理后台：用户登录日志、工作台工具页可打开；导航无积分／兑换码；功能开放页隐藏积分、图片／视频工作台默认关闭（4/6 开放）。
- 创作页、FG 侧栏在暗色下正常；接口请求均 200。模型选择器的调用状态条未在真实渠道数据下验证。

## 发布前仍需完成

- 在生产数据库快照上演练迁移 54–57 并确认回滚流程；画布后端、网关同批发布。
- 在有真实渠道与调用记录的环境核对模型选择器状态条、图片参数面板。
- 工作台开关保持关闭，直到其费用、预算与权限链路在 FG 网关下确认；新工作台、影视剧作工坊和千问插件未做真实付费生成验证。
