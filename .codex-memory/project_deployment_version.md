---
name: deployment-version-injection
description: 部署版本注入与生产守护进程不可主动停用的约束
metadata:
  type: project
---

自动部署发现新提交后先 fast-forward，再重新执行仓库中的最新脚本；构建时必须显式传入 `APP_DEPLOYMENT_VERSION`，运行容器保留镜像内的值，健康检查核对 `/api/version`。

**Why:** 部署进程可能在拉取提交前已启动，继续执行旧脚本会让带版本功能的首次部署回退为 `dev`。
**How to apply:** 修改自动部署流程或排查版本显示时，保持重新执行和显式 build arg 两项约束。

生产主机通过本机 SSH alias `server` 连接，禁止直接使用 IP 推断远程用户名。远程非交互 shell 的 `PATH` 不包含 Docker，执行生产只读核验时使用 `/usr/local/bin/docker`；项目目录为 `/Users/server/work/fgai-app`，PostgreSQL 容器为 `fgai-app-postgres-1`。连接信息仅引用 `~/.ssh/config` 中的 alias，不在项目记忆中保存密钥或密码。

## 守护进程保护

用户明确要求：绝不能主动停止生产守护进程，除非用户强制、明确要求停止对应服务。受保护的 LaunchAgent 清单、禁止命令及授权边界以 [AGENTS.md 的生产守护进程保护规则](../AGENTS.md#生产守护进程保护硬性约束) 为准；任何涉及守护进程的操作前必须读取该规则。一般性的修复、部署或重载请求不包含停止授权，脚本中的间接停用同样禁止。

**Why:** 2026-10-12 的生产系统日志确认：14:32:55，经 SSH 执行的 Python 程序主动调用 `launchctl bootout` 卸载 NAS supervisor 和 service-monitor；NAS 任务于 14:33:00 被移除。已查到调用链，尚未确认具体操作者或 Python 脚本来源，不能归因于 NAS 网络故障或普通进程崩溃。LaunchAgent 的 plist 存在且 enabled 不等于任务已加载；被卸载后定时器不会自行恢复任务。

**How to apply:** 先只读区分任务未加载、探针失败和 NAS 网络故障；已加载任务保持运行，缺失且未显式禁用的任务可按授权恢复。安装器与维护脚本也必须遵守保护规则，不得通过暂停生产任务验证恢复逻辑；不能以状态日志长时间没有更新推断进程已停止。

macOS 的 `/dev/fd/N` 属于 fdescfs，路径 `stat` 的设备号可能与真实文件不同，不能用 Bash `-ef` 判断继承的锁 FD 是否指向锁文件；应比较 `fstat(fd)` 与 `stat(path)`。锁文件留在磁盘上不表示被占用，禁止通过删除锁文件或停止生产守护进程解决锁冲突。部署是否完成必须核对实际运行版本，不能仅比较 checkout 与 origin 的提交。

## 报表调度恢复

2026-10-13 核验：生产机于 10 月 8 日 11:44 重启，`server` 于 11:48 登录 console；报表任务最后日志为 11:41，随后任务未加载，但 plist 有效且 enabled。无法据此确认漏加载或后续卸载的具体原因，禁止归因于用户未登录。10 月 13 日 17:24 恢复缺失任务后补算成功，日报已覆盖 10 月 12 日、周报已覆盖 10 月 5 日至 12 日。

**How to apply:** `service-monitor.sh` 在 Docker 检查前恢复已安装、未显式禁用的缺失 report scheduler；不得停止已加载任务。页面历史按类型分别限额，不能把全局最近 40 条中没有月报误判为数据库未生成月报。


## 独立助手 worker 切换核验

2026-11-11 已在用户针对 `com.fgstudio.support-bot-worker` 的重启授权下完成独立快照更新；主业务容器、其他守护任务及生产主仓未替换。实际 release、能力缺口及回退产物以 `.planning/STATE.md` 与生产对应 release 的 `deployment-result.json` 为准；未提交快照必须记录基线 commit、dirty 状态及文件摘要，不冒充 clean commit。

`launchctl bootout` 返回成功时，任务可能仍处于异步退出阶段；必须等待任务真正卸载，再 bootstrap，并等待实际运行 PID/源码路径/启动事件匹配。失败回退也必须等待旧 worker 真正恢复运行，不能用短暂可见的旧 job 记录声称已恢复。本次首轮即时检查误判后，追加 bootstrap 恢复旧 worker，再修正等待逻辑完成切换。切换前保护空队列，不能中断在途工单；这项经验不授予任何其他服务停止或重启权限。


2026-11-12 部署核验发现：当前业务已从 `production-lab/yingce` 迁至 `production-lab/meilin`，网页版本身份为 `meilin-web`，但 Gateway/Agent 仍沿用原标识且实际运行提交不同。助手需要按每个运行版本核对源码路径和对象；不能仅同步生产主仓 HEAD、复用前一天的预检，或将旧独立 `meilin` 服务当成新画布。本次只在明确授权下切换助手，未操作其他守护任务；具体上线证据及回退产物见 `.planning/STATE.md`。
