# FG 局域网修复与外网、媒体入口交接

核对日期：2026-10-06。当前优先验收局域网，外网由原负责同事接续。本文不包含登录 Cookie、供应商 Key、隧道 Token 或数据库密码。

## 本次修复及验收边界

| 项目 | 结果 |
| --- | --- |
| 广告项目打不开 HTTP 500 | 根因是广告模型映射只认识文本、图片、视频，扩展公司音频目录后触发 `KeyError: audio`。已跳过没有原生适配器的能力；音频继续从共用音频工具调用。`贝瓦吉他` 的原画布已经在浏览器恢复打开。 |
| 创作台视频下载启动失败 | 原镜像提供的是 Go 构建报告，而下载执行器需要带资源路径及散列的运行清单；并且缺 yt-dlp。已补运行清单、FFmpeg/ffprobe/Python/yt-dlp，16 个已有用户容器保持原工作目录及状态卷。启动检查已通过。 |
| YouTube 下载结果 | 用户链接和 yt-dlp 官方短视频样例都返回 HTTP 429。尚未完成实际视频下载验收，不能把组件修复当成 YouTube 已可用。服务器系统代理未启用，需要确认公司的海外出口或代理；没有读取个人浏览器 Cookie 来绕过限制。 |
| Suno | 公司私有服务及 FG 共用音乐入口已准备。需公司填写私密凭据，验证账号、真实音乐生成和模型版本后才开放。旧开源库默认 3.5；v6 协议兼容性尚未验证。 |
| 现有公司模型 | WeToken 启用 22 个模型；火山接入 Seed Audio 1.0、TTS 2.0、录音文件识别 2.0、机器翻译。两个音频模型进入原生目录，识别/翻译通过工具接口使用。不是需要再开通这四项。 |
| 额度策略 | 仅上述四项火山能力临时不拦月额度及广告预算；仍留存用量和待核验费用，WeToken 原额度规则保持。Suno 没有被扩展为同一豁免策略。 |
| 验证 | 网关 90 项测试、前端 TypeScript 检查通过；镜像构建执行相应测试。广告浏览器验收通过；YouTube 受供应商 429 阻挡；Suno 等待凭据。 |

前三项修复没有重建前五板块应用。核对时 `fgai-app-app-1` 的启动时间仍为 `2026-10-04T20:58:04.177463137Z`，镜像身份与原来一致。

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

**未做/未验收的部分**：没有接管路由器 NAT、防火墙、Cloudflare 账户或外网 TLS 证书；外网浏览器证书提示未处理，用户选择暂只验收局域网。因此不能承诺外网网页已通。

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

按 `../suno/README.md` 执行。私密文件目标 `/Users/server/work/fg-six-yingce/private-data/suno.private.env`，需填公司 `SUNO_COOKIE`、`TWOCAPTCHA_KEY` 和确认过的 `SUNO_MODEL`；成员不需要各自的 Codex 或 Suno 账号。

非官方项目基于登录会话与验证码流程，不能保证它自动兼容 Suno 当前版本。先完成无生成的账号验证，再进行一次音乐生成与 NAS 验收，不自动重复提交付费请求。

## 火山可选追加能力

目前制作流程已有配音、音效、录音转写、字幕导出和文本翻译。若希望直接用麦克风对 Agent 说话，优先追加**豆包流式语音识别 2.0**；若要角色保持专属声音，追加**声音复刻 2.0 及相应音色服务**。端到端实时语音、同传、声音播客不是当前广告/短剧制作的必需项。

官方资料：[实时语音识别 2.0](https://docs.volcengine.com/docs/DoubaoVoice/bidirectional-streaming-automatic-speech-recognition-websocket?lang=zh)、[声音复刻开通指南](https://docs.volcengine.com/docs/DoubaoVoice/Soundreplicationorderingandusageguide?lang=zh)、[Seed Audio 的音频生成范围](https://docs.volcengine.com/docs/DoubaoVoice/audio-generation-http?lang=zh)、[suno-api 接入要求](https://github.com/gcui-art/suno-api)。
