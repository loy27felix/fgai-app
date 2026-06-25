# FG Studio — M1（Next.js + Supabase + DeepSeek）

AI 漫剧平台第一版可运行薄切片：**@beva.com 登录 → 项目列表/新建/加入审批/权限 → 故事圣经（AI 破题 + 一键导入 + 保存/锁定）**，AI 走后端 API 路由接 DeepSeek。

> ✅ **数据库已经接好并上线**：本工程已直连你的 Supabase 项目 **`fgai`**（区域 ap-southeast-1）。
> 表结构、RLS、`@beva.com` 注册域限制、项目/成员/加入审批的粘合层都已经配好。
> `.env.local` 也已填好真实连接信息，**装好依赖就能本地直接跑、连真库**。

---

## 一、本地运行（现在就能跑）

需要先装 **Node.js 18/20**（https://nodejs.org，LTS）。然后在 `fg-studio` 目录：

```bash
npm install
npm run dev
```

打开 http://localhost:3000 ：

1. 「去注册」用 `你的名字@beva.com` 注册（非 @beva.com 会被数据库直接拒绝）。
2. 登录后进入 **项目列表**：可「新建项目」（自动成为负责人）、对别人项目「申请加入」、负责人在卡片上「通过」审批。
3. 进入项目 → **故事圣经**：右侧「✦ AI 破题」让 DeepSeek 产出结构化设定 → 「一键导入」填进左侧字段 → 「保存」；可手动改、可「锁定」。

> 想把自己设成超级管理员：注册后在 Supabase → SQL Editor 执行
> `update public.profiles set platform_role='superadmin' where email='你的邮箱';`

---

## 二、连的是哪套数据库？

- Supabase 项目：`fgai`（id `bhhddknlibytjinlnfhl`）
- 已有完整基础表：`profiles / projects / project_members / project_join_requests / whitelist / scripts / scenes / shots / assets / generations …`
- 故事圣经存在 **`projects.story_bible`(jsonb)**，锁定标记是 **`projects.style_locked`**。
- 本次额外补的粘合层（已应用到线上，见 `supabase/migrations/0001_init.sql`）：
  1. 建项目自动把创建者写为 `owner` 成员；
  2. 加入申请的自助插入策略；
  3. 负责人审批申请的更新策略。

环境变量在 `.env.local`（已填好）：`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`。

---

## 三、上线到 Vercel（最后一步，需要你的 Vercel 账号）

我无法替你登录 Vercel，所以这一步要你点一下。两条路任选其一：

### 路线 A：命令行（最快）
在 `fg-studio` 目录：
```bash
npx vercel login      # 浏览器里登录一次
npx vercel            # 首次部署（一路回车即可）
```
然后到 Vercel 网页 → 该项目 **Settings → Environment Variables** 填这 4 个（值见 `.env.local`）：
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
DEEPSEEK_API_KEY
DEEPSEEK_BASE_URL
```
填完执行 `npx vercel --prod` 发布正式版。

### 路线 B：GitHub + 网页导入
把 `fg-studio` 推到一个 GitHub 仓库 → Vercel「Import Project」选它 → 同样在 Settings 里填上面 4 个环境变量 → Deploy。

> 上线后到 Supabase → **Authentication → URL Configuration** 把你的 Vercel 域名加进 Site URL / Redirect URLs。
> 想让我直接帮你部署：给我一个 **Vercel Access Token**（vercel.com/account/tokens 生成），我就能用命令行带着环境变量一键发上去。

---

## 四、目录结构

```
fg-studio/
├─ supabase/migrations/0001_init.sql   # M1 粘合层（已应用到线上）
├─ middleware.ts                        # 会话刷新 + 路由守卫
├─ lib/
│  ├─ supabase/{client,server,middleware}.ts
│  ├─ deepseek.ts                       # DeepSeek 封装（重试/thinking/JSON）
│  └─ types.ts
├─ app/
│  ├─ login/page.tsx                    # @beva.com 登录/注册
│  ├─ projects/page.tsx + actions.ts    # 列表/新建/加入/审批/权限
│  ├─ projects/[id]/bible/…             # 故事圣经页 + 保存/锁定
│  └─ api/ai/chat/route.ts              # 后端 AI 路由（接 DeepSeek）
└─ components/                          # TopBar / ProjectBoard / BibleWorkspace
```

## 五、下一步（M2+）
剧本工作台（版本/上传/AI 续写，写入 `scripts/script_versions`）、资产库接生图（image2/nanobanana，写入 `assets/generations`）、分镜与逐镜头（`scenes/shots/subshots`）、管理员后台（whitelist/Key/额度）、AI 对话落库（`ai_conversations/ai_messages`）。

> 安全：DeepSeek key 只在服务端用；RLS 已做项目级隔离。
