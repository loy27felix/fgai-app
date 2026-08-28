---
name: deployment-version-injection
description: 自动部署必须使用拉取提交中的最新脚本，并显式注入镜像部署版本
metadata:
  type: project
---

自动部署发现新提交后先 fast-forward，再重新执行仓库中的最新脚本；构建时必须显式传入 `APP_DEPLOYMENT_VERSION`，运行容器保留镜像内的值，健康检查核对 `/api/version`。

**Why:** 部署进程可能在拉取提交前已启动，继续执行旧脚本会让带版本功能的首次部署回退为 `dev`。
**How to apply:** 修改自动部署流程或排查版本显示时，保持重新执行和显式 build arg 两项约束。
