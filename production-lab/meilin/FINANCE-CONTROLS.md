# 项目隔离与人民币费用控制

故事项目面向团队协作；小组只属于神话故事业务。广告项目默认私有，仅所有者、明确邀请的协作者及超级管理员可进入。既有广告工程保留，历史小组字段不再授权。广告页面独立打开，保留自身外观。

故事、广告项目预算留空或 0 表示无项目上限。创建时可以填写预算，建立后仅超级管理员调整。用户月限额也以人民币保存，0 为不限额；北京时间每月 1 日起重新计数，历史消费保留。

每次实际发往供应商的计费请求，在服务端先检查用户月限额及所在项目预算。通过用户与项目数据库锁串行检查并预留在途费用，避免多个并发请求分别看到相同余额。文本按声明输出上限和保守输入用量预留；缺少输出上限、多模态 Token 用量不可确定或只有部分价格的规格，在限额场景暂停提交。不限额场景保留正常使用。预留值用于额度控制，不作为核销金额。

模型调用失败也可能收费。只有证明请求未发出，或账单已匹配时，才释放对应预留或替换为实际金额；不因缺账单、连接中断、刷新页面而自动释放费用，也不重复提交收费任务。尚未确定的费用在后台明确标记。

对账首页展示第六板块已归属请求，账户流水独立展示同一 WeToken 账户的历史消费。自动匹配必须满足模型和供应商流水一致，且流水只能对应唯一请求。无法匹配时保留待核对；超级管理员核查证据后可人工关联、标记其他系统、备注或撤回。每次人工处理和限额调整记录操作者、时间、原值、新值及依据，原始账单金额保留。

经供应商确认未收费的请求，超级管理员可填写依据后标记为未收费，并释放其预留；请求失败或未出账不构成依据。原始调用日志不改写，操作可撤回且记录审计。如果后续收到精确匹配的实际账单，账单优先，重新计入实际支出。

以上控制覆盖第六板块原生制作任务、云端 Agent、广告制作及系统代理调用。自由画布使用同一用户月限额；没有绑定制作项目时不占故事或广告项目预算。页面每 15 秒刷新，WeToken 授权会话每分钟只读同步，供应商出账前展示待核对。
# 文本输出上限

FG 未指定文本输出长度的原生请求会向供应商显式提交 16,384 Token 上限，以便生成前保留可计算的额度；用户明确指定的上限保留。独立上游部署不受影响。无法确定完整费用上限的多模态规格在设置正额度时仍暂停提交。

## WeToken 每日余额通知

余额日报复用后台「WeToken 账户余额」的数据来源：读取已授权公司账户的 `/api/user/self` 与 `/api/status`，按 `quota / quota_per_unit` 换算 USD；不使用模型 Key 的 billing 限额代替余额。现有一分钟缓存与上游异常回退保持不变。

Gateway 提供仅供自动化读取的 `GET /api/fg/finance/balance-report`（统一入口需带 `/fg-six` 前缀）。配置 Gateway 环境变量 `FG_BALANCE_REPORT_TOKEN` 后启用；值为独立随机令牌（32–256 位字母、数字、`_` 或 `-`），建议使用 `openssl rand -hex 32` 生成。请求头为 `Authorization: Bearer <独立令牌>`；不得使用管理员 Cookie、WeToken Key 或账单授权。默认未配置时返回 404，令牌不匹配返回 401。令牌仅授权读取余额日报，不授权访问其他财务或管理接口。

响应包含 `message`（已排版的日报正文）、`balance`、`currency`、`available`、`stale`、`updatedAt`、`reportedAt`，不返回任何授权凭据。无有效余额时 `balance` 为 `null`，正文明确提示获取失败；回退旧余额时标注上次更新时间与“非当前实时余额”，不能误报为 0 或实时余额。每天均生成余额正文，不以 150 USD 为发送门槛。

### 外部只读接口

已部署地址为 `GET https://218.61.196.139:8300/fg-six/api/fg/finance/balance-report`。这是可供外部自动化调用的只读接口，不是匿名公开账户余额；必须保留独立 Bearer Token，不依赖用户登录 Session。成功返回 200，缺少或错误令牌返回 401，携带正确令牌的非 GET 请求返回 405。余额沿用最多 60 秒的成功缓存，调用方应同时检查 `available`、`stale` 与 `updatedAt`，不能把旧缓存当作刚查询的实时值。

生产机上的验证示例（令牌通过环境变量安全注入，不在命令中写入明文值）：

```sh
curl --fail-with-body \
  --cacert /Users/server/Downloads/192.168.0.99+1.pem \
  --header "Authorization: Bearer ${FG_BALANCE_REPORT_TOKEN}" \
  'https://218.61.196.139:8300/fg-six/api/fg/finance/balance-report'
```

该入口当前使用私有 CA，上述示例显式信任了该 CA；飞书云端不能使用本机证书文件，因此每日通知不再通过飞书 HTTP 步骤拉取此入口，也不依赖新增公网可信 HTTPS。接口鉴权与证书校验继续保留。

### 每日 10:00 服务器主动推送

每天北京时间 **10:00**，生产机 LaunchAgent `com.fgstudio.wetoken-balance-notifier` 执行 `notify-balance.py`，通过 `docker exec` 在独立余额服务容器内读取 `http://127.0.0.1:3011/api/fg/finance/balance-report`，随后向飞书多维表格自动化 Webhook 发送 `{"message":"真实余额日报正文"}`。飞书规则「WeToken 每日账户余额推送（10:00）」仅包含 Webhook 触发与发送飞书消息两个步骤；正文引用 `The return value of request sent in step 1 → message`，不是整个对象或静态示例。

发送者为内置应用机器人「WeToken 余额告警」，目标固定为「weToken扫码支付与商务」群，标题为「WeToken 账户余额提醒」，不使用个人身份，不 @ 负责人。2026-11-13 已将接收群从「余额告警余额告警」替换为该群，保存启用后重新打开规则核对：仅新群被选中，动态余额正文映射保持不变；改群时未额外测试，后于当日 10:01 完成真实补发并确认送达（见下文）。每天均发送，不以 150 USD 为发送门槛。正常报告包含实际余额与余额更新时间；取数失败明确发送“剩余余额未知”，旧余额必须标注非实时，不冒充 0 或当前余额。

生产脚本位于 `/Users/server/work/fg-wetoken-balance-report/notifier/notify-balance.py`，私密配置是同目录 `.env` 中的 `FG_BALANCE_NOTIFY_WEBHOOK_URL` 与 `FG_BALANCE_NOTIFY_WEBHOOK_TOKEN`，分别为专用飞书 Webhook 地址和已启用的 Bearer Token；目录权限 `0700`，文件权限 `0600`。余额只读令牌仍由容器自身环境读取；两类凭证不写入命令参数、文档或群消息。

```sh
# 只读检查余额 / Read balance without sending
ssh server '/usr/bin/python3 /Users/server/work/fg-wetoken-balance-report/notifier/notify-balance.py --dry-run'
# 显式人工重测，会向目标群真实发送 / Explicitly send a fresh report to the group
ssh server '/usr/bin/python3 /Users/server/work/fg-wetoken-balance-report/notifier/notify-balance.py --send-now'
```

任务 plist 位于生产机 `~/Library/LaunchAgents/com.fgstudio.wetoken-balance-notifier.plist`，`StartCalendarInterval` 为 `Hour=10, Minute=0`，时区为 `Asia/Shanghai`。运行要求生产机在线、`server` 用户 LaunchAgent 会话及 Docker 可用。`RunAtLoad` 会检查当日状态：10:00 前不发送，当天已受理则跳过，避免注册任务时重复发送。安装器只 bootstrap 缺失且未显式禁用的任务；已加载任务原样保留，不停止或强制重启任何生产任务。

运行日志为同目录 `notify.log`、`notify-error.log`；`last-accepted.json` 记录按北京时间日期的已受理状态，配合文件锁避免并发和当天重复通知。只有 HTTP 2xx 且返回 `code: 0` 才记录受理，受理不等于群消息送达；遇到结果不明确的网络超时不自动重试，需先检查飞书 Activity Log 与群消息，避免重复。

2026-11-12 **18:09:07（北京时间）** 单次真实联调：余额 `$177.083549 USD`，余额更新时间与报告时间均为 18:09:07，`stale=false`；飞书 Activity Log 显示本次执行 Success，已在当时的「余额告警余额告警」群核对正文及机器人发送者。随后已注册每日任务，核验触发器为 09:30、首次运行退出码 0 且日志为 `not_due`，未重复发送。部署时首个每日计划触发为 2026-11-13 09:30，该次部署验收未等待自然触发。生产同目录 `deployment-result.json` 记录源码基线、dirty 状态与脚本摘要；不能将未提交快照视为 clean commit。

2026-11-13 **09:51:18（北京时间）**，经用户明确授权，仅卸载并重新加载余额通知任务，将每日时间调整为 **10:00**；核验已加载的 calendar descriptor 为 `Hour=10, Minute=0`，任务首次执行退出码 0、日志为 `not_due`。当天 09:30:01 的 Webhook 已受理状态保留，因此当天 10:00 不重复发送，下一次计划通知为 **2026-11-14 10:00**。`--dry-run` 成功读取实时余额（`stale=false`），没有外发消息；其他 LaunchAgent 保持加载，主应用、Gateway 与余额服务容器 ID/启动时间未变。本次未等待 10:00 自然触发，也未额外实测新群送达。通过用户已打开的 Chrome 标签页将飞书规则名称同步为（10:00），保存后返回 Active 3/3 列表；接收群、机器人和动态正文未改动。备份与本次未提交脚本的 SHA-256、源码基线及验证结果保存在生产通知目录的 `backups/` 和 `deployment-result.json`。

2026-11-13 **10:00:01（北京时间）**，现场只读监控确认新时间自然触发，退出码 0、错误日志为空；因当天已受理过通知，记录 `not_due`，未重复发送。随后用户明确要求今天也发送，**10:01:11** 执行 `--send-now` 单次补发，真实余额为 `$167.068206 USD`，余额更新时间同为 10:01:11，`stale=false`。已在飞书「weToken扫码支付与商务」群核对「WeToken 余额告警」入群记录、机器人身份及包含该金额的余额消息，用户随后确认收到。此为新群实际送达验收；每日 10:00 调度保持不变。

### 不重启现有服务的独立部署

`compose.balance-report.yml` 运行独立只读服务 `fg-wetoken-balance-report`，复用当前 Gateway 镜像中的 Node/pg 运行时，仅启动余额接口，不启动账单同步、迁移或生成任务。PostgreSQL 连接默认只读；共享现有账单会话卷时仅以只读方式挂载，不增加主机公开端口。它不替换、不停止已有 Gateway 或 LaunchAgent。

部署时将独立环境文件权限设为 `0600`，配置上述令牌、现有数据库/账单解密凭据、`GATEWAY_RUNTIME_IMAGE`（当前 Gateway 镜像）与 `FG_BALANCE_REPORT_IMAGE`（本次快照镜像）。从本目录执行 `docker compose --env-file <私有环境文件> -f compose.balance-report.yml build balance-report`，再执行相同前缀的 `up -d --no-deps --no-build balance-report`。镜像发布须记录源码基线、dirty 状态及实际复制文件的 SHA-256，不把未提交源码冒充 clean commit。

现有 Nginx 只增加 `entry.conf` 中的精确日报路径，转发到独立服务；先备份原配置，`nginx -t` 成功后 graceful reload，不重启容器。上线后验证无令牌 401、正确令牌 200、非 GET 405、USD 金额与更新时间，并核对原主应用及 Gateway 的容器 ID/启动时间未变。

2026-11-12 实际部署快照位于生产机 `/Users/server/work/fg-wetoken-balance-report/releases/20261112T080920Z-df2ad09a08f6`。为避免 Docker Desktop 的只读文件绑定未即时更新，主入口同时更新主机 `/Users/server/work/fgai-app/docker/nginx/default.conf` 和容器 `fgai-app-nginx-1` 内的 `/etc/nginx/fg-studio-live.conf`；容器 `/etc/nginx/nginx.conf` 改为 include 该 live 文件，保留原入口的全部内容。后续入口维护须核对实际 include，不能只更新主机文件后假定已生效。

回退时将快照中的 `nginx.before.conf` 恢复到主机入口配置，将 `nginx.root.before.conf` 恢复到容器 `/etc/nginx/nginx.conf`，确认实际加载的 default.conf 与备份一致，再执行 `nginx -t` 和 graceful reload。不能擅自停止独立服务或任何现有生产守护进程。

专用只读令牌保存在上述 release 的 `.env` 文件中，变量名为 `FG_BALANCE_REPORT_TOKEN`，文件权限为 `0600`；用于余额接口鉴权，不是飞书主动推送的 Webhook Token。文档和群消息不得记录令牌值。

2026-11-12 17:29（北京时间）的旧 HTTP 拉取方案单次联调失败，错误为 `x509: certificate signed by unknown authority`。旧规则保存的是该时刻的单次触发，并非每日任务；旧规则保留，不再作为每日通知链路。现已通过上述服务器主动推送方式避开其公网 TLS 限制，并完成真实群发与每日调度注册。

现有 `media.diamond2221.cloud` 入口由 Cloudflare Tunnel 直连主应用，不经过主机 Nginx；仅修改 Nginx 不会让该域名自动获得余额路由。若复用该受信域名，需要在 Tunnel 管理端增加精确余额路径并转发到独立只读服务，保留既有路由和令牌鉴权；当前尚未配置该路径。
