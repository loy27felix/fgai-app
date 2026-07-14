# Wetoken 图片模型迁移实施计划

> 日期：2026-07-14
> 范围：图片模型目录、Provider 适配、Next.js 统一路由、四处前端调用迁移
> 不包含：Seedance 视频任务与视频画布节点

## 目标

- 仅保留并接入用户指定的四个图片模型。
- GPT Image 2 使用 OpenAI-compatible image generation/edit 接口。
- 三个 Gemini 图片模型使用 `generateContent` 接口。
- 支持无参考图生成和最多四张参考图。
- 所有浏览器调用统一走 `/api/ai/image`，不再依赖线上 `gen-image` Edge Function。
- 生成结果继续写入 Supabase Storage、资产库或镜头字段。

## 测试先行

1. 模型目录测试：精确包含四个模型、Provider 与实验性标记正确。
2. 请求转换测试：GPT JSON、GPT 多图 FormData、Gemini text/inlineData 请求正确。
3. 响应测试：GPT `b64_json`/URL、Gemini `inlineData` 均归一化为二进制结果。
4. 前端迁移后搜索确认不再调用 `functions.invoke('gen-image')`。
5. 运行 `npm test`、`npx tsc --noEmit`、`npm run build`。
6. 对四个真实模型执行最小 smoke test，只记录状态、MIME 与字节数。

## 提交边界

单独提交并推送：`feat(image): migrate generation to Wetoken gateway`。推送后确认对应 SHA 的 Vercel Production Deployment 成功。
