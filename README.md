# FG Studio

FG Studio 是一个面向个人创作与小团队协作的 AI 视觉工作台：对话、图片、视频、提示词、素材和无限画布在同一个项目中完成。项目使用 Next.js、PostgreSQL、NAS 和服务端 AI 路由，模型密钥不会暴露到浏览器。

## 功能

- 对话创作：文本/多模态模型、技能与提示词模板、推理开关、会话历史。
- 独立生图：文生图、参考图编辑、批量生成、历史记录和素材沉淀。
- 独立生视频：4–15 秒时长、全能参考/首尾帧、图片/视频/音频参考素材。
- 超级画布：多画布项目、节点拖拽缩放、连线、参考资产、图片/视频/文本节点、Agent、导入导出和画布副本。
- 提示词库与素材库：提示词收藏、搜索、复制和生成结果归档。
- 用量账本：记录 token、图片/视频调用、供应商实际扣费或已确认的价格估算，并同时显示 USD/CNY。
- 管理后台：按用户、模型、媒体类型查看调用次数、token、费用和待定价记录。

## 本地开发

需要 Node.js 18+：

```bash
pnpm install
pnpm dev
```

打开 <http://localhost:3000>，登录后进入 `/creator` 使用创作台；项目导演功能位于 `/projects`。

## 环境变量

复制 `.env.example` 为 `.env.local`，至少配置：

```env
DATABASE_URL=postgres://fg_studio:密码@localhost:5432/fg_studio
NAS_MEDIA_PATH=/Users/zhangyu/work/beva/mnt_nas_fg-studio-media
SESSION_SECRET=...
DEEPSEEK_API_KEY=...
DEEPSEEK_BASE_URL=https://api.deepseek.com
WETOKEN_API_KEY=...
WETOKEN_BASE_URL=https://wetoken.ai/v1
WETOKEN_ASSET_BASE_URL=https://asset.wetoken.ai  # 可选，Seedance 素材库地址
USAGE_USD_TO_CNY_RATE=6.77
```

`DATABASE_URL`、`SESSION_SECRET`、`DEEPSEEK_API_KEY` 和 `WETOKEN_API_KEY` 只能放在服务端环境变量中。`USAGE_USD_TO_CNY_RATE` 仅用于费用展示，可按实际结算汇率调整。

## 费用预估

生成按钮旁会显示当前配置的预估人民币金额。账本遵循以下优先级：

1. 供应商响应中的实际费用；
2. 账单截图/价格快照中已确认的模型、分辨率和时长组合；
3. 尚未确认的组合显示“价格待确认”，不做无依据的线性推算。

## 部署

生产部署使用 Docker Compose。

### 局域网 Docker + NAS 部署

局域网部署使用纯本地 Docker 服务，应用和 PostgreSQL 由仓库根目录的 `docker-compose.yml` 管理，媒体文件直接写入 NAS 挂载目录。数据库使用独立 Docker volume，不要把数据库目录放在普通 SMB 共享上。

1. 在 Docker 主机挂载 NAS 目录，并确保 Docker daemon 有读写权限。未挂载时，宿主机上的空挂载点必须保持只读，避免媒体误写到本地磁盘。
2. 复制 `.env.docker.example` 为 `.env.docker`，填写 `POSTGRES_PASSWORD`、`NAS_MEDIA_PATH`、`NAS_EXPECTED_HOST`、`NAS_EXPECTED_SHARE`、`NAS_MOUNT_URL` 和 `CLOUDFLARE_TUNNEL_TOKEN`。`NAS_MEDIA_PATH` 填 Docker 宿主机上的绝对路径，例如 `/Volumes/FgStudio/media`；`NAS_EXPECTED_HOST` 和 `NAS_EXPECTED_SHARE` 分别填写 NAS 固定地址与共享名；`NAS_MOUNT_URL` 填不含密码的 SMB URL，凭据必须保存在宿主机当前账号的 Keychain。Compose 会把宿主机目录挂载到容器内的 `/data/media`，不要把容器路径写入该变量。
3. 在 Cloudflare Tunnel 的 Published application 中，把 Service URL 配置为 `http://app:3000`。`cloudflared` 与 App 在同一个 Docker network 中，不能填写宿主机的 `localhost`。
4. 把 Tunnel 的公网 HTTPS 地址写入 `PROVIDER_MEDIA_URL`，例如 `https://media.example.com/api/local/storage/content`。`LOCAL_MEDIA_URL` 继续使用 `http://192.168.0.99:3000/api/local/storage/content`，分别服务局域网浏览器和 Wetoken。
5. 执行 `docker compose --env-file .env.docker up -d --build`，应用访问 `http://192.168.0.99:3000`，Cloudflare Tunnel 负责把带签名的媒体 URL 转发给 App。

常用 Docker 命令已集成到 `package.json`，均应在实际 Docker 主机的项目目录执行：

```bash
pnpm docker:config        # 校验 Docker Compose 配置
pnpm docker:ps            # 查看 App、PostgreSQL 和 Tunnel 状态
pnpm docker:up            # 构建并启动全部服务
pnpm logs:docker          # 持续查看全部容器最近 200 行日志（含时间戳）
pnpm logs:app             # 只看 Next.js App 与服务端业务日志（含时间戳）
pnpm logs:app:history     # 列出自动部署归档的 App 历史日志
pnpm logs:postgres        # 只看 PostgreSQL 日志（含时间戳）
pnpm logs:tunnel          # 只看 Cloudflare Tunnel 日志（含时间戳）
pnpm logs:monitor         # 查看统一服务状态与新增业务错误告警
```

日志命令会持续跟随新输出并显示 Docker 时间戳，按 `Ctrl+C` 退出，不会停止容器。排查 App 内的具体链路时，可继续按现有日志标识过滤：

```bash
pnpm logs:app | grep '"event":"creator_image"'  # 图片生成与供应商请求
pnpm logs:app | grep '\[creator video'             # 视频生成、提交与轮询
pnpm logs:app | grep '\[local media'               # NAS 媒体鉴权、读取与失败
```

本地执行 `pnpm dev` 时，App 日志直接输出在当前终端，不经过 Docker；浏览器端日志仍在浏览器 DevTools Console 中查看。

实际运行 Docker 的 macOS 宿主机必须安装 NAS 守护进程；不要在开发机或仅用于编辑代码的机器上执行：

```bash
chmod +x scripts/nas-supervisor.sh scripts/install-nas-supervisor.sh
scripts/install-nas-supervisor.sh
```

安装脚本会在终端要求输入一次 NAS 密码，并仅保存到当前运行账号的 macOS Keychain。守护进程每 10 秒校验一次真实 SMB/NFS 文件系统、NAS 主机、读写探针和容器内标记。NAS 断开时只停止 `app`，从专用 Keychain 条目读取凭据后以无界面方式重新挂载，不会弹出 Finder 登录窗口；NAS 恢复后使用 `--force-recreate` 重建 `app`，避免复用失效的 bind mount。PostgreSQL 始终保持运行。执行 `pnpm logs:nas` 可同时跟随标准与错误日志。应用自身也会在 NAS 标记缺失时拒绝媒体读写并返回 `503`，因此不能通过本机空目录继续写入。

### main 分支自动重部署

由于 Docker 主机位于局域网内，GitHub 无法直接访问它，自动部署使用部署主机上的用户级 LaunchAgent 轮询 `origin/main`。只在实际 Docker 主机 `/Users/server/work/fgai-app` 执行，不要在开发机安装：

```bash
chmod +x scripts/auto-deploy.sh scripts/install-auto-deploy.sh
scripts/install-auto-deploy.sh
```

服务每 30 秒检查一次 `origin/main`。只有工作树干净、提交可以 fast-forward、NAS ready marker 存在且 Docker Compose 配置有效时才会部署；它会构建 `app`，在重启前执行 `docker/initdb/002-local-upgrade.sql` 的幂等数据库升级，仅重建 `app` 容器，并等待容器 health 与 `http://127.0.0.1:3000` 返回成功。构建、数据库升级或健康检查失败时会回退到上一提交，并记录失败 SHA，避免同一个坏提交反复重启服务。

每次自动重建 `app` 前，脚本会先将当前容器的完整 stdout/stderr 归档到宿主机 `$HOME/Library/Logs/fg-studio-app/`，文件名包含 UTC 时间、容器 ID 和提交 SHA；新容器启动失败时也会先归档失败容器日志，再执行回滚。该目录不随容器删除，使用 `pnpm logs:app:history` 查看历史归档文件。

执行 `pnpm logs:deploy` 可同时跟随自动部署的标准与错误日志。部署主机必须能够访问 Git remote；私有仓库的 Git 凭据应配置在该主机的 Git credential helper 或 SSH agent 中，不要写入仓库或 `.env.docker`。

服务器网络如果封锁 UDP/7844，Compose 会强制 `cloudflared` 使用 HTTP/2，避免 Tunnel 自动切换到不可用的 QUIC。修改 Tunnel 配置后执行 `docker compose --env-file .env.docker up -d cloudflared` 使连接重新建立。

### 服务监控与告警

Docker 主机使用统一 LaunchAgent 每 30 秒检查 Docker、NAS、App HTTP、PostgreSQL、Cloudflare Tunnel、系统磁盘和 App 新增 `error/fail` 日志。App 异常由 NAS supervisor 重建，PostgreSQL 连续 3 次 unhealthy 后自动重启，Tunnel 连续 2 次未 ready 后自动重启 connector 并重新解析 Edge 地址；Docker Desktop 不可用时会请求 macOS 启动。所有容器使用 Docker `local` logging driver，单文件上限 20 MB、最多保留 10 个轮转文件。

在实际 Docker 主机执行：

```bash
chmod +x scripts/service-monitor.sh scripts/install-service-monitor.sh
scripts/install-service-monitor.sh
```

状态变化会写入 `$HOME/Library/Logs/fg-studio-service-monitor.log`，匹配到的 App 错误会追加到 `$HOME/Library/Logs/fg-studio-monitor/app-errors.log`。如需主动通知，在 `.env.docker` 配置 `FG_MONITOR_WEBHOOK_URL`，并将 `FG_MONITOR_WEBHOOK_TYPE` 设置为 `generic`、`feishu` 或 `wecom`；未配置 webhook 时不影响自动恢复和本地日志。告警只在健康状态发生变化时发送，恢复后也会发送一次，避免重复轰炸。

媒体访问经过应用鉴权，不能直接公开 NAS 目录。带参考图片/视频/音频调用外部 Wetoken 时，应用会先用 Cloudflare Tunnel 的公网 HTTPS 签名 URL 和生成任务的精确 `model` 创建 WeToken 素材，等待 `GetAsset` 返回 `Active`，再把 `asset://asset-...` 交给 Seedance；上传或确定性提交失败时会尽力清理本次新建素材。`192.168.x.x`、localhost 和需要登录的局域网地址无法被素材库下载。签名媒体 URL 会按 TTL 自动过期。纯文生视频不需要素材库上传。该素材库契约仅适用于 Seedance 视频参考素材，Wetoken 文本视觉输入和图片编辑继续使用各自原生协议。不要把 Cloudflare Tunnel 的 token 提交到 Git。

参考素材确认前会使用 `Range: bytes=0-0` 做公网预检；对 `530`、`5xx` 和网络超时最多重试 3 次。重试后仍不可达时返回 `503 REFERENCES_TEMPORARILY_UNAVAILABLE` 并保留草稿，不进入 Wetoken 素材上传和用量扣除；`401/403/404` 等确定性访问失败则直接返回 `REFERENCES_NOT_REACHABLE`。

## 目录速览

```text
app/                         Next.js 页面和服务端 API
components/                  FG Studio 与创作台组件
lib/                         本地数据库、认证、媒体、AI 适配器、用量账本
reference/infinite-canvas/   超级画布运行时及其适配层
docker/initdb/001-local.sql  PostgreSQL 初始化结构
docker/initdb/002-local-upgrade.sql  已有本地 volume 的幂等升级
tests/                       类型、账本、API 和价格测试
```

## 开源许可与来源

`reference/infinite-canvas/src/` 是基于
[basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) 的修改版本，适用 AGPL-3.0。修改内容和对应源码保留在本仓库中，详见 [NOTICE.md](NOTICE.md) 与应用内的 `/NOTICE.md`。FG Studio 自有的适配器、业务页面和配置也随仓库源码提供。
