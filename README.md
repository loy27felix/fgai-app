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

1. 在 Docker 主机挂载 NAS 目录，并确保 Docker daemon 有读写权限。
2. 复制 `.env.docker.example` 为 `.env.docker`，填写 `POSTGRES_PASSWORD`、`NAS_MEDIA_PATH` 和 `CLOUDFLARE_TUNNEL_TOKEN`。`NAS_MEDIA_PATH` 填 Docker 主机上的绝对路径，例如 `/Users/server/storage/mnt_nas_fg-studio-media`；Compose 会把它挂载到容器内的 `/data/media`，不要把容器路径写入该变量。
3. 在 Cloudflare Tunnel 的 Published application 中，把 Service URL 配置为 `http://app:3000`。`cloudflared` 与 App 在同一个 Docker network 中，不能填写宿主机的 `localhost`。
4. 把 Tunnel 的公网 HTTPS 地址写入 `PROVIDER_MEDIA_URL`，例如 `https://media.example.com/api/local/storage/content`。`LOCAL_MEDIA_URL` 继续使用 `http://192.168.0.99:3000/api/local/storage/content`，分别服务局域网浏览器和 Wetoken。
5. 执行 `docker compose --env-file .env.docker up -d --build`，应用访问 `http://192.168.0.99:3000`，Cloudflare Tunnel 负责把带签名的媒体 URL 转发给 App。

服务器网络如果封锁 UDP/7844，Compose 会强制 `cloudflared` 使用 HTTP/2，避免 Tunnel 自动切换到不可用的 QUIC。修改 Tunnel 配置后执行 `docker compose --env-file .env.docker up -d cloudflared` 使连接重新建立。

媒体访问经过应用鉴权，不能直接公开 NAS 目录。带参考图片/视频/音频调用外部 Wetoken 时，必须使用 Cloudflare Tunnel 提供的公网 HTTPS 地址；`192.168.x.x`、localhost 和需要登录的局域网地址无法被 Wetoken 下载。签名媒体 URL 会按 TTL 自动过期。纯文生视频不受此限制。不要把 Cloudflare Tunnel 的 token 提交到 Git。

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
