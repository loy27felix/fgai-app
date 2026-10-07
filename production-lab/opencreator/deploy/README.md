# FG 综合工作台共享运行组件

软件在公司服务器运行，成员通过 FG 登录进入工作台即可使用。每个成员的项目、会话和配置仍保存在各自的独立挂载中，无需在员工电脑安装 Remotion、Chromium、FFmpeg 或 yt-dlp。

## 构建与发布

此 Dockerfile 包含两个交付目标，构建运行服务必须显式选择 `runtime`：

```sh
docker build --target runtime -t fg-creator-runtime:<release> -f deploy/Dockerfile .
docker build --target web -t fg-creator-web:<release> -f deploy/Dockerfile .
```

`provision.py` 在变更实例前校验镜像启动命令必须为 `node /app/fg-entry.mjs`。Web 镜像不能用于运行服务。

发布前备份每个成员的 SQLite 数据库和服务器私密配置；保留上一版镜像。只在当前成员没有进行中的任务时切换实例，发布后检查实例健康接口及 `/creator/components/status`。配置、账户凭据和数据库备份不进入 GitHub。

## Remotion

镜像内打包与执行器相同版本的 Remotion 组件，并使用 Linux Chromium。打包时校验组件清单与资源哈希，实际渲染包含图片、音频和中文字幕的 1280×720 H.264 视频；组件也保留本地修复档案。

2026-10-07 的局域网发布已验证 Remotion 4.0.473；16 个成员实例健康。另在与成员实例相同的 768 MiB / 1 CPU / 256 PID 限制下通过实际视频渲染验证。

## yt-dlp

镜像提供 yt-dlp 2026.08.19、Python、Node.js 与 FFmpeg。更新检查使用官方 nightly 发布 API；GitHub API 限流时从官方发布 Atom 获取版本，再校验官方 SHA256SUMS。下载及原子安装仍使用原有 URL、版本格式和文件哈希校验。

2026-10-07 更新检查接口返回 HTTP 200，发现可更新版本 2026.09.27.232945。这表示更新检查已恢复，不表示所有成员实例已安装该 nightly 版本。
