# Production Lab / 第六板块

本分支是第六板块的独立试用实现，新增 `/production-lab`、`/api/production-lab/*`、独立数据表，以及工作区中仅超级管理员可见的第六入口。当前已部署到 Mac mini，仅 `profiles.platform_role=superadmin` 的账号可以进入；试用数据写入独立的 `fg_production_lab` 数据库。旧五个板块的页面、数据、画布、浏览器存储和业务接口保持原样。

当前主路径：选题与立项 → 项目创作依据 → 批量分集剧本（多个文本模型比较）→ 审核 → 项目/分集画布 → 画布制作 Agent 与素材草稿 → 推进记录。编剧和导演合并为一个编导工作台；画布里的 Agent 服务当前模型可用时会读取项目、分集、选中节点和上游文字依据，动态提问或提出可确认的新增/修改节点操作。

画布交互正在重做：节点默认工作倍率提高；“适配画布”按当前内容居中；Ctrl/Cmd+滚轮用画布自身的非被动监听，避免浏览器抢走缩放；普通滚轮平移带缓动；空白处拖动相机有可关闭的惯性；Shift+拖动可框选；节点拖动逐帧更新 DOM 与连线，最终一次性写入历史；选中后画布顶部提供复制、克隆、删除和清除选择；撤销/删除后会清除已不存在的节点选择；正文按中英文混排换行并可选中复制。主题在本机读取完成前暂禁切换，避免第一次点击与存储恢复竞争。系统启用“减少动态效果”时会关闭惯性。

生产板块仍是超级管理员内测：图片和视频通过 WeToken 进入独立生产任务表；生成结果会保存到 `production-lab-assets` NAS 目录并登记为团队素材。视频任务按本地任务 ID 调用 WeToken 状态查询，未知提交不会自动重复。估算费用先显示在生成确认中；WeToken 费用 CSV 导入主平台账本后，按 Reference ID 精确显示实付金额与对账状态，不按时间、模型或金额推测。音频独立生成暂未接入；GPU 超分与去水印按用户要求延期。

超级管理员的“团队与费用”页可创建、改名和停用小组，将现有平台账号加入、调组或移出；任职区间和调整记录写入独立试用库。费用按人员、项目和生成时的小组分别汇总，拆分 WeToken 费用单核销、服务商回报、费率参考和暂无法计价记录。剧本 Token 仅在服务商回报完整输入/输出 Token 且模型费率可查时估算，账单仍只按精确 Reference ID 核销。

## 本机交互预览

需要先执行 TypeScript 检查，再由本机已有的 esbuild 打包：

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false
node production-lab/prototype/build.cjs
node production-lab/prototype/server.cjs
```

预览默认只监听 `127.0.0.1:4189`，打开 `http://127.0.0.1:4189/`。它以示例账号在浏览器本地运行，不访问 API，也不调用模型。若在受限环境出现 esbuild `spawn EPERM`，这是当前 shell 的子进程策略；可在允许本机 bundler 子进程的开发环境构建。
如果 4189 已被占用，可设置 `PRODUCTION_LAB_PREVIEW_PORT` 后再启动预览服务；服务仍只监听本机回环地址。

## 超级管理员内测

第六板块在服务端默认启用，但只有数据库角色为 `superadmin` 的已登录账号可以打开页面或调用 API。设置 `PRODUCTION_LAB_ENABLED=false` 可立即关闭；入口只对超级管理员显示。此门禁不使用邮箱白名单或浏览器传入的角色。

模型和数据库只在服务器环境配置：

```dotenv
PRODUCTION_LAB_ENABLED=true
PRODUCTION_LAB_DATABASE_URL=postgresql://lab_user:REPLACE@127.0.0.1:5432/fg_production_lab
PRODUCTION_LAB_TEXT_MODELS=[{"id":"gpt","label":"GPT","model":"...","endpoint":"https://.../v1/chat/completions","apiKey":"..."},{"id":"claude","label":"Claude","model":"...","endpoint":"https://.../v1/chat/completions","apiKey":"..."}]
```

上面是格式示例，不含凭据。模型 endpoint 必须是 HTTPS OpenAI-compatible Chat Completions。密钥只在服务端环境中读取。Claude 需使用兼容网关；目前没有原生 Anthropic 请求适配。

图片 / 视频生成复用服务器端 `WETOKEN_API_KEY`。纯文生视频不要求公网素材入口；选择 NAS 里的图片做视频参考时，另需配置 WeToken 可访问的 HTTPS `PROVIDER_MEDIA_URL`。官方素材由试用管理员在“素材库”上传并分类，文件进入 NAS 下独立的 `production-lab-assets` 目录。

首次测试按顺序将 `migrations/001.sql`、`002-script-runs.sql`、`003-script-run-project-scope.sql`、`004-project-canvas-graphs.sql` 应用到**新的**测试数据库。图片 / 视频队列新增 `migrations/005-media-queue-and-assets.sql`；超级管理员小组与费用快照使用 `migrations/006-superadmin-groups-and-accounting.sql`。在 Mac mini 部署后，以容器内的隔离库变量手动执行 `docker compose exec -T app node scripts/production-lab-migrate.mjs`；脚本只读 `PRODUCTION_LAB_DATABASE_URL`，会拒绝与 `DATABASE_URL` 指向同一主机、端口和数据库的情况，并核验旧第六板块基表存在。不要将此迁移放入主库启动迁移。仍需人工确认数据库地址没有用 DNS 别名指向旧库。

超级管理员可在试用空间里查看、创建、审核和推进项目；其他账号的入口、页面和 API 均受服务端角色检查保护。画布按项目与分集存服务端图，并用版本比较避免静默覆盖。本机副本失败时可导出，版本冲突时可选择保存本机恢复副本后载入服务器版。

## 测试

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false
node production-lab/tests/build.cjs
Get-ChildItem production-lab/tests -Filter *.test.cjs | ForEach-Object { node $_.FullName; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
```

测试使用当前源码构建隔离模块，不会调用模型或数据库。`node --test` 在部分 Windows 沙箱中需要 Node 启动子进程，会遇到 `spawn EPERM`；直接逐个运行测试文件可验证相同断言。

## 参考适配

五个画布项目及 OiiOii、TapNow、LibTV 的采用点见 [REFERENCE-ADAPTATIONS.md](REFERENCE-ADAPTATIONS.md)。TapCanvas 的纯 DAG 排布算法和 Open AI Canvas 主题 store 适配源码与上游声明位于 `lib/production-lab/`。
