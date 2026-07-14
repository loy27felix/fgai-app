# Wetoken Text Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every non-DeepSeek text model and old relay dependency with a tested Wetoken model catalog and server-only OpenAI-compatible client while preserving the existing AI panel contract.

**Architecture:** A pure shared catalog describes exact model IDs and capabilities. A server-only Wetoken client owns authentication, timeouts, request/response normalization, and safe errors. A text orchestrator honors the selected model without silent substitution, while the existing Next.js route continues to enforce login and record usage.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript 5.5, Node test runner through `tsx`, Supabase Auth/Postgres, Wetoken OpenAI-compatible API.

## Global Constraints

- Keep the two existing DeepSeek text models and their direct API configuration.
- Add exactly `gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-5.6-sol`, and `claude-opus-4-8` as Wetoken text models.
- Remove the old relay model entries, `RELAY_*` usage, and the `api.gpt.ge` default.
- Never put the real Wetoken Key in Git, client code, logs, test fixtures, or database rows.
- Use `WETOKEN_API_KEY` and optional `WETOKEN_BASE_URL`; default base URL is `https://wetoken.ai/v1`.
- Honor the selected model. DeepSeek with image attachments returns a clear capability error instead of silently switching to another model.
- This plan does not change image generation, video generation, Supabase schema, or BGM behavior.
- Finish with a single independently verified commit and push to `origin/main`.

---

## File Map

- Create `lib/ai/catalog.ts`: shared text model registry and resolver.
- Create `lib/ai/wetoken-client.ts`: server-only Wetoken Chat Completions adapter.
- Create `lib/ai/text.ts`: provider selection and multimodal message construction.
- Create `tests/ai/catalog.test.ts`: exact model registry tests.
- Create `tests/ai/wetoken-client.test.ts`: request, response, missing-key, and safe-error tests.
- Create `tests/ai/text.test.ts`: provider routing and image-capability tests.
- Modify `lib/models.ts`: compatibility re-export for existing client components.
- Modify `app/api/ai/chat/route.ts`: call the text orchestrator and remove relay logic.
- Modify `.env.example`: document Wetoken server-only variables.
- Modify `package.json` / `package-lock.json`: add `tsx` and `npm test`.
- Delete `lib/relay.ts`: old provider is no longer reachable.

### Task 1: Install the test harness and define the exact model catalog

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `tests/ai/catalog.test.ts`
- Create: `lib/ai/catalog.ts`
- Modify: `lib/models.ts`

**Interfaces:**
- Produces: `TextModelProvider`, `TextModel`, `TEXT_MODELS`, `resolveTextModel(id?)`, and the compatibility alias `resolveModel(id?)`.
- `TextModel` contains `id`, `label`, `provider`, `apiModel`, `supportsImages`, and optional `thinkable`.

- [ ] **Step 1: Add the TypeScript test runner**

Run:

```powershell
npm install --save-dev tsx
```

Then add this script to `package.json`:

```json
"test": "tsx --test tests/**/*.test.ts"
```

Expected: `tsx` appears in `devDependencies`; no production dependency is added.

- [ ] **Step 2: Write the failing catalog test**

Create `tests/ai/catalog.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { TEXT_MODELS, resolveTextModel } from "../../lib/ai/catalog";

test("catalog exposes the exact supported text models in UI order", () => {
  assert.deepEqual(
    TEXT_MODELS.map(({ id, provider, supportsImages }) => ({ id, provider, supportsImages })),
    [
      { id: "deepseek-flash", provider: "deepseek", supportsImages: false },
      { id: "deepseek-pro", provider: "deepseek", supportsImages: false },
      { id: "gpt-5.6-luna", provider: "wetoken", supportsImages: true },
      { id: "gpt-5.6-terra", provider: "wetoken", supportsImages: true },
      { id: "gpt-5.6-sol", provider: "wetoken", supportsImages: true },
      { id: "claude-opus-4-8", provider: "wetoken", supportsImages: true },
    ],
  );
});

test("resolver falls back to DeepSeek Flash", () => {
  assert.equal(resolveTextModel("missing").id, "deepseek-flash");
  assert.equal(resolveTextModel().id, "deepseek-flash");
});
```

- [ ] **Step 3: Run the catalog test and verify RED**

Run:

```powershell
npm test -- tests/ai/catalog.test.ts
```

Expected: FAIL because `lib/ai/catalog.ts` does not exist.

- [ ] **Step 4: Implement the minimal catalog**

Create `lib/ai/catalog.ts` with the six rows asserted above. Use these labels:

```ts
export type TextModelProvider = "deepseek" | "wetoken";

export interface TextModel {
  id: string;
  label: string;
  provider: TextModelProvider;
  apiModel: string;
  supportsImages: boolean;
  thinkable?: boolean;
}

export const TEXT_MODELS: TextModel[] = [
  { id: "deepseek-flash", label: "DeepSeek v4-flash · 快", provider: "deepseek", apiModel: "deepseek-v4-flash", supportsImages: false, thinkable: true },
  { id: "deepseek-pro", label: "DeepSeek v4-pro · 强", provider: "deepseek", apiModel: "deepseek-v4-pro", supportsImages: false, thinkable: true },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna · 快速", provider: "wetoken", apiModel: "gpt-5.6-luna", supportsImages: true },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra · 均衡", provider: "wetoken", apiModel: "gpt-5.6-terra", supportsImages: true },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol · 高级推理", provider: "wetoken", apiModel: "gpt-5.6-sol", supportsImages: true },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", provider: "wetoken", apiModel: "claude-opus-4-8", supportsImages: true },
];

export function resolveTextModel(id?: string): TextModel {
  return TEXT_MODELS.find((model) => model.id === id) ?? TEXT_MODELS[0];
}
```

Replace `lib/models.ts` with compatibility exports:

```ts
export {
  TEXT_MODELS,
  resolveTextModel as resolveModel,
} from "@/lib/ai/catalog";
export type {
  TextModel,
  TextModelProvider as Provider,
} from "@/lib/ai/catalog";
```

- [ ] **Step 5: Run the catalog test and verify GREEN**

Run:

```powershell
npm test -- tests/ai/catalog.test.ts
```

Expected: 2 tests pass, 0 fail.

### Task 2: Implement the server-only Wetoken Chat Completions client

**Files:**
- Create: `tests/ai/wetoken-client.test.ts`
- Create: `lib/ai/wetoken-client.ts`

**Interfaces:**
- Consumes: OpenAI-compatible messages from Task 3.
- Produces: `wetokenChat(options, dependencies?) => Promise<ChatResult>`.
- `dependencies.fetcher` exists only as dependency injection; production calls omit it.

- [ ] **Step 1: Write failing request/response and error tests**

Create `tests/ai/wetoken-client.test.ts` using `node:test`. Save and restore `process.env.WETOKEN_API_KEY` and `process.env.WETOKEN_BASE_URL` in each test. Assert these behaviors with a local fake `fetcher`:

```ts
await wetokenChat(
  { model: "gpt-5.6-luna", messages: [{ role: "user", content: "hello" }], jsonOutput: true, maxTokens: 321 },
  { fetcher },
);
```

The fake must receive:

```ts
{
  url: "https://wetoken.example/v1/chat/completions",
  authorization: "Bearer test-wetoken-key",
  body: {
    model: "gpt-5.6-luna",
    messages: [{ role: "user", content: "hello" }],
    stream: false,
    max_tokens: 321,
    response_format: { type: "json_object" },
  },
}
```

Return a fake `200` response and assert normalized output:

```ts
{
  content: "world",
  usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
}
```

Add separate tests asserting:

```ts
await assert.rejects(() => wetokenChat({ model: "gpt-5.6-luna", messages: [] }), /缺少 WETOKEN_API_KEY/);
await assert.rejects(() => wetokenChat(validOptions, { fetcher: failingFetcher }), /Wetoken 429: rate limited/);
```

The failing response body should be JSON `{ "error": { "message": "rate limited" } }`; the thrown error must not include the fake key.

- [ ] **Step 2: Run the client test and verify RED**

Run:

```powershell
npm test -- tests/ai/wetoken-client.test.ts
```

Expected: FAIL because `lib/ai/wetoken-client.ts` does not exist.

- [ ] **Step 3: Implement the minimal client**

Create `lib/ai/wetoken-client.ts` with:

```ts
import type { ChatResult } from "@/lib/deepseek";

export type OpenAITextPart = { type: "text"; text: string };
export type OpenAIImagePart = { type: "image_url"; image_url: { url: string } };
export type OpenAIMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<OpenAITextPart | OpenAIImagePart>;
};

export interface WetokenChatOptions {
  model: string;
  messages: OpenAIMessage[];
  jsonOutput?: boolean;
  maxTokens?: number;
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function wetokenChat(
  options: WetokenChatOptions,
  dependencies: { fetcher?: Fetcher } = {},
): Promise<ChatResult> {
  const key = process.env.WETOKEN_API_KEY;
  if (!key) throw new Error("缺少 WETOKEN_API_KEY 环境变量");
  const base = (process.env.WETOKEN_BASE_URL || "https://wetoken.ai/v1").replace(/\/$/, "");
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    stream: false,
    max_tokens: options.maxTokens ?? 2000,
  };
  if (options.jsonOutput) body.response_format = { type: "json_object" };

  const response = await (dependencies.fetcher ?? fetch)(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(55_000),
  });

  const data = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    const message = String(data?.error?.message || data?.message || response.statusText || "request failed").slice(0, 300);
    throw new Error(`Wetoken ${response.status}: ${message}`);
  }
  return { content: data?.choices?.[0]?.message?.content ?? "", usage: data?.usage };
}
```

- [ ] **Step 4: Run the client test and verify GREEN**

Run:

```powershell
npm test -- tests/ai/wetoken-client.test.ts
```

Expected: all client tests pass and no Key appears in output.

### Task 3: Add the provider orchestrator and preserve explicit model selection

**Files:**
- Create: `tests/ai/text.test.ts`
- Create: `lib/ai/text.ts`
- Modify: `app/api/ai/chat/route.ts`
- Delete: `lib/relay.ts`

**Interfaces:**
- Consumes: `resolveTextModel`, `deepseekChat`, and `wetokenChat`.
- Produces: `chatWithTextModel(options, dependencies?) => Promise<{ spec: TextModel; result: ChatResult }>`.

- [ ] **Step 1: Write the failing orchestration tests**

Create `tests/ai/text.test.ts` and inject fake `deepseek` and `wetoken` functions. Assert:

1. `gpt-5.6-terra` calls only Wetoken with API model `gpt-5.6-terra`.
2. `deepseek-pro` calls only DeepSeek with mode `pro` and forwards `thinking`.
3. A Wetoken model with two images transforms only the final user message into:

```ts
{
  role: "user",
  content: [
    { type: "text", text: "describe" },
    { type: "image_url", image_url: { url: "data:image/png;base64,one" } },
    { type: "image_url", image_url: { url: "data:image/png;base64,two" } },
  ],
}
```

4. `deepseek-flash` with any image rejects with `DeepSeek 当前不支持图片输入，请选择 GPT-5.6 或 Claude Opus 4.8` and does not call either provider.

- [ ] **Step 2: Run the orchestrator test and verify RED**

Run:

```powershell
npm test -- tests/ai/text.test.ts
```

Expected: FAIL because `lib/ai/text.ts` does not exist.

- [ ] **Step 3: Implement the orchestrator**

Create `lib/ai/text.ts`. Define:

```ts
export interface TextChatOptions {
  modelId?: string;
  messages: ChatMessage[];
  images?: string[];
  thinking?: boolean;
  jsonOutput?: boolean;
  maxTokens?: number;
}
```

Resolve the model once. For DeepSeek, reject non-empty `images`, then call `deepseekChat` using `pro` only when `spec.id === "deepseek-pro"`. For Wetoken, convert the final user message to content parts only when images exist, then call `wetokenChat` with `spec.apiModel`. Return both `spec` and `result` so usage logging records the exact selected catalog ID.

The dependency interface is:

```ts
type TextDependencies = {
  deepseek?: typeof deepseekChat;
  wetoken?: typeof wetokenChat;
};
```

- [ ] **Step 4: Run the orchestrator tests and verify GREEN**

Run:

```powershell
npm test -- tests/ai/text.test.ts
```

Expected: all orchestrator tests pass.

- [ ] **Step 5: Migrate the authenticated chat route**

In `app/api/ai/chat/route.ts`:

- Replace direct `deepseekChat`, `relayChat`, and `resolveModel` imports with `chatWithTextModel`.
- Keep login validation, request parsing, empty-message validation, `maxDuration`, and `ai_usage` insert.
- Replace the provider branch with:

```ts
const { spec, result } = await chatWithTextModel({
  modelId,
  messages,
  images,
  thinking: !!body.thinking,
  jsonOutput: !!body.jsonOutput,
});
```

- Keep the response contract `{ content, usage }` unchanged.
- Delete `lib/relay.ts` after `rg -n "relayChat|lib/relay|RELAY_" app components lib` returns no live imports or environment references.

- [ ] **Step 6: Run the complete tests**

Run:

```powershell
npm test
```

Expected: all catalog, client, and orchestration tests pass with 0 failures.

### Task 4: Document the server environment and verify the production build

**Files:**
- Modify: `.env.example`
- Local-only modify: `.env.local`

**Interfaces:**
- Produces: documented `WETOKEN_API_KEY` and `WETOKEN_BASE_URL` configuration.

- [ ] **Step 1: Replace stale environment documentation**

Append this server-only section to `.env.example` and remove the obsolete OpenAI placeholder:

```dotenv
# === Wetoken ===（GPT / Claude / 图片 / 视频统一中转，仅服务端）
WETOKEN_API_KEY=sk-你的_wetoken_key
WETOKEN_BASE_URL=https://wetoken.ai/v1
```

Keep all existing Supabase and DeepSeek example variables.

- [ ] **Step 2: Configure the real Key locally without tracking it**

In `.env.local`, set `WETOKEN_API_KEY` to the user-provided value and `WETOKEN_BASE_URL=https://wetoken.ai/v1`. Remove local `RELAY_BASE_URL` and `RELAY_API_KEY`. Do not print the file or Key to command output.

Verify only variable names:

```powershell
Select-String -Path .env.local -Pattern '^(WETOKEN_|RELAY_)' | ForEach-Object { ($_ -split '=')[0] }
```

Expected:

```text
WETOKEN_API_KEY
WETOKEN_BASE_URL
```

- [ ] **Step 3: Run static and production verification**

Run:

```powershell
npx tsc --noEmit
npm test
npm run build
git diff --check
git grep -n "api.gpt.ge\|RELAY_API_KEY\|RELAY_BASE_URL" -- . ':!docs/superpowers/specs/*' ':!docs/superpowers/plans/*'
```

Expected: TypeScript exits 0, tests have 0 failures, build exits 0, diff check exits 0, and the old relay grep has no matches in runtime/config code.

- [ ] **Step 4: Review and push the isolated change**

Run:

```powershell
git status --short
git diff --stat
git diff -- . ':!package-lock.json'
git add package.json package-lock.json .env.example lib/ai lib/models.ts app/api/ai/chat/route.ts tests/ai
git add -u lib/relay.ts
git commit -m "feat(ai): migrate text models to Wetoken"
git push origin main
git rev-parse HEAD
git rev-parse origin/main
```

Expected: one implementation commit is pushed, both hashes match, `.env.local` is absent from the commit, and the working tree is clean.

## Plan Self-Review

- Spec coverage: this plan covers only the independently deployable text/provider subproject; image, video, canvas, BGM, and UI cleanup remain explicitly outside scope.
- Placeholder scan: no TBD/TODO/“implement later” steps are present.
- Type consistency: `TextModel`, `resolveTextModel`, `WetokenChatOptions`, and `chatWithTextModel` signatures are used consistently across tasks.
- Safety: selected models are honored, real secrets remain server-only, and legacy relay runtime references are removed only after tests and import search.
