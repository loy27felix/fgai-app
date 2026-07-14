# Wetoken Seedance 异步任务实施计划

> 日期：2026-07-14
> 范围：六个 Seedance 模型、异步 Provider、任务表与 Route Handlers

## 已核对的官方接口

- 创建：POST /api/v3/contents/generations/tasks
- 查询：GET /api/v3/contents/generations/tasks/{id}
- 创建结果主键：id
- 终止状态：succeeded、failed、expired
- 成功视频：content.video_url
- 多模态内容：text、image_url、video_url、audio_url
- 图片角色：first_frame、last_frame、reference_image
- 视频/音频角色：reference_video、reference_audio

## 实施顺序

1. 测试固定六个模型与 filter-off 标记。
2. 测试请求映射、参数校验、创建和查询响应归一化。
3. 新增 generation_tasks 表、索引、RLS 和更新时间触发器。
4. 新增 POST /api/ai/video 与 GET /api/ai/video/[id]。
5. 完成测试、类型检查、构建和最小创建任务 smoke test。
6. 单独提交并推送，确认 Vercel Production 对应提交成功。

本提交不重做视频工作台和画布节点；UI 接入作为下一独立提交。
