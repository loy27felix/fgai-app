# FG 局域网修复与外网、媒体入口交接

核对日期：2026-10-06。本次版本 1.2.17；优先验收局域网，外网由原负责同事接续。本文不包含登录 Cookie、供应商 Key、隧道 Token 或数据库密码。

## 本次修复及验收边界

| 项目 | 结果 |
| --- | --- |
| 广告项目打不开 HTTP 500 | 根因是广告模型映射只认识文本、图片、视频，扩展公司音频目录后触发 `KeyError: audio`。已跳过没有原生适配器的能力；音频继续从共用音频工具调用。`贝瓦吉他` 的原画布已经在浏览器恢复打开。 |
| 创作台视频下载启动失败 | 原镜像提供的是 Go 构建报告，而下载执行器需要带资源路径及散列的运行清单；并且缺 yt-dlp。已补运行清单、FFmpeg/ffprobe/Python/yt-dlp/curl/证书组件及中文 PDF 字体，已有用户容器保持原工作目录及状态卷。 |
| YouTube 下载结果 | 用户链接和 yt-dlp 官方短视频样例都返回 HTTP 429。尚未完成实际视频下载验收，不能把组件修复当成 YouTube 已可用。服务器系统代理未启用，需要确认公司的海外出口或代理；没有读取个人浏览器 Cookie 来绕过限制。 |
| Suno | 公司私有服务及 FG 共用音乐入口已准备，使用新的网页接口适配器，不调用旧库。`SUNO_MODEL=auto` 读取公司账号有权限的默认模型，不固定旧 3.5。公司 Cookie 尚未填写，真实歌曲生成和当前账号模型版本仍待验证；不是已经通过 v6 验收。 |
| 现有公司模型 | WeToken 启用 22 个模型；火山接入 Seed Audio 1.0、TTS 2.0、录音文件识别 2.0、机器翻译及新增流式语音识别 2.0。配音/音效进入原生音频目录，识别/翻译及实时转写从自由画布、广告、创作台和导演台共用音频工具进入。 |
| 额度策略 | 仅上述五项火山能力临时不拦月额度及广告预算；仍校验项目归属、留存用量和未知费用，未知价格没有记为 0。WeToken 和 Suno 沿用原额度规则。 |
| 导演台设置 | 移除“市场”“关于”及通用里的“许可与源码”界面。旧设置链接转到通用；源码、许可证和必要的随包声明仍保留在项目文件中。 |
| 灵感库 | 新增图片/视频分区、来源筛选、搜索、详情和提示词复制。六个已有公开源由服务器每 30 分钟刷新，页面关闭后仍运行；单个源失败保留上次内容。只缓存条目与公开预览链接，没有把参考库全量复制到 NAS。 |
| 验证 | 构建执行网关、Suno、创作台、导演台测试；画布全量检查及失败项补测通过。正式发布后的真实页面和实时语音路径验收另见下方版本记录。YouTube 仍缺成功下载证据，Suno 等待公司 Cookie。 |

此次第六板块发布不替换前五板块应用镜像。原 1.2.16 验收记录中的启动时间是历史快照，不能用它证明主站此后没有重启；主站另有 NAS 和服务守护进程，重启原因需核对相应日志。

## 同步的上游版本

| 板块 | 本次上游提交 | 主要变化 |
| --- | --- | --- |
| 自由画布 | `68491b4c204796238f01b4cbb2686e3fd59ebbf7` | 技能分类维护；分片上传先预留容量；按文件内容识别资源类型与重试交付；Agent 首尾帧视频；渠道开关、Grok 返回格式及 UTF-8 日志截断修复。 |
| FG FOR CREATER | `b674f255febad350afd64600d19c8279523c5769` | v3.2.5 更新；组件本地化、诊断和错误呈现；Remotion 与桌面运行兼容修复。保留 FG 品牌、中文默认、公司渠道及各用户独立运行状态。 |
| FG FOR DIRECTOR | `5335a2ca76f762fc487c5378d29dd379f673034e` | 角色、场景、道具和产品统一素材网格；详情编辑、素材版本预览/恢复、角色衍生图；广告输入与故事设定；外部修改、忙碌素材和失败刷新保护。 |

画布上游新增的上传预留表已补入 SQLite → PostgreSQL 工具清单。线上本次使用 PostgreSQL 增量迁移，没有重新执行跨库复制，也没有覆盖已有用户数据。

## 1.2.17 正式发布与实际验收记录

应用源提交：`22bfba8e401afbf1ba4ff9ae9409953d3c1dfd99`；七项镜像使用 `fg-20261006-1217-22bfba8e401a`。发布前已核验 PostgreSQL 备份及 21 份用户私有状态数据库备份，发布后恢复 17 项既有私有网络连接；前五应用镜像未替换，NAS 用户文件删除数为 0。

- 灵感库正式接口返回 1,273 张图片、5 个视频、6 个来源；详情包含提示词，服务器刷新间隔为 30 分钟。浏览器图片实际加载成功；视频详情加载到 722 × 406、`readyState=4`，复制按钮显示“已复制”。
- 经 FG 登录及 HTTPS WebSocket 代理调用火山流式识别，最终文本为“这是 FG 平台实时语音识别测试。”；音频时长 3.16675 秒，用量已写入数据库，价格仍为未知。测试使用自备短语音，不申请用户麦克风权限。
- 网关、Suno、画布和两个工作台完成相应构建与测试。画布全量检查中的新表清单、技能分类计数和构建目录夹具问题已修复并补测通过。
- 脱敏接口证据：服务器 `/Users/server/work/fg-six-upgrade-20261002/fg-1217-verified.json`。这份记录不包含供应商凭据或用户登录令牌。

**发布后的主站故障单独记录**：21:30:59 主站 NAS 探针再次两次失败，守护停止主站；此后 SMB 挂载表没有 `FgStudio`，NAS 的 TCP 445 可达，但专用 Keychain 凭据读取返回退出码 36（需要用户交互），自动重挂载失败。第六网关等服务仍健康；依赖主站身份校验的广告跳转卡住，导演台转到登录页。因此本轮不能声明广告、创作台和导演台的所有真实页面已再次验收通过，也不能声明整站 502 已解决。已请服务器使用者解锁登录钥匙串并重新挂载公司 NAS；完成后应通过守护的真实读写探针，再续做页面验收。不要关闭身份校验或存储守护来绕过该故障。

## 外网网页入口：已经做了什么

公网地址：`https://218.61.196.139:8300/`。局域网主入口：`https://192.168.0.99:3000/production-lab`。

第六板块主工程位于 `/Users/server/work/fg-six-yingce`；前五板块工程位于 `/Users/server/work/fgai-app`。

已经加入公司可信外网来源 `FG_EXTERNAL_PUBLIC_URL=https://218.61.196.139:8300`，并给主 Nginx 加入同源反向代理路径：

| 路径 | 内部目标 |
| --- | --- |
| `/production-lab`、`/production-lab/…` | 第六网关 `3010/fg/entry`，保留 FG 登录态 |
| `/fg-six/…` | 第六网关 `3010`，原生页面/API |
| `/creator-app`、`/creator-static/`、`/.opencreator/` 等 | 第六网关 `3010`，创作台及运行 API |
| `/advertising-app/`、`/adcraft-api/`、`/adcraft-static/` | 第六网关 `3010`，广告工作台 |
| `/fg-director/`、`/app`、`/api/v1/` 等导演路径 | 第六网关 `3020`，导演台 |
| `/api/public/resources/<合法 ID>/file` | 只读签名素材文件；业务 API 仍需 FG 登录 |

来源文件：`entry.conf`、`apply-public-entry.py`、`gateway/fg-public-entry.mjs`。Nginx 对 Docker 服务名采用动态 DNS，避免容器替换后缓存旧 IP 造成 502。

宿主机 Nginx 配置：`/Users/server/work/fgai-app/docker/nginx/default.conf`；实际生效副本：容器 `fgai-app-nginx-1` 内 `/etc/nginx/fg-studio-live.conf`。两者已核对一致，已热加载，不是重建前五应用。此次入口修改前备份在 `/Volumes/FgStudio/media/yingce/backups/public-entry-20261006T031022Z`。

**未做/未验收的部分**：没有接管路由器 NAT、防火墙、Cloudflare 账户或外网 TLS 证书；外网浏览器证书提示未处理，用户选择暂只验收局域网。因此不能承诺外网网页已通。本次新增的实时识别 WebSocket 已在第六网关 TLS 代理中保留 Upgrade/Connection 头，外网接续时也需保留这些头。

主站 `scripts/auto-deploy.sh` 要求检出目录完全干净后才自动发布；当前主站的 Nginx 同源入口配置有本地修改。不要为了恢复自动发布直接丢弃该文件。应先备份并合并配置，再按同事负责的部署流程处理；GitHub main 推送不等于这台主站已经自动发布。

## 反复 502 的服务端证据

Mac 的 `/Users/server/Library/Logs/fg-studio-nas-supervisor.log` 在本日多次记录：运行中主站存储探针连续返回 `10/10`（NAS 标记读取或校验失败），随后停止应用；另有 Docker 暂不可用、新容器探针超时以及非交互 SMB 重挂载失败，恢复后再重建应用。因此不能只把 502 归因于访问者网络慢，也不能把一次网页恢复视为存储稳定性已经修复。

先区分宿主机 SMB 挂载、Docker 中的挂载可见性、Docker 运行状态与实际 NAS 权限；保留专用 Keychain 凭据和有效 NAS 标记校验。不得通过关闭守护、伪造标记或改写到宿主机同名空目录来消除错误。第六板块发布保持当前存储保护，当前未替换前五板块应用镜像。

同事继续检查：

1. 公网 `8300` 是否确实指向这台服务器的 HTTPS 主入口 `3000`，而非另一个旧容器或仅前五模块。
2. TLS 证书和浏览器访问条件是否可用；由使用者处理浏览器安全提示。
3. 反向代理保留 `Host` 中的公网端口及 Cookie，写请求的 Origin 与公司可信来源一致。
4. 广告/创作/导演跳转不得出现 `192.168.0.99`、`3016`、`3017` 或丢失公网 `8300`。特别核对 Nginx 的 `/fg-director/ → /app` 重定向；目前尚未证明它就是外网故障根因。
5. 用已登录账号依次验收自由画布、广告、创作台、导演台，检查长请求/SSE 的超时及缓冲设置。业务路径不得改成匿名访问。

局域网页面内使用 `3016/3017` 是现有分服务部署；公网访问应走上述同源路径，不能依赖访问者也在局域网。

## WeToken 参考素材：临时 Tunnel 与固定 Cloudflare 规则

这个入口让 WeToken 读取 FG 服务端签发的短时素材链接，与外网成员访问整站是两件事。不会公开整个 NAS，也不是把素材全部上传到临时站点。

当前 `CANVAS_PUBLIC_BASE_URL` 仍为：`https://latitude-louisiana-salon-tribe.trycloudflare.com`。

当前临时容器：`fg-six-media-test-tunnel-1`、`fg-six-media-test-signed-media-1`。已有参考图读取、WeToken 素材接收和单次视频生成证据；临时域名不是长期稳定地址。

请 Cloudflare 账户管理员给已有 `media.diamond2221.cloud` Tunnel 增加以下规则，放在最终 404 前：

```yaml
- hostname: media.diamond2221.cloud
  path: ^/api/public/resources/([0-9a-f]{32}|[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})/file$
  service: http://fg-six-yingce-gateway-1:3010
```

保留旧模块规则 `/api/local/storage/content → http://app:3000`。隧道容器与第六网关需在已有 `fg-studio` Docker 网络内连通。不要转发整个 `/api`、NAS 目录或供应商私密配置。

规则生效后，由 FG 部署人员把第六工程的 `CANVAS_PUBLIC_BASE_URL` 改为固定域名并重建相关服务。替换网关前必须保存现有用户私有网络连接，替换后逐个恢复原有连接；不能只运行普通 Compose 重建然后漏掉这些连接。

固定入口验收：正常签名返回 200 和真实文件字节；错误/过期签名拒绝；旧模块路径正常；一项真实 WeToken 参考素材生成任务成功并存回 NAS。四项通过后再停临时 Tunnel。无需共享 Cloudflare 账户密码，可由账户管理员配置或授权相应协作者。

## NAS 的实际位置与删除边界

NAS 是 `192.168.0.14` 上的 `FgStudio` 共享，Mac 挂载根目录 `/Volumes/FgStudio/media`；部署必须核对 `.fg-studio-nas-ready` 的值为 `fg-studio-media:v1`。业务子目录包括 `yingce/resources/users/<用户 ID>`、`opencreator/users/<用户 ID>`、`arcreel/users/<用户 ID>`。

普通删除进入回收站时保留文件，以支持恢复；“彻底删除”才清理该对象范围内、没有其他引用且没有运行任务使用的文件。独立素材库、其他项目引用、其他用户目录、NAS 其他共享和运维备份不能因删除一个画布而被清除。数据库账单记录也不等同于素材文件，应继续保留核对依据。

本次服务修复没有删除用户 NAS 文件。不要用 NAS 根目录递归清理代替产品的彻底删除 API。

## Suno 的私密配置交接

按 `../suno/README.md` 执行。私密文件目标 `/Users/server/work/fg-six-yingce/private-data/suno.private.env`，需填公司 `SUNO_COOKIE`，保留 `SUNO_MODEL=auto`。当前不需要购买或填写 `TWOCAPTCHA_KEY`，当前适配器没有调用它；成员不需要各自的 Codex 或 Suno 账号。

非官方网页接口基于登录会话，不能保证未来长期兼容。先完成无生成的余额/模型目录验证，再进行一次音乐生成与 NAS 验收。遇到验证码明确停止，不自动解题；网页登录通过验证码也不保证程序调用获准。提交结果不明时不自动重复付费请求。

## 火山可选追加能力

目前制作流程已有配音、音效、录音转写、字幕导出和文本翻译，用户已开通的**豆包流式语音识别 2.0**也已接入。**声音复刻暂不做**。端到端实时语音、同传、声音播客不是当前广告/短剧制作的必需项。独立音乐仍由 Suno 路线补齐，不能把 Seed Audio 入口视为独立音乐模型已经验收。

官方资料：[实时语音识别 2.0](https://docs.volcengine.com/docs/DoubaoVoice/bidirectional-streaming-automatic-speech-recognition-websocket?lang=zh)、[Seed Audio 的音频生成范围](https://docs.volcengine.com/docs/DoubaoVoice/audio-generation-http?lang=zh)。Suno 网页协议参考：[suno-cli](https://github.com/paperfoot/suno-cli)；旧库仅保留源与许可证，不是当前请求执行器。
