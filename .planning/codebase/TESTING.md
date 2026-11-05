# Testing Patterns

**Analysis Date:** 2026-11-05

## Test Framework

**Runner:**
- 主站使用 Node.js 内置 `node:test`，通过 `tsx --test` 执行 TypeScript；根 `package.json` 声明 `tsx: ^4.23.1`，没有 Jest/Vitest dependency。
- Config: `package.json` 的 `scripts.test`；未发现根 Jest/Vitest 配置。`Dockerfile` 的 Node 20 镜像仅是构建环境声明，不是本轮本机版本实测。
- Python worker 的 `worker/tests/test_*.py` 使用 pytest；`worker/pyproject.toml` 未声明 pytest 版本、测试依赖组或 pytest 配置，不能假设安装即有完整测试环境。
- `scripts/test-build-resource-guard.py` 另用标准库 `unittest`；该脚本不被根 `scripts.test` 收集。
- `production-lab/tests/*.test.cjs` 使用 Node test 与独立隔离编译产物，见 `production-lab/tests/build.cjs`；这不是全目录 upstream 的通用 runner。

**Assertion Library:**
- 主站：`node:assert/strict`，常见 `equal/deepEqual/match/doesNotMatch/throws/rejects`，见 `tests/production-lab-origin.test.ts`、`tests/ai/wetoken-client.test.ts`。
- Worker：Python `assert`、`pytest.raises`、`pytest.approx`，见 `worker/tests/test_media_operations.py`。

**Run Commands:**
- 以下仅记录既有入口或明确标注的组合命令，**本轮全部未执行**；本轮只做静态映射与文档检查，不运行 repo scripts、测试、构建或生产操作。
```bash
pnpm test                 # package.json 已定义：tsx --test tests/**/*.test.ts
pnpm lint                 # package.json 已定义：next lint；可用性未确认
pnpm build                # package.json 已定义：next build；不是测试命令
# 根 package.json 未定义 test:watch、test:coverage 或 typecheck
```
- 根 test script 中 `tests/**/*.test.ts` 未加引号；shell 对 `**` 的展开可能影响根层与子目录发现，不能仅凭定义认定 110 个 root tests 均会执行。本轮未做运行收集验证，依据 `package.json` 和 `tests/` 文件清点。
- 如需定向验证，可用以下现有 runner 组合；它们**不是新增或已定义的 package scripts**，也没有在本轮运行：
```bash
pnpm exec tsx --test tests/production-lab-origin.test.ts
pnpm exec tsx --test tests/creator/image-api-contract.test.ts
PYTHONPATH=worker/src python3 -m pytest worker/tests
```
- Python 命令要求环境已有 pytest 与对应依赖；`worker/pyproject.toml` 没有 test extra，不能声称命令已经可运行。根 `lint` 缺少已确认的 ESLint 配置/直接依赖，禁止为映射触发交互安装。
- `production-lab/README.md` 记录先执行 `node production-lab/tests/build.cjs`，再逐个运行 `.test.cjs` 的 PowerShell 流程；builder 会创建隔离编译产物（`.build`），本轮没有执行或生成该目录。

## Test File Organization

**Location:**
- 主站测试集中在 `tests/`，不与 `app/`、`lib/` 源码共置；本轮静态清点为 110 个 `.test.ts`，见 `tests/`。
- Worker 独立 `worker/tests/` 共 6 个 `test_*.py`；辅助构建守卫测试位于 `scripts/test-build-resource-guard.py`。
- Lab 主站适配测试既有根 `tests/production-lab-*.test.ts`，也有 `production-lab/tests/*.test.cjs`；独立 upstream 各自收集测试。

**Naming:**
- TS 使用描述性 kebab-case 加 `.test.ts`，按 `creator/ai/usage/auth/observability` 分域，如 `tests/creator/image-api-contract.test.ts`。
- `*-contract.test.ts`、`*-ui-contract.test.ts` 常包含源码/SQL 结构断言，不意味着真实浏览器或数据库集成，见 `tests/creator/workspace-ui-contract.test.ts`、`tests/creator/media-worker-schema-contract.test.ts`。
- Python 使用 `test_*.py` 与 `test_*` 函数，见 `worker/tests/test_queue_loop.py`。

**Structure:**
```text
tests/
  *.test.ts                # canvas、workflow、lab 主站适配等
  ai/*.test.ts             # provider request/response normalization
  auth/*.test.ts
  creator/*.test.ts        # API factory、storage、worker contract
  observability/*.test.ts
  usage/*.test.ts
worker/tests/test_*.py      # 独立 Python suite
scripts/test-build-resource-guard.py
production-lab/tests/*.test.cjs
```

## Test Structure

**Suite Organization:**
- 主站多为顶层 `test(description, fn)`，不要求 describe 嵌套；以下摘自 `tests/creator/media-worker-e2e-checklist.test.ts`：
```typescript
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("local worker rollout checklist names every durable boundary", () => {
    const runbook = fs.readFileSync("docs/local-media-worker.md", "utf8");
    ["配对", "租约", "NAS", "SHA-256", "重试", "WeToken"].forEach((term) => assert.match(runbook, new RegExp(term, "i")));
});
```

**Patterns:**
- Setup：每个测试创建 Request、fake client、业务对象；factory fixture 返回 handler 与 calls，见 `tests/creator/image-api-contract.test.ts`。
- Teardown：改写环境变量后由 `afterEach` 恢复原值或删除，见 `tests/ai/wetoken-client.test.ts`；Python 用 `monkeypatch`、`tmp_path` 自动隔离，见 `worker/tests/test_runtime_config.py`。
- 源码契约通过 `fs.readFileSync` 加正则检查；依赖仓库根 cwd 与文件布局，不是 React render，见 `tests/creator/workspace-ui-contract.test.ts`。
- Python 多为普通 pytest 函数，使用 `parametrize` 组合边界，见 `worker/tests/test_media_operations.py`。

## Mocking

**Framework:** 主站主要使用手写 fake 和 dependency injection；没有根 Jest/Vitest mock 配置。Worker 使用 pytest `monkeypatch`，见 `tests/creator/image-api-contract.test.ts`、`worker/tests/test_media_operations.py`。

**Patterns:**
- API factory 注入 `createClient`、workspace lookup、confirm/delete service 并记录调用次数，见 `tests/creator/image-api-contract.test.ts`。
- Storage fake 使用 Map、调用数组和可注入错误；provider 请求注入 `fetcher` 并返回标准 `Response`，见 `tests/creator/image-storage.test.ts`、`tests/ai/wetoken-client.test.ts`。
```typescript
// tests/ai/wetoken-client.test.ts 的既有错误响应替身
const fetcher = async () => new Response(
  JSON.stringify({ error: { message: 'rate limited' } }),
  { status: 429, statusText: 'Too Many Requests', headers: { 'Content-Type': 'application/json' } },
);
```
- Worker 用 `FakeClient` 记录下载、heartbeat、upload 调用，注入 runner 写临时输出，不需要真实 GPU，见 `worker/tests/test_queue_loop.py`。

**What to Mock:**
- Provider 网络、storage/DB client、模型 runner、probe/FFmpeg 外部执行适配，见 `tests/ai/wetoken-client.test.ts`、`tests/creator/image-storage.test.ts`、`worker/tests/test_media_operations.py`。
- 安装测试通过临时 ZIP、假 artifact descriptor 与 `FG_WORKER_HOME` 隔离用户目录，见 `worker/tests/test_installer.py`；构建守卫测试用临时假 Docker CLI，见 `scripts/test-build-resource-guard.py`。

**What NOT to Mock:**
- 被测纯业务函数、输入校验、权限过滤构造、真实 Response 的状态/JSON 解析应实际执行；样本见 `tests/production-lab-origin.test.ts`、`tests/creator/image-api-contract.test.ts`。
- 不把 fake 通过解释成真实 NAS、GPU、数据库或 provider 可用；`worker/tests/test_queue_loop.py` 和 `tests/creator/image-storage.test.ts` 明确是替身路径。

## Fixtures and Factories

**Test Data:**
- 数据多在测试文件内联创建；以下摘自 `tests/creator/image-storage.test.ts`，保留真实约束所需最小字节长度与 magic header，而非完整图片解码 fixture：
```typescript
const PNG = new Uint8Array(300_000);
PNG.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
```
- `itemFixture(options)` 组合 fake lookup、handler、calls；本机媒体测试写入临时 ZIP、config 与小文件，见 `tests/creator/image-api-contract.test.ts`、`worker/tests/test_installer.py`。

**Location:**
- 本轮未在 `tests/`、`worker/tests/` 发现专用 fixture/helper/mock 文件或 `conftest.py`；就近 fixture 与 `tmp_path` 是已读样本模式，不外推整个 upstream。
- Lab CJS fixture 从 `.build` 导入主站 domain 实现，build 输入由 `production-lab/tests/build.cjs` 列出，不是导入 vendor 全量源码。

## Coverage

**Requirements:** 根 `package.json`、`worker/pyproject.toml` 未定义 coverage script、阈值或报告器；未发现可据此声称强制覆盖率的主站 CI。不能给出实际覆盖率或测试通过率。

**View Coverage:**
```bash
# 根项目与 worker 没有已确认的 coverage 查看命令；本轮未生成报告
# 只有独立 ArcReel frontend 定义 test:coverage（不能在根目录套用）
```
- ArcReel frontend 的独立 coverage 为 Vitest v8，输出 text/json-summary/lcov；只适用于 `production-lab/arcreel/upstream/frontend/vitest.config.ts`。
- 根没有 `.github/`、`.gitlab-ci.yml`、`.circleci/` 或 Jenkinsfile；`Dockerfile` 定义 build 和产物存在性检查，未定义执行根测试步骤，不应当作 test gate。
- `production-lab/opencreator/upstream/.github/workflows/ci.yml` 含自身 `pnpm test/typecheck`；`production-lab/arcreel/upstream/.github/workflows/test.yml` 含自身 Ruff/pytest/coverage。这些嵌套 workflow 不是主站根 CI，远程是否另配流水线无法由本地静态映射确认。

## Test Types

**Unit Tests:**
- 主站 domain、canvas helper、origin policy、计价与 provider normalization，见 `tests/canvas.test.ts`、`tests/production-lab-origin.test.ts`、`tests/usage/pricing.test.ts`、`tests/ai/wetoken-client.test.ts`。
- Worker parser、operation validation、runner config 与安装安全边界，见 `worker/tests/test_media_operations.py`、`worker/tests/test_runtime_config.py`、`worker/tests/test_installer.py`。

**Integration Tests:**
- handler + fake client/service 验证请求状态、用户归属、调用次数；是进程内组合验证，不连接真实 DB，见 `tests/creator/image-api-contract.test.ts`。
- SQL schema、租约、上传、UI integration wiring 多由源码契约断言覆盖，见 `tests/creator/media-worker-schema-contract.test.ts`、`tests/creator/workspace-ui-contract.test.ts`。
- Lab legacy CJS suite 单独编译 `lib/production-lab/` 中选定模块后测试，见 `production-lab/tests/build.cjs`；根 test script 不包含 `.test.cjs` 或 Python tests。

**E2E Tests:**
- 未发现主站配置 Playwright/Cypress 的 package script 或 dependency；`tests/creator/media-worker-e2e-checklist.test.ts` 实际只检查文档关键词，不能视为真实端到端测试。
- 独立 upstream 工具不能冒充主站标准：OpenCreator 使用 Vitest/Playwright，ArcReel frontend 使用 Vitest/jsdom、backend 使用 pytest；见各自 `package.json`、`production-lab/arcreel/upstream/pyproject.toml`。
- Yingce Web 使用 `bun test`，backend 按自身规则使用 Go tests；见 `production-lab/yingce/canvas/web/package.json`、`production-lab/yingce/canvas/AGENTS.md`。FG gateway 另用 Node test，见 `production-lab/yingce/gateway/package.json`。
- 本轮未做浏览器、真实 provider、NAS、GPU、lease recovery 跨进程验收；生产操作受 `AGENTS.md` 守护进程保护约束，不能为验证主动停止或重启服务。

## Common Patterns

**Async Testing:**
- 直接 `async` callback 并等待被测 Promise；以下摘自 `tests/creator/image-api-contract.test.ts`：
```typescript
test('PATCH factory handler scopes owned lookup and confirms once on success', async () => {
  const { handlers, localClient, calls } = itemFixture();
  const response = await handlers.PATCH(itemRequest('{"referencePaths":[]}'), { params: { id: 't1' } });
  assert.equal(response.status, 200);
  assert.equal(calls.confirm, 1);
  assertItemLookup(localClient.queries[0]);
});
```

**Error Testing:**
- Promise rejection 用 `assert.rejects`，同步校验用 `assert.throws`，HTTP 错误断言 status/code；见 `tests/ai/wetoken-client.test.ts`、`tests/creator/image-api-contract.test.ts`。
```typescript
// tests/ai/wetoken-client.test.ts 的既有缺少配置分支
await assert.rejects(
  () => wetokenChat({ model: 'gpt-5.6-luna-t1a', messages: [] }),
  /缺少 WETOKEN_API_KEY/,
);
```
- Worker 使用 `pytest.raises` 捕获领域错误并检查 code；参数化检查帧率/降级边界，见 `worker/tests/test_installer.py`、`worker/tests/test_media_operations.py`。

---

*Testing analysis: 2026-11-05*
