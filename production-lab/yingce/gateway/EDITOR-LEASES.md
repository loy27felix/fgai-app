# 编辑权与删除保留 · v1.2.5

`fg_editor_leases` 是仅属于第六板块的 PostgreSQL 表。字段：resource_key（canvas 或广告工作区）、actor_id、generation、expires_at、updated_at；无长期浏览器凭证。启动时幂等建表，升级无需迁移已有画布。

进入可编辑画布后验证既有画布/广告访问权限，取得 45 秒编辑租约，每 5 秒心跳。不同用户进入会更新 generation；同一账号多窗口复用 generation。HMAC 用内部 FG secret 签名，绑定资源、账号和 generation。退出或离线后自然过期，不自动抢回编辑权。

旧窗口心跳或写请求收到 409 / FG_EDITOR_REPLACED，并展示不可关闭的提示，保留本地未提交草稿。普通画布提供 JSON 草稿导出。网关校验写入时持有 PostgreSQL 行锁与事务锁直至响应结束，新成员接管必须等待已接受的保存结束；画布 revision 冲突检查保留。

广告项目归档保留 native_project_id 外键；恢复由原所有者或超级管理员操作。广告不再混入短剧列表。3D 工程删除只移除当前画布节点及连线，先保存云端版本，失败回滚此节点；工程文件、导出资源、历史记录不自动物理删除。普通画布/素材永久删除沿用既有资源引用和清理机制，不在本版扩大删除范围。

免费测试：fg-editor-leases.integration.mjs 使用独立临时 schema 验证接管串行、失效心跳/写入和同账号窗口；Go 仓库测试验证广告外键保留与列表分离。所有测试不创建供应商请求。
