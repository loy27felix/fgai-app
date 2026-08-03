# FG Studio

FG Studio 是一个面向个人创作与小团队协作的 AI 视觉工作台：对话、图片、视频、提示词、素材和无限画布在同一个项目中完成。项目使用 Next.js、Supabase 和服务端 AI 路由，模型密钥不会暴露到浏览器。

## 功能

- 对话创作：文本/多模态模型、技能与提示词模板、推理开关、会话历史。
- 独立生图：文生图、参考图编辑、批量生成、历史记录和素材沉淀。
- 独立生视频：4–15 秒时长、全能参考/首尾帧、图片/视频/音频参考素材。
- 无限画布：多画布项目、节点拖拽缩放、连线、参考资产、图片/视频/文本节点、Agent、导入导出和画布副本。
- 提示词库与素材库：提示词收藏、搜索、复制和生成结果归档。
- 用量账本：记录 token、图片/视频调用、供应商实际扣费或已确认的价格估算，并同时显示 USD/CNY。
- 管理后台：按用户、模型、媒体类型查看调用次数、token、费用和待定价记录。

## 本地开发

需要 Node.js 18+：

```bash
npm install
npm run dev
```

打开 <http://localhost:3000>，登录后进入 `/creator` 使用创作台；项目导演功能位于 `/projects`。

## 环境变量

复制 `.env.example` 为 `.env.local`，至少配置：

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
DEEPSEEK_API_KEY=...
DEEPSEEK_BASE_URL=https://api.deepseek.com
WETOKEN_API_KEY=...
WETOKEN_BASE_URL=https://wetoken.ai/v1
USAGE_USD_TO_CNY_RATE=6.77
```

`SUPABASE_SERVICE_ROLE_KEY`、`DEEPSEEK_API_KEY` 和 `WETOKEN_API_KEY` 只能放在服务端环境变量中。`USAGE_USD_TO_CNY_RATE` 仅用于费用展示，可按实际结算汇率调整。

## 费用预估

生成按钮旁会显示当前配置的预估人民币金额。账本遵循以下优先级：

1. 供应商响应中的实际费用；
2. 账单截图/价格快照中已确认的模型、分辨率和时长组合；
3. 尚未确认的组合显示“价格待确认”，不做无依据的线性推算。

## 部署

将仓库导入 Vercel，在 Production、Preview、Development 三个环境配置上面的变量，然后重新部署。Supabase 的 Site URL 和 Redirect URLs 需要包含 Vercel 域名。

## 目录速览

```text
app/                         Next.js 页面和服务端 API
components/                  FG Studio 与创作台组件
lib/                         Supabase、AI 适配器、用量账本
reference/infinite-canvas/   无限画布运行时及其适配层
supabase/migrations/         数据库结构与 RLS
tests/                       类型、账本、API 和价格测试
```

## 开源许可与来源

`reference/infinite-canvas/src/` 是基于
[basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) 的修改版本，适用 AGPL-3.0。修改内容和对应源码保留在本仓库中，详见 [NOTICE.md](NOTICE.md) 与应用内的 `/NOTICE.md`。FG Studio 自有的适配器、业务页面和配置也随仓库源码提供。
