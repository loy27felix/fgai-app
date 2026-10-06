# FG 公司 Suno 音乐服务

本服务复用 gcui-art/suno-api 的服务端库，固定上游提交 `a2e6a823428903af715d3835d1cb44ffa336021d`，通过 FG 的原生音频任务、用户权限、制作历史和 NAS 归档接入公司账号。没有另开 Suno 网页后台或公网端口。原始许可证及修改来源保留在 `vendor/`。

## 当前边界

- 服务和 FG 调用入口可以在没有账号凭据时部署，但保持生成关闭。真实登录、验证码流程、音乐生成、v6 兼容性必须在公司填写凭据后验证，不能由单元测试替代。
- `SUNO_COOKIE` 是公司专用账号的登录 Cookie，需要包含 `__client`；`TWOCAPTCHA_KEY` 是独立的验证码服务 Key。Suno 订阅不能替代这两项配置。
- `SUNO_MODEL` 初始为旧库的 `chirp-v3-5`。不猜测 v6 模型标识，不把页面上显示 v6 当成库协议验证成功。
- 所有账号凭据只读挂载到服务，不发送给成员。服务没有 FG/NAS 文件挂载、Docker socket 或宿主机端口。生成音频返回 FG 后，由原生任务保存到 NAS。
- 同一操作持久保存提交记录，只允许一项音乐生成同时运行；请求结果不明时不会重新提交。一次生成可能由 Suno 返回两个作品，当前选择首个完成作品，同时记录全部作品 ID。
- 内部积分传输价格为 0，不代表 Suno 免费。订阅额度、验证码费用和人民币支出待核验。用户临时豁免的四个火山模型额度策略不扩大到 Suno。

## 服务器配置与启用

工作目录：`/Users/server/work/fg-six-yingce`。

1. 编辑 `private-data/suno.private.env`，照 `account.env.example` 填入公司账号 Cookie、2Captcha Key；不要加引号。文件必须保持 `0600`，目录保持 `0700`。
2. 第一次接入先保留可确认的模型键。填写完毕后设置 `SUNO_ENABLED=true`。
3. 重启只有 Suno 服务的独立 Compose 工程：

   ```sh
   cd /Users/server/work/fg-six-yingce
   /usr/local/bin/docker compose --env-file .env -p fg-six-suno -f suno-compose.yml up -d --force-recreate suno
   /usr/local/bin/docker exec fg-six-yingce-gateway-1 node configure-suno.mjs
   ```

4. 后一个命令只检查账号余额/读取权限并登记渠道，不产生歌曲。验证失败时不会开放 FG 音乐模型。
5. 成功后刷新公司音频工具，制作一项短测试音乐，并从原生制作历史核对真实可播放文件、NAS 归档和 Suno 作品 ID。此步骤才算真实生成验收。

平台成员在音频工具选择“音乐与歌曲 · Suno”；有原生音频模型选择器的画布、创作台使用同一 `suno-company-music` 渠道。广告和导演台通过其“音频工具”入口使用，并保留广告项目归属。没有个人 Codex 或个人 Suno 账号的成员也能使用已启用的公司渠道。

## 查询结果不明的操作

`fg_speech_usage` 保留 FG 请求 ID，Suno 服务在 `/state/<requestId>.json` 保留全部作品 ID。受内部服务密钥保护的 `GET /operations/<requestId>` 只返回状态与作品 ID，方便管理员在公司 Suno 账号核对原作品。不要通过创建新任务试探旧任务是否成功。

Cookie 过期时更新私密文件并仅重建 Suno 服务。任何账号信息、验证码费用或供应商错误正文均不应写入公开日志、GitHub、聊天或浏览器。
