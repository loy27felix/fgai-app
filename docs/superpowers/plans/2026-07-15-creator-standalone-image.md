# FG Studio 独立生图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不创建导演项目的前提下，为每个登录用户提供可恢复、需二次确认、最多八张参考图、每次生成一张的私人独立生图闭环。

**Architecture:** 新增 `/creator/image` 页面和专用 `/api/creator/images` 任务接口，保留现有导演项目 `/api/ai/image` 契约不变。浏览器把参考图直接上传到私有 `creator-assets`，服务端用条件更新认领草稿、先写 `submitted` 可信账本再调用共享 Wetoken 图片生成器，最后把结果写入私人资产与任务历史。

**Tech Stack:** Next.js 14 App Router、React 18、TypeScript 5.5、Supabase Auth/Postgres/Storage、Wetoken 图片 API、Node `tsx --test`。

## Global Constraints

- 每次任务只生成一张图片，首版不支持批量生成。
- 最多八张 JPEG、PNG 或 WebP 参考图；单张不超过 7 MB，总计不超过 28 MB。
- 第九张参考图必须在客户端和服务端同时拒绝。
- `draft` 不得调用 Wetoken，也不得写用量账本。
- 只有明确二次确认后才可调用 Wetoken。
- 调用 Wetoken 前必须先写 `submitted` 用量记录；写入失败时不得调用模型。
- 未知 Wetoken 单价不得显示为零美元或伪造估算值，`cost_source` 保持 `unknown`。
- 参考图和结果只存私有 `creator-assets`，不得把 Base64 正文持久化到任务、历史或 URL。
- 保持现有 FG Studio 视觉语言，不重做导演台，不改变现有 `/api/ai/image` 请求与响应。
- 画布生图不在本计划范围内，但后续必须复用本计划的任务、资产、确认和账本接口。
- 每个任务完成后运行对应测试并提交；最终推送 GitHub main 并验证 Vercel Production Ready。

---

## File Structure

### New files

- `lib/creator/image.ts`：独立生图输入校验、上传路径规划、任务视图类型与终态判断。
- `lib/creator/image-service.ts`：确认状态机、账本前置、Wetoken 调用和结果持久化编排。
- `lib/creator/image-client.ts`：浏览器端草稿、上传完成、确认、历史与删除 API 客户端。
- `app/api/creator/images/route.ts`：任务列表和草稿创建。
- `app/api/creator/images/[id]/route.ts`：参考图完成绑定与任务删除。
- `app/api/creator/images/[id]/confirm/route.ts`：明确确认并调用图片服务。
- `app/creator/image/page.tsx`：独立生图服务端登录入口。
- `components/creator/CreatorImageWorkspace.tsx`：独立生图三栏界面和确认交互。
- `tests/creator/image-domain.test.ts`：八图限制、文件校验与路径归属测试。
- `tests/creator/image-service.test.ts`：未确认不调用、重复确认、账本前置和状态恢复测试。
- `tests/creator/image-api-contract.test.ts`：Creator 图片路由的权限与持久化契约测试。
- `tests/creator/image-ui-contract.test.ts`：入口、确认文案、历史和操作按钮契约测试。

### Modified files

- `lib/ai/image.ts`：共享生成器参考图上限从四张提高到八张。
- `lib/imageModels.ts`：增加每个模型的 `maxReferences` 能力字段。
- `lib/creator/types.ts`：增加图片任务、资产和页面视图类型。
- `lib/usage/ledger.ts`：增加图片调用提交记录及状态更新函数。
- `components/creator/CreatorWorkspace.tsx`：启用「独立生图」入口，链接到 `/creator/image`。
- `tests/ai/image.test.ts`：验证八张参考图可进入共享生成器、第九张被拒绝。
- `tests/usage/ledger.test.ts`：验证 Creator 图片 `submitted` 记录与状态更新。

---

### Task 1: 图片模型能力与八张参考图校验

**Files:**
- Modify: `lib/imageModels.ts`
- Modify: `lib/ai/image.ts`
- Create: `lib/creator/image.ts`
- Create: `tests/creator/image-domain.test.ts`
- Modify: `tests/ai/image.test.ts`

**Interfaces:**
- Consumes: 现有 `IMG_MODELS`、`getImageModel(model)`、`sizeFor(model, ratio)`、`generateWetokenImage(input)`。
- Produces: `MAX_CREATOR_IMAGE_REFERENCES`、`validateImageDraftInput(input)`、`composeImageGenerationPrompt(prompt, skill)`、`referencePathFor(userId, taskId, index, mimeType)`、`ImageDraftInput`、模型字段 `maxReferences`。

- [ ] **Step 1: 写输入边界失败测试**

```ts
// tests/creator/image-domain.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { composeImageGenerationPrompt, validateImageDraftInput } from '../../lib/creator/image';

const file = (index: number) => ({ name: `ref-${index}.png`, mimeType: 'image/png', size: 1024 });

test('accepts eight references and rejects the ninth', () => {
  assert.equal(validateImageDraftInput({
    prompt: 'cinematic fox', model: 'gpt-image-2', ratio: '16:9', references: Array.from({ length: 8 }, (_, i) => file(i)),
  }).references.length, 8);
  assert.throws(() => validateImageDraftInput({
    prompt: 'cinematic fox', model: 'gpt-image-2', ratio: '16:9', references: Array.from({ length: 9 }, (_, i) => file(i)),
  }), /最多 8 张参考图/);
});

test('rejects unsupported types and oversized totals', () => {
  assert.throws(() => validateImageDraftInput({
    prompt: 'x', model: 'gpt-image-2', ratio: '1:1', references: [{ name: 'x.gif', mimeType: 'image/gif', size: 10 }],
  }), /JPEG、PNG 或 WebP/);
  assert.throws(() => validateImageDraftInput({
    prompt: 'x', model: 'gpt-image-2', ratio: '1:1', references: Array.from({ length: 5 }, (_, i) => ({ ...file(i), size: 7_000_000 })),
  }), /总大小不能超过 28MB/);
});

test('skill instructions are snapshotted into the effective image prompt', () => {
  const result = composeImageGenerationPrompt('a fox in snow', { name: '电影感', content: 'Use anamorphic composition and cold rim light.' });
  assert.match(result, /电影感/);
  assert.match(result, /anamorphic composition/);
  assert.match(result, /a fox in snow/);
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `npx tsx --test tests/creator/image-domain.test.ts`  
Expected: FAIL，提示找不到 `lib/creator/image`。

- [ ] **Step 3: 实现模型能力与公共校验**

```ts
// lib/creator/image.ts
import { getImageModel, sizeFor } from '@/lib/imageModels';

export const MAX_CREATOR_IMAGE_REFERENCES = 8;
export const MAX_CREATOR_IMAGE_FILE_BYTES = 7_000_000;
export const MAX_CREATOR_IMAGE_TOTAL_BYTES = 28_000_000;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type ImageReferenceManifest = { name: string; mimeType: string; size: number };
export type CreatorImageSkill = { name: string; content: string };
export type ImageDraftInput = { prompt: string; model: string; ratio: string; references: ImageReferenceManifest[]; skill?: CreatorImageSkill | null };

export function composeImageGenerationPrompt(prompt: string, skill?: CreatorImageSkill | null) {
  if (!skill) return prompt;
  return `Apply the image-creation Skill "${skill.name}" below.\n\n${skill.content}\n\nUser image request:\n${prompt}`;
}

export function validateImageDraftInput(input: ImageDraftInput) {
  const prompt = input.prompt.trim();
  const skillName = typeof input.skill?.name === 'string' ? input.skill.name.trim().slice(0, 80) : '';
  const skillContent = typeof input.skill?.content === 'string' ? input.skill.content.trim().slice(0, 30_000) : '';
  const skill = skillName && skillContent ? { name: skillName, content: skillContent } : null;
  const effectivePrompt = composeImageGenerationPrompt(prompt, skill);
  const model = getImageModel(input.model);
  if (!prompt) throw new Error('提示词不能为空');
  if (!model) throw new Error('不支持的图片模型');
  if (input.references.length > Math.min(MAX_CREATOR_IMAGE_REFERENCES, model.maxReferences)) throw new Error('最多 8 张参考图');
  let total = 0;
  for (const reference of input.references) {
    if (!ALLOWED_IMAGE_TYPES.has(reference.mimeType)) throw new Error('参考图仅支持 JPEG、PNG 或 WebP');
    if (!Number.isSafeInteger(reference.size) || reference.size <= 0 || reference.size > MAX_CREATOR_IMAGE_FILE_BYTES) throw new Error('单张参考图不能超过 7MB');
    total += reference.size;
  }
  if (total > MAX_CREATOR_IMAGE_TOTAL_BYTES) throw new Error('参考图总大小不能超过 28MB');
  return { prompt, effectivePrompt, skill, model: model.id, ratio: input.ratio, size: sizeFor(model.id, input.ratio), references: input.references };
}

export function referencePathFor(userId: string, taskId: string, index: number, mimeType: string) {
  const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
  return `${userId}/image-tasks/${taskId}/references/${String(index + 1).padStart(2, '0')}.${ext}`;
}
```

在 `ImageModelSpec` 增加 `maxReferences: number`，四个模型首版均为 `8`；在 `generateWetokenImage` 把 `> 4` 改为 `> 8`。

- [ ] **Step 4: 增加共享生成器第八/第九张测试并运行 GREEN**

```ts
// tests/ai/image.test.ts
test('shared image generator accepts eight references and rejects the ninth', async () => {
  process.env.WETOKEN_API_KEY = 'test-key';
  const reference = { data: 'YWJj', mimeType: 'image/png' };
  const fetcher = async () => new Response(JSON.stringify({ data: [{ b64_json: 'YWJj' }] }), { status: 200 });
  await generateWetokenImage({ model: 'gpt-image-2', prompt: 'x', size: '1024x1024', references: Array(8).fill(reference) }, { fetcher });
  await assert.rejects(() => generateWetokenImage({ model: 'gpt-image-2', prompt: 'x', size: '1024x1024', references: Array(9).fill(reference) }, { fetcher }), /最多 8 张/);
});
```

Run: `npx tsx --test tests/creator/image-domain.test.ts tests/ai/image.test.ts`  
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add lib/imageModels.ts lib/ai/image.ts lib/creator/image.ts tests/creator/image-domain.test.ts tests/ai/image.test.ts
git commit -m "feat(creator): validate standalone image drafts"
```

---

### Task 2: Creator 图片任务与页面视图类型

**Files:**
- Modify: `lib/creator/types.ts`
- Modify: `lib/creator/image.ts`
- Modify: `tests/creator/image-domain.test.ts`

**Interfaces:**
- Consumes: `CreatorTaskStatus`、`ImageDraftInput`。
- Produces: `CreatorImageTask`、`CreatorImageAsset`、`CreatorImageTaskView`、`isCreatorImageTerminal(status)`、`assertOwnedReferencePath(path, userId, taskId)`。

- [ ] **Step 1: 写路径归属和终态失败测试**

```ts
import { assertOwnedReferencePath, isCreatorImageTerminal } from '../../lib/creator/image';

test('reference paths are task and user scoped', () => {
  assert.doesNotThrow(() => assertOwnedReferencePath('u1/image-tasks/t1/references/01.png', 'u1', 't1'));
  assert.throws(() => assertOwnedReferencePath('u2/image-tasks/t1/references/01.png', 'u1', 't1'), /不属于当前任务/);
});

test('only settled statuses are terminal', () => {
  assert.equal(isCreatorImageTerminal('succeeded'), true);
  assert.equal(isCreatorImageTerminal('failed'), true);
  assert.equal(isCreatorImageTerminal('expired'), true);
  assert.equal(isCreatorImageTerminal('draft'), false);
  assert.equal(isCreatorImageTerminal('submitting'), false);
  assert.equal(isCreatorImageTerminal('unknown'), false);
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `npx tsx --test tests/creator/image-domain.test.ts`  
Expected: FAIL，缺少两个导出。

- [ ] **Step 3: 实现任务、资产和安全路径接口**

```ts
// lib/creator/types.ts
export type CreatorImageTask = {
  id: string; workspace_id: string; user_id: string; kind: 'image'; provider: 'wetoken'; model: string;
  status: CreatorTaskStatus; idempotency_key: string; request: Record<string, unknown>; output: Record<string, unknown>;
  error: string | null; confirmed_at: string | null; created_at: string; updated_at: string; completed_at: string | null;
};

export type CreatorImageAsset = {
  id: string; workspace_id: string; kind: 'image'; source: 'generation'; name: string; storage_path: string;
  mime_type: string | null; width: number | null; height: number | null; metadata: Record<string, unknown>; created_at: string;
};

export type CreatorImageTaskView = CreatorImageTask & { asset: CreatorImageAsset | null; resultUrl: string | null; referenceUrls: string[] };
```

```ts
// lib/creator/image.ts
import type { CreatorTaskStatus } from './types';

export function assertOwnedReferencePath(path: string, userId: string, taskId: string) {
  if (!path.startsWith(`${userId}/image-tasks/${taskId}/references/`)) throw new Error('参考图不属于当前任务');
}

export function isCreatorImageTerminal(status: CreatorTaskStatus) {
  return status === 'succeeded' || status === 'failed' || status === 'expired';
}
```

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `npx tsx --test tests/creator/image-domain.test.ts`  
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add lib/creator/types.ts lib/creator/image.ts tests/creator/image-domain.test.ts
git commit -m "feat(creator): define standalone image task views"
```

---

### Task 3: 图片调用的可信账本生命周期

**Files:**
- Modify: `lib/usage/ledger.ts`
- Modify: `tests/usage/ledger.test.ts`

**Interfaces:**
- Consumes: 现有 `createAdminClient()`、`ai_usage_ledger` 的 `submitted|succeeded|failed|unknown` 状态。
- Produces: `buildCreatorImageLedgerEntry(input): ImageLedgerEntry`、`recordUsageRequired(row, dependency?)`、`updateImageUsageStatus(input, dependency?)`。

- [ ] **Step 1: 写提交账本和失败前置测试**

```ts
// tests/usage/ledger.test.ts
import { buildCreatorImageLedgerEntry, recordUsageRequired, updateImageUsageStatus } from '../../lib/usage/ledger';

test('creator image attempts start submitted and link the task', () => {
  const row = buildCreatorImageLedgerEntry({ requestId: 'req-image', userId: 'u1', workspaceId: 'w1', creatorTaskId: 't1', model: 'gpt-image-2', resolution: '1536x864' });
  assert.equal(row.creator_task_id, 't1');
  assert.equal(row.status, 'submitted');
  assert.equal(row.possibly_charged, true);
  assert.equal(row.image_count, 1);
});

test('required usage writer throws before provider work when persistence fails', async () => {
  await assert.rejects(() => recordUsageRequired(buildCreatorImageLedgerEntry({ requestId: 'r', userId: 'u', workspaceId: 'w', creatorTaskId: 't', model: 'gpt-image-2', resolution: '1024x1024' }), { upsert: async () => ({ error: new Error('down') }) }), /用量记录写入失败/);
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `npx tsx --test tests/usage/ledger.test.ts`  
Expected: FAIL，缺少 Creator 图片账本导出。

- [ ] **Step 3: 实现严格写入和状态更新**

```ts
export function buildCreatorImageLedgerEntry(input: {
  requestId: string; userId: string; workspaceId: string; creatorTaskId: string; model: string; resolution: string;
}): ImageLedgerEntry {
  return {
    request_id: input.requestId, user_id: input.userId, workspace_id: input.workspaceId, project_id: null,
    creator_task_id: input.creatorTaskId, kind: 'image', provider: 'wetoken', model: input.model,
    image_count: 1, resolution: input.resolution, cost_source: 'unknown', price_snapshot: {},
    status: 'submitted', possibly_charged: true,
  };
}

export async function recordUsageRequired(row: ImageLedgerEntry, dependency?: LedgerWriter) {
  const saved = dependency ? await dependency.upsert(row) : await createAdminClient().from('ai_usage_ledger').upsert(row, { onConflict: 'request_id' });
  if (saved && typeof saved === 'object' && 'error' in saved && saved.error) throw new Error('用量记录写入失败');
}

export async function updateImageUsageStatus(input: { requestId: string; status: UsageLedgerStatus; completedAt?: string | null }, dependency?: { update(values: object, requestId: string): Promise<unknown> }) {
  const values = { status: input.status, completed_at: input.completedAt ?? null };
  const result = dependency ? await dependency.update(values, input.requestId) : await createAdminClient().from('ai_usage_ledger').update(values).eq('request_id', input.requestId);
  return !(result && typeof result === 'object' && 'error' in result && result.error);
}
```

同时把 `ImageLedgerEntry.creator_task_id` 从固定 `null` 改为 `string | null`，`status` 改为四种账本状态联合类型；旧导演项目 `buildImageLedgerEntry()` 继续返回 `creator_task_id: null` 和 `succeeded`。

- [ ] **Step 4: 运行用量测试确认 GREEN**

Run: `npx tsx --test tests/usage/*.test.ts`  
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add lib/usage/ledger.ts tests/usage/ledger.test.ts
git commit -m "feat(usage): track submitted creator image calls"
```

---

### Task 4: 草稿、上传完成、历史和删除 API

**Files:**
- Create: `app/api/creator/images/route.ts`
- Create: `app/api/creator/images/[id]/route.ts`
- Create: `tests/creator/image-api-contract.test.ts`

**Interfaces:**
- Consumes: `ensureCreatorWorkspace()`、`validateImageDraftInput()`、`referencePathFor()`、Creator 表和私有 Storage。
- Produces: `GET /api/creator/images`、`POST /api/creator/images`、`PATCH /api/creator/images/:id`、`DELETE /api/creator/images/:id`。

- [ ] **Step 1: 写 API 权限和行为契约失败测试**

```ts
// tests/creator/image-api-contract.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const collection = fs.readFileSync(path.join(process.cwd(), 'app/api/creator/images/route.ts'), 'utf8');
const item = fs.readFileSync(path.join(process.cwd(), 'app/api/creator/images/[id]/route.ts'), 'utf8');

test('creator image routes scope tasks to the private workspace', () => {
  assert.match(collection, /export async function GET/);
  assert.match(collection, /export async function POST/);
  assert.match(collection, /workspace_id/);
  assert.match(collection, /idempotency_key/);
  assert.match(item, /export async function PATCH/);
  assert.match(item, /export async function DELETE/);
  assert.match(item, /image-tasks/);
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `npx tsx --test tests/creator/image-api-contract.test.ts`  
Expected: FAIL，路由文件不存在。

- [ ] **Step 3: 实现草稿创建和上传路径规划**

`POST /api/creator/images` 请求：

```ts
type CreateDraftBody = { prompt?: string; model?: string; ratio?: string; idempotencyKey?: string; references?: ImageReferenceManifest[] };
```

核心写入必须为：

```ts
const input = validateImageDraftInput({ prompt: body.prompt || '', model: body.model || 'gpt-image-2', ratio: body.ratio || '1:1', references: body.references || [] });
const { data: task, error } = await supabase.from('creator_generation_tasks').upsert({
  workspace_id: workspace.id, user_id: user.id, kind: 'image', provider: 'wetoken', model: input.model,
  idempotency_key: body.idempotencyKey, status: 'draft',
  request: { prompt: input.prompt, effective_prompt: input.effectivePrompt, skill: input.skill, ratio: input.ratio, size: input.size, reference_manifest: input.references, reference_paths: [], uploads_complete: input.references.length === 0 },
}, { onConflict: 'idempotency_key', ignoreDuplicates: true }).select('*').maybeSingle();
```

如果幂等键已存在，按 `user_id + workspace_id + idempotency_key` 读取原任务。响应包含任务以及使用 `referencePathFor()` 生成的 `uploadPaths`。

- [ ] **Step 4: 实现上传完成、列表和删除**

`PATCH /api/creator/images/:id` 只接受 `referencePaths: string[]`，逐个验证路径前缀、数量和 Storage 对象存在后设置 `uploads_complete: true`。  
`GET` 返回当前 workspace 最近 100 个 `kind=image` 任务，读取 `output.asset_id` 对应资产，并为结果与参考图创建短期 signed URL。  
`DELETE` 仅删除当前用户任务；先删除结果文件和 `${user.id}/image-tasks/${task.id}` 下的参考图，再删 `creator_assets` 和任务。账本通过外键 `on delete set null` 保留。

```ts
const owned = await supabase.from('creator_generation_tasks').select('*').eq('id', id).eq('workspace_id', workspace.id).eq('user_id', user.id).eq('kind', 'image').maybeSingle();
if (!owned.data) return NextResponse.json({ error: '图片任务不存在' }, { status: 404 });
```

- [ ] **Step 5: 运行契约和基础安全测试**

Run: `npx tsx --test tests/creator/image-api-contract.test.ts tests/creator/foundation-schema.test.ts tests/creator/security-hardening.test.ts`  
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add app/api/creator/images/route.ts app/api/creator/images/[id]/route.ts tests/creator/image-api-contract.test.ts
git commit -m "feat(creator): add standalone image draft APIs"
```

---

### Task 5: 确认状态机与真实 Wetoken 调用

**Files:**
- Create: `lib/creator/image-service.ts`
- Create: `app/api/creator/images/[id]/confirm/route.ts`
- Create: `tests/creator/image-service.test.ts`
- Modify: `tests/creator/image-api-contract.test.ts`

**Interfaces:**
- Consumes: `generateWetokenImage()`、`buildCreatorImageLedgerEntry()`、`recordUsageRequired()`、`updateImageUsageStatus()`。
- Produces: `confirmCreatorImage(input, deps): Promise<ConfirmImageResult>`、`POST /api/creator/images/:id/confirm`。

- [ ] **Step 1: 写状态机 tracer-bullet 失败测试**

```ts
// tests/creator/image-service.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmCreatorImage } from '../../lib/creator/image-service';

test('a claimed draft records usage before one provider call', async () => {
  const events: string[] = [];
  const result = await confirmCreatorImage({ taskId: 't1', userId: 'u1', workspaceId: 'w1' }, {
    claimDraft: async () => ({ id: 't1', model: 'gpt-image-2', request: { prompt: 'fox', size: '1024x1024', reference_paths: [], uploads_complete: true } }),
    recordAttempt: async () => { events.push('ledger'); },
    loadReferences: async () => [],
    generate: async () => { events.push('provider'); return { bytes: new Uint8Array([1]), mimeType: 'image/png' }; },
    persistSuccess: async () => ({ assetId: 'a1', resultUrl: 'signed' }),
    settleFailure: async () => undefined,
  });
  assert.deepEqual(events, ['ledger', 'provider']);
  assert.equal(result.assetId, 'a1');
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `npx tsx --test tests/creator/image-service.test.ts`  
Expected: FAIL，缺少图片确认服务。

- [ ] **Step 3: 实现深模块状态机**

```ts
export async function confirmCreatorImage(input: ConfirmImageInput, deps: ConfirmImageDependencies) {
  const task = await deps.claimDraft(input);
  if (!task) return { duplicate: true as const };
  if (task.request.uploads_complete !== true) throw new Error('参考图尚未上传完成');
  const requestId = `creator-image:${task.id}`;
  try {
    await deps.recordAttempt({ requestId, task });
  } catch (error) {
    await deps.settleFailure({ task, status: 'draft', error: '用量记录写入失败' });
    throw error;
  }
  try {
    const references = await deps.loadReferences(task.request.reference_paths as string[]);
    const generated = await deps.generate({ model: task.model, prompt: String(task.request.effective_prompt), size: String(task.request.size), references });
    return await deps.persistSuccess({ task, requestId, generated });
  } catch (error) {
    const unknown = error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError');
    await deps.settleFailure({ task, requestId, status: unknown ? 'unknown' : 'failed', error: error instanceof Error ? error.message : '图片生成失败' });
    throw error;
  }
}
```

`claimDraft` 必须使用 `.eq('status', 'draft').select('*').maybeSingle()` 条件更新，只有返回行的请求取得调用权。`persistSuccess` 把结果上传到 `${userId}/image-tasks/${taskId}/result.<ext>`，创建 `creator_assets`，再更新任务 `output.asset_id` 和账本 `succeeded`。

- [ ] **Step 4: 增加重复确认和账本故障测试**

```ts
test('duplicate confirmation never reaches ledger or provider', async () => {
  let calls = 0;
  const result = await confirmCreatorImage({ taskId: 't', userId: 'u', workspaceId: 'w' }, {
    claimDraft: async () => null,
    recordAttempt: async () => { calls += 1; }, loadReferences: async () => [], generate: async () => { calls += 1; throw new Error('unreachable'); },
    persistSuccess: async () => { throw new Error('unreachable'); }, settleFailure: async () => undefined,
  });
  assert.equal(result.duplicate, true);
  assert.equal(calls, 0);
});
```

- [ ] **Step 5: 实现确认路由并验证契约**

`POST /api/creator/images/:id/confirm` 获取登录用户与私人 workspace，把 Supabase、Storage、共享生成器和账本适配为 `confirmCreatorImage()` 的 dependencies。成功返回 `{ task, asset, resultUrl }`；重复确认返回当前任务状态；超时返回 504 并保留 `unknown`。

Run: `npx tsx --test tests/creator/image-service.test.ts tests/creator/image-api-contract.test.ts tests/usage/ledger.test.ts tests/ai/image.test.ts`  
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add lib/creator/image-service.ts app/api/creator/images/[id]/confirm/route.ts tests/creator/image-service.test.ts tests/creator/image-api-contract.test.ts
git commit -m "feat(creator): confirm standalone image tasks safely"
```

---

### Task 6: 浏览器客户端与独立生图页面

**Files:**
- Create: `lib/creator/image-client.ts`
- Create: `app/creator/image/page.tsx`
- Create: `components/creator/CreatorImageWorkspace.tsx`
- Modify: `components/creator/CreatorWorkspace.tsx`
- Create: `tests/creator/image-ui-contract.test.ts`

**Interfaces:**
- Consumes: Task 4/5 API、`createClient()` 浏览器 Supabase、`IMG_MODELS`、`RATIOS`、`SkillPicker`、`PromptPicker`。
- Produces: `/creator/image` 页面、`createImageDraft()`、`finalizeImageUploads()`、`confirmImageTask()`、`listImageTasks()`、`deleteImageTask()`。

- [ ] **Step 1: 写 UI 契约失败测试**

```ts
// tests/creator/image-ui-contract.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ui = fs.readFileSync(path.join(process.cwd(), 'components/creator/CreatorImageWorkspace.tsx'), 'utf8');
const chat = fs.readFileSync(path.join(process.cwd(), 'components/creator/CreatorWorkspace.tsx'), 'utf8');

test('creator exposes standalone image mode with explicit confirmation', () => {
  assert.match(chat, /href="\/creator\/image"/);
  assert.match(ui, /生成 1 张/);
  assert.match(ui, /确认并生成/);
  assert.match(ui, /实际费用以 Wetoken 账单为准/);
  assert.match(ui, /最多 8 张/);
  assert.match(ui, /下载原图/);
  assert.match(ui, /复用参数/);
  assert.match(ui, /删除结果/);
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `npx tsx --test tests/creator/image-ui-contract.test.ts`  
Expected: FAIL，页面组件不存在。

- [ ] **Step 3: 实现浏览器 API 客户端**

```ts
export async function createImageDraft(payload: CreateImageDraftPayload) {
  return requestJson('/api/creator/images', { method: 'POST', body: JSON.stringify(payload) });
}
export async function finalizeImageUploads(taskId: string, referencePaths: string[]) {
  return requestJson(`/api/creator/images/${taskId}`, { method: 'PATCH', body: JSON.stringify({ referencePaths }) });
}
export async function confirmImageTask(taskId: string) {
  return requestJson(`/api/creator/images/${taskId}/confirm`, { method: 'POST' });
}
```

`requestJson()` 必须统一解析 `{ error }` 并在非 2xx 时抛出带服务端消息的 `Error`。

- [ ] **Step 4: 实现草稿上传与确认交互**

`CreatorImageWorkspace` 的 `prepareDraft()` 顺序必须为：校验本地文件 → `createImageDraft()` → 浏览器 Supabase 上传到服务端返回的 `uploadPaths` → `finalizeImageUploads()` → 打开确认卡。任何一步失败都不得调用确认接口。

```ts
const draft = await createImageDraft({ prompt, model, ratio, skill: activeSkill, idempotencyKey: crypto.randomUUID(), references: files.map(toManifest) });
for (let index = 0; index < files.length; index += 1) {
  const upload = await supabase.storage.from('creator-assets').upload(draft.uploadPaths[index], files[index], { upsert: false, contentType: files[index].type });
  if (upload.error) throw upload.error;
}
const ready = await finalizeImageUploads(draft.task.id, draft.uploadPaths);
setConfirmTarget(ready.task);
```

- [ ] **Step 5: 实现三栏界面与历史操作**

- 左栏：链接式「对话 / 独立生图 / 视频画布」，独立生图激活；任务历史可选择。
- 中栏：空状态、生成状态、大图结果和错误状态；结果按钮为下载、复制提示词、复用参数、删除结果。
- 右栏：模型、比例、八图拖动排序/删除、Skill、Prompt、提示词和「生成 1 张」。
- 确认卡必须显示模型、实际尺寸、参考图数量、调用一次及费用未知提示。
- 删除对话框说明任务、结果和参考图会永久删除，但历史费用不会删除。
- `submitting` 与 `unknown` 页面刷新后只读取状态，不自动调用确认接口。

`app/creator/image/page.tsx` 只负责登录保护和渲染 `<CreatorImageWorkspace userEmail={...} />`。聊天页导航把禁用的独立生图按钮改成 `<a href="/creator/image">`，其他聊天布局不变。

- [ ] **Step 6: 运行 UI 与 Creator 测试**

Run: `npx tsx --test tests/creator/*.test.ts`  
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add lib/creator/image-client.ts app/creator/image/page.tsx components/creator/CreatorImageWorkspace.tsx components/creator/CreatorWorkspace.tsx tests/creator/image-ui-contract.test.ts
git commit -m "feat(creator): add standalone image workspace"
```

---

### Task 7: 恢复、删除和响应式交互验收

**Files:**
- Modify: `components/creator/CreatorImageWorkspace.tsx`
- Modify: `lib/creator/image-client.ts`
- Modify: `tests/creator/image-ui-contract.test.ts`
- Modify: `tests/creator/image-service.test.ts`

**Interfaces:**
- Consumes: `CreatorImageTaskView`、任务 GET/DELETE API。
- Produces: 页面加载恢复、任务选择、移动端参数抽屉、删除后选择下一个任务。

- [ ] **Step 1: 增加刷新不重发和删除账本保留测试**

```ts
test('non-terminal history is read-only until the user confirms again', () => {
  assert.match(ui, /listImageTasks/);
  assert.doesNotMatch(ui, /useEffect\([\s\S]*confirmImageTask/);
});

test('delete contract keeps usage ledger untouched', () => {
  const itemRoute = fs.readFileSync(path.join(process.cwd(), 'app/api/creator/images/[id]/route.ts'), 'utf8');
  assert.doesNotMatch(itemRoute, /from\(['"]ai_usage_ledger['"]\)\.delete/);
});
```

- [ ] **Step 2: 运行测试确认 RED 或暴露缺口**

Run: `npx tsx --test tests/creator/image-ui-contract.test.ts tests/creator/image-service.test.ts`  
Expected: 至少一个新断言 FAIL，直到恢复与删除契约完整。

- [ ] **Step 3: 完成恢复和窄屏行为**

- 初次加载调用 `listImageTasks()`，选中 URL `?task=` 指定任务或第一条历史。
- 删除当前任务后选择下一条；没有历史时回到空状态并清除 `task` 查询参数。
- CSS 使用现有变量；宽度小于 900px 时右栏为可打开的底部抽屉，中栏保持可滚动。
- 生成中关闭页面不触发 `beforeunload` 阻止；重新进入后只显示已持久化状态。

- [ ] **Step 4: 运行测试和 TypeScript 检查**

Run: `npx tsx --test tests/creator/*.test.ts tests/usage/*.test.ts tests/ai/image.test.ts`  
Expected: PASS。  
Run: `npx tsc --noEmit`  
Expected: exit 0。

- [ ] **Step 5: 提交**

```bash
git add components/creator/CreatorImageWorkspace.tsx lib/creator/image-client.ts tests/creator/image-ui-contract.test.ts tests/creator/image-service.test.ts
git commit -m "fix(creator): restore standalone image task history"
```

---

### Task 8: 全量验证、真实模型受控检查与发布

**Files:**
- No planned file changes; if verification exposes a defect, modify only the exact production and test file from Tasks 1-7 that owns that behavior.

**Interfaces:**
- Consumes: 完整独立生图功能。
- Produces: GitHub main 提交、Vercel Production Ready、生产 HTTP 与登录后流程证据。

- [ ] **Step 1: 运行全量自动验证**

Run: `npm test`  
Expected: 所有测试 PASS。  
Run: `npx tsc --noEmit`  
Expected: exit 0。  
Run: `npm run build`  
Expected: Next.js production build exit 0，路由清单包含 `/creator/image`、`/api/creator/images` 和确认路由。

- [ ] **Step 2: 本地登录后无费用交互检查**

- 打开 `/creator/image`。
- 选择零张与八张参考图，确认第九张被前端阻止。
- 点击「生成 1 张」后确认卡出现，先取消；在 Supabase/管理后台确认没有新增图片用量记录。
- 刷新页面，确认草稿存在且没有自动生成。

- [ ] **Step 3: 受控真实调用检查**

在用户明确同意消耗一次额度后，仅用 `gpt-image-2`、零参考图生成一张 1:1 测试图：

- 确认前无调用。
- 确认后只出现一条 `submitted → succeeded` 用量记录。
- 历史、下载、复制提示词、复用参数和删除可用。
- 删除后任务、资产与 Storage 文件消失，费用记录仍保留。

八张参考图的四模型检查属于模型兼容性验收，会产生真实费用；必须单独获得用户授权后执行，不得在普通自动测试中调用。

- [ ] **Step 4: 推送并验证 Vercel**

```bash
git status --short
git push origin main
npx vercel ls fgai-app
npx vercel inspect https://fgai-app.vercel.app
curl.exe -sS -o NUL -w "%{http_code} %{redirect_url}\n" https://fgai-app.vercel.app/creator/image
```

Expected: worktree clean；GitHub main 更新；最新部署 `Ready / Production`；未登录 `/creator/image` 返回 307 并跳转 `/login`。

- [ ] **Step 5: 记录交付结果**

最终回复包含：功能范围、参考图上限、确认与账本保障、测试数量、提交 SHA、Vercel 状态、生产链接，以及未执行的真实付费兼容性检查（如果用户未授权）。

---

## Plan Self-Review

- Spec coverage: 独立入口、一次一张、八张参考图、四模型、Skill 快照与有效提示词、Prompt 插入、草稿确认、私人 Storage、任务历史、恢复、下载/复制/复用/删除、账本、安全和发布均有对应任务。
- Scope boundary: 画布生图、独立视频、视频画布、发送到导演项目和批量出图均未混入实现任务。
- Placeholder scan: 计划不包含 TBD、TODO、未定义的“类似实现”或无验收标准的错误处理步骤。
- Type consistency: `CreatorImageTaskView`、`ImageDraftInput`、`buildCreatorImageLedgerEntry()`、`confirmCreatorImage()` 和 API 路径在生产方与消费方一致。
- Cost safety: 自动测试不调用 Wetoken；任何真实付费调用都在单独授权后执行。
