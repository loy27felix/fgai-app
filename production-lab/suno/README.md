# FG 公司 Suno 音乐服务

FG 的当前适配器位于 `current-api.mjs`，直接使用公司订阅账号的网页接口。提交前读取账号模型目录，只选 `can_use` 的默认模型；`SUNO_MODEL=auto` 不再固定旧版 `chirp-v3-5`。最新网页模型可用与否由公司账号实时返回的目录决定，不能只凭页面上写着 v6 就宣称生成验收通过。

旧 gcui-art/suno-api 库及许可证保留在 `vendor/`，当前请求不调用旧库的验证码或生成脚本。协议参考来自 Suno 当前网页和公开的 [suno-cli 源码](https://github.com/paperfoot/suno-cli)；这不是 Suno 官方承诺稳定的 API。网页登录、模型目录、真实生成和下载都需要公司凭据验收。接口发生变化时明确失败，不自动重放收费请求。

## 公司 Cookie 获取与填写

1. 在公司专用浏览器登录 [Suno](https://suno.com/)，确认订阅、生成额度和作品下载权限。
2. F12 → Application（应用）→ Storage → Cookies → `https://auth.suno.com`，复制 `__client` 的 Value。若该域不在列表，在 Network 找 `auth.suno.com/v1/client` 请求，从 Request Headers 复制 Cookie，其中必须包含 `__client`。不要复制短期 JWT 代替 Cookie。
3. 只在服务器 `/Users/server/work/fg-six-yingce/private-data/suno.private.env` 中填写 `SUNO_COOKIE=__client=<值>`，或完整 Cookie 请求头。不要加引号。保留 `SUNO_MODEL=auto`，首次先保留 `SUNO_ENABLED=false`。文件权限保持 `0600`、目录 `0700`。
4. 仅重建独立 Suno 服务，调用 FG 的只读验证。验证检查余额和模型权限，不产生歌曲：

   ```sh
   cd /Users/server/work/fg-six-yingce
   /usr/local/bin/docker compose --env-file .env -p fg-six-suno -f suno-compose.yml up -d --force-recreate suno
   /usr/local/bin/docker exec fg-six-yingce-gateway-1 node validate-suno.mjs
   ```

5. 验证成功后将 `SUNO_ENABLED=true` 并重建 Suno、再次执行配置命令。制作一项短测试音乐，核对可播放 MP3、NAS 归档和 Suno 作品 ID，才算真实生成验收。

Cookie 属于账号登录凭据，不进入 GitHub、聊天、截图、浏览器响应或公开日志；失效后替换私密文件并重建 Suno 服务。成员无需个人 Suno 或 Codex 账号。

## 2026-10-07 公司账号验证

服务器使用公司提供的 `__client` 成功完成登录刷新和账号读取，确认有可用生成积分。当前账号返回 v6（`chirp-hawk`，默认）、v6-wild（`chirp-hawk-wild`）、v6-mini（`chirp-goose`）。登录响应使用 `session_` 会话 ID，适配器已兼容该格式及旧的 `sess_` 格式，并保持路径字符校验。

服务器生成前检查返回 `required=true`、验证码版本 2。服务器只读验证没有提交歌曲、不扣生成积分。账号凭据已配置，`SUNO_ENABLED=false`，服务器生成及 NAS 音频归档尚未验收；只读登录成功不等于无人值守制作可用。后续以重新运行 `validate-suno.mjs` 为准。

在公司账号已登录的 Suno 网页，经过当前这一次验证码授权后，原创测试歌「FG 公司音乐连接验证」已使用 v6-wild 生成两个版本（24 秒、23 秒），网页播放通过，共消耗公司订阅 10 积分。随后服务器重新检查仍返回 `captchaRequired=true`：网页通过验证没有解除服务器的挑战，因此网页实测成功不能用来打开服务器的自动生成开关。MP3 下载已从网页发起，但浏览器只留下未完成的 `.crdownload` 文件，下载完整性及 NAS 归档仍待验收。

音乐表单包含纯音乐/歌曲、自填歌词/描述创作、模型、标题、Styles 和 Lyrics。自填模式使用独立的歌词 `prompt`、风格 `tags` 和标题 `title`，描述模式使用 `create_mode=inspiration`。字段上限和模型权限在提交前按账号目录再次检查。

内部 `POST /v1/audio/speech` 可以在标准输入之外提供 `suno: {mode, model, title, styles, lyrics, negativeStyles}`。平台请求通过原生音频任务的已有 `instructions` 字段传递 `{"fgSuno": {...}}`；这不会改变火山 TTS 指令。自填带人声歌曲要求填写歌词和风格，纯音乐不要求歌词。请求支持账号返回的模型 ID 或名称，不硬编码未开放的模型。

## 验证码与费用

当前适配器先检查验证码。如果公司账号要求验证码，返回 `SUNO_CAPTCHA_REQUIRED` 并停止提交。管理员可在 Suno 网页检查账号状态；网页通过验证并不保证程序请求获准，需要重新做只读检查。是否能无人值守生成，必须用公司账号实测。不会自动购买验证码、不调用旧脚本，也不会在不确定是否提交成功时再次生成。

**当前不需要配置或购买 2Captcha Key。** `TWOCAPTCHA_KEY` 仅为保留配置，当前代码不使用。[注册 2Captcha](https://2captcha.com/auth/register) 后可在账号面板取得 Key，调用解题需要另行充值；这与 Suno 订阅、歌曲额度是两笔费用。2026-10-06 官网当前页面以英镑显示：Cloudflare Turnstile 为每 1,000 次成功解答 £1.20；reCAPTCHA V2 为 £0.80–£2.45。付款时以账号的币种与实时价格为准。Suno 当前是否使用对应挑战、自动解题是否兼容仍未验证，不能按每首歌固定费用计算。来源：[2Captcha 价格](https://2captcha.com/zh/pricing)。

## 平台范围与提交记录

公司音频工具、原生音频模型选择器及广告、导演台、创作台的音频入口使用同一 `suno-company-music` 渠道。广告任务保留项目归属。Suno 使用公司订阅，对成员免费，不占个人月额度与项目预算；公司订阅积分仍会消耗并记录，不能把用户费用 0 当成上游无限额度。权限、文件容量、并发和防重复提交校验仍生效。

工作台左侧「资源与工具 → 音频设置区」、自由画布“＋”菜单的“音乐、配音与字幕”、创作台“设置 → AI 服务”、导演台“设置 → 默认模型 → 旁白配音”及广告工程内的音频入口均可进入共享表单。表单默认显示带人声歌曲与歌词；纯音乐禁用歌词但保留说明。服务器要求验证码时，可复制创作内容并转到公司账号的 Suno 网页人工处理；该入口不传递账号 Cookie，不承诺网页验证能解除服务器挑战。

当前可用的是共享表单加人工网页制作流程：员工提交创作内容，由持有公司浏览器登录态的操作员完成验证和生成，下载后通过已有素材上传归档。它仍需要操作员，不能宣称所有员工已经可以在 FG 内自动生成。若要接入浏览器工作进程，必须先补齐持久任务领取、人工验证暂停/恢复、生成 ID 回写、下载完整性与 NAS 归档的闭环，并在公司服务器实测；不把网页短期验证码 token 当作通用服务器凭据，不重放结果不明的生成。

每次任务使用持久操作 ID，仅允许一项音乐生成同时运行。提交前明确失败记为 `rejected`，发送后结果不明记为 `uncertain`；已有 ID 不重新提交。一次请求可能返回多个作品，记录全部 ID 并保存首个完成且可下载的音频。管理员可用受内部密钥保护的 `GET /operations/<requestId>` 核对状态和作品 ID。

服务无宿主机公网端口、NAS 文件挂载或 Docker socket。账号 Cookie 仅服务端只读挂载；返回的音频由 FG 原生任务归档到 NAS。没有凭据时可以部署，但音乐生成保持关闭。
