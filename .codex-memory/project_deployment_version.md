---
name: deployment-version-injection
description: 自动部署必须使用拉取提交中的最新脚本，并显式注入镜像部署版本
metadata:
  type: project
---

自动部署发现新提交后先 fast-forward，再重新执行仓库中的最新脚本；构建时必须显式传入 `APP_DEPLOYMENT_VERSION`，运行容器保留镜像内的值，健康检查核对 `/api/version`。

**Why:** 部署进程可能在拉取提交前已启动，继续执行旧脚本会让带版本功能的首次部署回退为 `dev`。
**How to apply:** 修改自动部署流程或排查版本显示时，保持重新执行和显式 build arg 两项约束。

生产主机通过本机 SSH alias `server` 连接，禁止直接使用 IP 推断远程用户名。远程非交互 shell 的 `PATH` 不包含 Docker，执行生产只读核验时使用 `/usr/local/bin/docker`；项目目录为 `/Users/server/work/fgai-app`，PostgreSQL 容器为 `fgai-app-postgres-1`。连接信息仅引用 `~/.ssh/config` 中的 alias，不在项目记忆中保存密钥或密码。
