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
   /usr/local/bin/docker exec fg-six-yingce-gateway-1 node configure-suno.mjs
   ```

5. 验证成功后将 `SUNO_ENABLED=true` 并重建 Suno、再次执行配置命令。制作一项短测试音乐，核对可播放 MP3、NAS 归档和 Suno 作品 ID，才算真实生成验收。

Cookie 属于账号登录凭据，不进入 GitHub、聊天、截图、浏览器响应或公开日志；失效后替换私密文件并重建 Suno 服务。成员无需个人 Suno 或 Codex 账号。

## 验证码与费用

当前适配器先检查验证码。如果公司账号要求验证码，返回 `SUNO_CAPTCHA_REQUIRED`，管理员需在 Suno 网页处理后再发起新的任务。不会自动购买验证码、不调用旧脚本，也不会在不确定是否提交成功时再次生成。

**当前不需要配置或购买 2Captcha Key。** `TWOCAPTCHA_KEY` 仅为保留配置，当前代码不使用。2Captcha 账号可注册取得 Key，调用解题需要另行充值；这与 Suno 订阅、歌曲额度是两笔费用。2026-10-06 官网报价：Cloudflare Turnstile 为每 1,000 次成功解答 1.45 美元；reCAPTCHA V2 为 1–2.99 美元。Suno 当前是否使用对应挑战、自动解题是否兼容仍未验证，不能按每首歌固定费用计算。来源：[2Captcha 价格](https://2captcha.com/zh/pricing)。

## 平台范围与提交记录

公司音频工具、原生音频模型选择器及广告、导演台、创作台的音频入口使用同一 `suno-company-music` 渠道。广告任务保留项目归属。Suno 不属于火山渠道的额度豁免范围；内部积分价格 0 不代表 Suno 免费。

每次任务使用持久操作 ID，仅允许一项音乐生成同时运行。提交前明确失败记为 `rejected`，发送后结果不明记为 `uncertain`；已有 ID 不重新提交。一次请求可能返回多个作品，记录全部 ID 并保存首个完成且可下载的音频。管理员可用受内部密钥保护的 `GET /operations/<requestId>` 核对状态和作品 ID。

服务无宿主机公网端口、NAS 文件挂载或 Docker socket。账号 Cookie 仅服务端只读挂载；返回的音频由 FG 原生任务归档到 NAS。没有凭据时可以部署，但音乐生成保持关闭。
