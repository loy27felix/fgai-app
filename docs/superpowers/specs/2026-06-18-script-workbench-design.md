# ② 剧本工作台 · 设计 (Design Spec)

> 日期：2026-06-18 ｜ 阶段：PRD 八阶段之 ②（M2）｜ 依赖：仅 DeepSeek（已接好）

## 目标 / 范围

本轮做「核心闭环」：集/场 CRUD + 剧本编辑器 + AI 对话生成/续写（注入故事圣经记忆）+
版本保存/对比/回滚 + 手动上传。外加八阶段导航条接入。

**明确不做（占位）**：25 宫格剧本体检（卡生图 Key）、剧本医生评分（本轮先放占位按钮）。

## 现状基础（已就绪，不需改）

- 数据库 `fgai` 已建表：`projects → episodes(idx,title) → scenes(idx,title,setting) →
  scripts(body,source,current_version,updated_at)` + `script_versions(version,body,author,source,created_at)`。
- RLS：四张表均 `is_member(project_id)` 放行读写，链路上溯到项目成员——无鸡生蛋问题，**不需要新迁移/触发器**。
- 已有模式可复刻：bible 页（服务端加载 + Server Action 写库）、`/api/ai/chat`（DeepSeek，带记忆）、
  `BibleWorkspace`（左字段 + 右 AI dock）、设计 token（`.pill/.card/.chip/.input/.label`、`font-disp/font-mono`、配色）。
- viewer 只读在应用层用 `canEdit = role==='owner'||'editor'` 卡（沿用 bible 做法）。

## 文件清单

| 文件 | 作用 |
|---|---|
| `lib/types.ts` | 加 `Episode/Scene/Script/ScriptVersion` 类型 + `STAGES` 八阶段常量 |
| `components/StageNav.tsx` | 共享八阶段步骤条，01→bible 02→script，03-08 灰显 toast |
| `app/projects/[id]/script/actions.ts` | Server Actions：集/场 CRUD、按需建 script、保存版本、回滚 |
| `app/projects/[id]/script/page.tsx` | 服务端：鉴权 + 加载树/正文/版本，传给 ScriptWorkspace |
| `components/ScriptWorkspace.tsx` | 客户端：左集场树 ｜ 中编辑器+版本 ｜ 右 AI dock |
| `app/projects/[id]/bible/page.tsx` | 接入 StageNav（小改） |

## 数据流

1. **集/场树**：左栏列 `episodes`（含其 `scenes`）。`idx` = 同级 max+1。选中一个 scene。
2. **按需建 script**：选中 scene 若无 `scripts` 行，编辑器显示空白；首次保存时若无行则 insert。
3. **保存版本**：`update scripts.body, current_version+1, updated_at` ＋ `insert script_versions(version=新号, body, author, source)`。历史只增不删。
4. **版本对比**：版本面板列出 `script_versions`（倒序）。选一个 → 与当前正文并排只读对比（本轮先做并排文本对照，不做行级 diff）。
5. **回滚**：「回滚到 vN」= 把 vN 的 body 写回当前正文并**新增**一条版本（source='rollback'），不销毁历史。
6. **手动上传**：前端 `FileReader` 读 `.txt` 灌进编辑器，标 `source='upload'`，再走正常保存。

## AI 续写（复用 `/api/ai/chat`）

system prompt 拼接：
- 故事圣经记忆（复刻 `BibleWorkspace.memorySystemPrompt`）
- 当前场上下文：集名 / 场名 / setting / 现有正文
- 短剧格式规范：`场号　日／内　地点`；`△ 动作走位环境（不写心理）`；`角色（语气）：对白`

交互：「✦ 续写本场」「自由对话」「✓ 一键写入编辑器」。写入后由用户保存为新版本。

## 边界 / 降级

- 空状态：无集/场 → 引导「+ 新建第 1 集」。
- 占位：25 宫格体检、剧本医生 → 禁用感按钮 + toast「需生图 Key / 即将上线」。
- viewer：编辑器/保存/AI 写入/CRUD 全禁用。
- AI 出错：在对话流回显 `⚠️ 错误信息`（同 bible）。

## 验收

- `npm run build` 通过；可新建集/场、编辑保存出版本、对比、回滚、上传 txt、AI 续写并写入；
  viewer 全只读；bible 与 script 页都能用导航条互跳。
