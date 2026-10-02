# FG Studio 第六板块 · 1.2.0

`canvas/` 保存画布源码和 FG 定制；`gateway/` 负责平台登录、故事立项、人民币报价与账单核销。公司更新见根目录 `CHANGELOG.md`。

## 版本与隔离

FG 对外版本为 **1.2.0**，上一版为 1.1.2。Open AI Canvas v1.6.0 / 42f14cd7 仅为上游技术来源。保留 `canvas/LICENSE` 和第三方声明；产品品牌、版本和更新链接使用公司仓库。

独立 PostgreSQL、Redis、后台、前端、Agent 与网关；原五个板块不重建、不重启、不迁库。入口 `/production-lab`，独立服务默认 3016，后台 `/admin`。每次请求校验原平台超级管理员试用权限。

## 业务与费用

故事选题 → S/A/B/C 立项、制作小组和人民币预算 → 项目 → 分集与制作画布 → 生成任务 → 人工选择与交付。请求保留用户、项目、画布与任务归属，预算不计入实际花费。

WeToken Key 仅保存在服务器渠道。生成前按模型、参考素材、比例、尺寸、画质、时长和分辨率展示人民币费率及估算。文本和图片 Token、未核验规格与 Seedance 参考视频最低 Token 用量不能冒充固定单次价格。

实际金额来自 WeToken 费用流水，`x-oneapi-request-id` / Reference ID 精确核销；异步视频保留任务编号。重复不重复计费，冲突中止导入，未唯一匹配的流水单独列出，不按时间或金额猜测归属。账户合计包含同账户其他系统历史消费；项目统计仅含明确归属请求。

授权会话保存到独立只读凭证卷。网关每分钟只 GET 固定账单接口、读取完整分页；不保存密码、不自动登录、不调用账户管理或充值接口。过期后暂停并提示重新授权，CSV 仍可补充核对。页面每 15 秒刷新，核销有供应商出账延迟。

人民币采用管理员配置的记账换算系数，历史核销保留当时系数；不是银行汇率或充值人民币实付金额。

## 持久化

上传及生成媒体存 NAS；上传必须取得服务器资源 ID，失败直接提示，不能返回浏览器本地上传成功。项目、画布、任务、费用记录存独立 PostgreSQL 持久卷，每日备份 NAS。浏览器缓存只用于读取加速和待同步草稿；服务端未确认的修改不能视为已保存。

`maintain-host.py` 检查 NAS 真实读写，挂载失效暂停新后端，避免写宿主机空目录。备份经 `pg_restore --list` 和读回摘要验证；未做停机灾难恢复演练。

## 运行

1. 配置私有 `.env`：数据库、TLS、NAS、平台网络与三个镜像变量。凭证、账单、素材、备份不提交 Git。
2. 实际选题放 `private-data/topics.json`，Compose 只读挂载。JSON 数组字段包括 id、title、original、plot、style、markets、form、tier；人员映射只留私有数据。
3. 账单同步可选：设置 `WETOKEN_FEE_SESSION_FILE=/run/fg-secrets/wetoken-fee-session.json` 和 `FG_FEE_SYNC_ACTOR_ID`（已有授权 FG 管理员 UUID）。会话格式 `{cookie,userId,expiresAt}`，凭证卷文件 0600、所有者为网关 Node 用户；只使用明确授权的会话。
4. 在 `canvas/` 构建 `backend/Dockerfile.fg`、`Dockerfile` 和 `yingce-agent/Dockerfile`，传 `BUILD_VERSION=v1.2.0` 与公司提交 SHA。
5. 备份并核验第六任务空闲，再仅替换第六后端、前端和网关；Nginx 检查后热加载。验收版本、NAS、账单状态，以及原应用镜像与启动时间未变。

主分支自动部署可能重启原五个板块，因此试用版由独立发布分支部署，合并主分支须安排正式发布窗口。
