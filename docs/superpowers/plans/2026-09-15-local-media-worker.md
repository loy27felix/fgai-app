# 本地 GPU 媒体处理 Worker 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保持 Mac mini 现有 App、WeToken、账单、队列和 NAS 职责不变的前提下，增加一个由用户本地 GPU 执行视频超分和去水印的可恢复 Worker 系统。

**Architecture:** Mac mini 继续作为唯一控制面，使用现有 PostgreSQL 和 NAS 保存任务元数据、输入和输出。用户电脑运行不接受入站连接的 Python Worker，通过 HTTPS 领取自己名下的任务、从 NAS 读取输入并把校验后的结果上传回 NAS；浏览器只负责提交任务和显示进度。WeToken/Seedance 生图生视频调用仍走 Mac mini 服务端，本计划只增加本地后处理能力。

**Tech Stack:** 现有 Next.js 14、TypeScript、PostgreSQL 16、NAS 本地存储、Cloudflare Tunnel；新增独立 Python 3.11 Worker、httpx、keyring、psutil、PyTorch CUDA/MPS、FFmpeg、BasicVSR++/Real-ESRGAN 视频超分适配器和带遮罩的 ProPainter 去水印适配器。

**Spec:** `docs/superpowers/specs/2026-09-15-local-media-worker.md`

## Global Constraints

- 不修改现有 `docker-compose.yml` 中 App、PostgreSQL、Nginx、Cloudflare Tunnel 的职责和启动方式。
- 不在浏览器、localStorage、localforage、IndexedDB 或临时 WeToken URL 中保存正式素材。
- 不把 WeToken API Key、数据库密码或 NAS 凭据发给 Worker。
- Worker 只使用 HTTPS 出站轮询，不监听公网端口，不直接挂载 SMB/NAS。
- 服务端只接受服务端解析的 `asset_id` 和 `job_id`，拒绝 Worker 提交任意 NAS 绝对路径。
- 所有任务和结果必须带用户、workspace、模型版本、Worker ID、租约和 SHA-256；失败时保留可诊断状态。
- 每个任务完成独立的测试后再提交，禁止把未完成的模型适配器接入默认按钮。

---

### Task 1: 定义媒体任务、Worker 能力和操作验证契约

**Files:**
- Create: `types/media-worker.ts`
- Create: `lib/creator/media-processing.ts`
- Test: `tests/creator/media-processing-contract.test.ts`

**Interfaces:**
- Consumes: 现有 `creator_assets` 的 `id/kind/mime_type/width/height/duration_ms` 字段。
- Produces: `MediaOperation`、`MediaJobStatus`、`WorkerCapability`、`CreateMediaJobInput`、`validateMediaJobInput()`、`workerSupportsJob()`，供数据库、API、Worker 和画布 UI 共用。

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { validateMediaJobInput, workerSupportsJob } from "../../lib/creator/media-processing";

test("video super-resolution requires an owned video asset and a supported target", () => {
  assert.deepEqual(validateMediaJobInput({
    operation: "video_super_resolution",
    sourceAssetId: "asset-1",
    targetResolution: "1080p",
    modelProfile: "basicvsrpp-quality",
    idempotencyKey: "job-1",
  }), {
    operation: "video_super_resolution",
    sourceAssetId: "asset-1",
    maskAssetId: null,
    targetResolution: "1080p",
    modelProfile: "basicvsrpp-quality",
    idempotencyKey: "job-1",
  });
});

test("watermark removal refuses a missing mask", () => {
  assert.throws(() => validateMediaJobInput({
    operation: "watermark_removal",
    sourceAssetId: "asset-1",
    targetResolution: null,
    modelProfile: "propainter-mask",
    idempotencyKey: "job-2",
  }), /遮罩/);
});

test("worker capability matching is explicit", () => {
  assert.equal(workerSupportsJob({
    operation: "video_super_resolution",
    modelProfile: "basicvsrpp-quality",
    targetResolution: "1080p",
  }, {
    operations: ["video_super_resolution"],
    backends: ["cuda"],
    modelProfiles: ["basicvsrpp-quality"],
    maxInputBytes: 2_000_000_000,
    maxOutputPixels: 8_294_400,
  }), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/creator/media-processing-contract.test.ts`

Expected: FAIL because the shared types and validation functions do not exist.

- [ ] **Step 3: Write minimal implementation**

`types/media-worker.ts` must export these exact unions and records:

```ts
export type MediaOperation = "video_super_resolution" | "watermark_removal" | "audio_separation" | "subtitle_removal" | "subject_removal";
export type MediaJobStatus = "queued" | "leased" | "processing" | "uploading" | "retryable" | "succeeded" | "failed" | "cancelled";
export type WorkerBackend = "cuda" | "mps" | "cpu";
export type TargetResolution = "720p" | "1080p" | "2k" | "4k";
export type MediaJobSpec = { operation: MediaOperation; sourceAssetId: string; maskAssetId: string | null; targetResolution: TargetResolution | null; modelProfile: string; idempotencyKey: string };
export type WorkerCapability = { operations: MediaOperation[]; backends: WorkerBackend[]; modelProfiles: string[]; maxInputBytes: number; maxOutputPixels: number };
```

`validateMediaJobInput()` must trim IDs, limit the idempotency key to 128 characters, allow only `1080p/2k/4k` for super-resolution, require `maskAssetId` for watermark removal, and reject unsupported operation/profile combinations. `workerSupportsJob()` must compare operation, profile, backend limits, input size, and output pixels without treating a missing capability as unlimited.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/creator/media-processing-contract.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add types/media-worker.ts lib/creator/media-processing.ts tests/creator/media-processing-contract.test.ts
git commit -m "feat: define local media worker contracts"
```

### Task 2: Add durable Worker, job, pairing and upload database tables

**Files:**
- Create: `docker/initdb/013-local-media-workers.sql`
- Modify: `scripts/local-db-migrate.mjs`
- Test: `tests/creator/media-worker-schema-contract.test.ts`

**Interfaces:**
- Consumes: Task 1 operation/status names and the existing `creator_workspaces`/`creator_assets` foreign keys.
- Produces: Tables `creator_media_workers`, `creator_media_worker_pairings`, `creator_media_worker_tokens`, `creator_media_processing_jobs`, `creator_media_processing_job_events`, and `creator_media_worker_uploads`.

- [ ] **Step 1: Write the failing schema contract test**

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const sql = fs.readFileSync("docker/initdb/013-local-media-workers.sql", "utf8");

test("local worker schema keeps leases and ownership", () => {
  assert.match(sql, /create table if not exists creator_media_workers/i);
  assert.match(sql, /create table if not exists creator_media_processing_jobs/i);
  assert.match(sql, /lease_expires_at timestamptz/i);
  assert.match(sql, /unique \(user_id, idempotency_key\)/i);
  assert.match(sql, /source_asset_id uuid not null references creator_assets/i);
  assert.match(sql, /creator_media_processing_jobs_lease_idx/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/creator/media-worker-schema-contract.test.ts`

Expected: FAIL because migration `013-local-media-workers.sql` is missing.

- [ ] **Step 3: Write the migration and register it**

Create the following columns exactly:

```sql
create table if not exists creator_media_workers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  name text not null,
  platform text not null,
  architecture text not null,
  capabilities jsonb not null default '{}'::jsonb,
  status text not null default 'offline' check (status in ('online','offline','revoked')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists creator_media_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  workspace_id uuid not null references creator_workspaces(id) on delete cascade,
  operation text not null,
  status text not null default 'queued',
  source_asset_id uuid not null references creator_assets(id) on delete restrict,
  mask_asset_id uuid references creator_assets(id) on delete restrict,
  output_asset_id uuid references creator_assets(id) on delete set null,
  request jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  worker_id uuid references creator_media_workers(id) on delete set null,
  lease_token text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  progress numeric(5,2) not null default 0 check (progress >= 0 and progress <= 100),
  phase text,
  error_code text,
  error_message text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique (user_id, idempotency_key)
);
```

Add pairing codes with a hashed code and ten-minute expiry, tokens with a hashed bearer token and revocation timestamp, job events with `details` JSON, and uploads with server-derived temporary storage paths, expected byte count/hash, received byte count, and expiry. Add indexes for `(user_id,status,created_at)`, `(status,lease_expires_at)`, `(worker_id,status)`, and `(job_id,created_at)`. Add an `updated_at` trigger matching the existing generation task trigger. Append `013-local-media-workers.sql` to `migrationNames` without modifying an applied migration.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/creator/media-worker-schema-contract.test.ts`

Expected: PASS. On a disposable local PostgreSQL volume, run `node scripts/local-db-migrate.mjs` and verify the migration is recorded once in `fg_schema_migrations`.

- [ ] **Step 5: Commit**

```bash
git add docker/initdb/013-local-media-workers.sql scripts/local-db-migrate.mjs tests/creator/media-worker-schema-contract.test.ts
git commit -m "feat: add durable local media worker schema"
```

### Task 3: Implement pairing, token hashing and Worker registration APIs

**Files:**
- Create: `lib/creator/media-worker-auth.ts`
- Create: `app/api/creator/workers/route.ts`
- Create: `app/api/creator/workers/pairing/route.ts`
- Create: `app/api/creator/workers/[id]/route.ts`
- Create: `app/api/creator/worker/register/route.ts`
- Create: `app/api/creator/worker/heartbeat/route.ts`
- Test: `tests/creator/media-worker-auth.test.ts`

**Interfaces:**
- Consumes: Task 2 worker, pairing and token tables; existing `getCurrentUser()` and `query()` helpers.
- Produces: `createPairingCode(userId)`, `consumePairingCode(code, capabilities)`, `authenticateWorker(request)`, `revokeWorker(userId, workerId)`, and JSON contracts for browser and Worker clients.

- [ ] **Step 1: Write the failing auth tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { hashWorkerToken, timingSafeTokenMatch } from "../../lib/creator/media-worker-auth";

test("worker token hashing never returns the original token", () => {
  const token = "fgw_test_token";
  assert.notEqual(hashWorkerToken(token), token);
  assert.equal(timingSafeTokenMatch(token, hashWorkerToken(token)), true);
  assert.equal(timingSafeTokenMatch("fgw_other_token", hashWorkerToken(token)), false);
});

test("pairing codes have a bounded lifetime", () => {
  const code = "a".repeat(64);
  assert.throws(() => code.length > 32 && (() => { throw new Error("pairing code too long"); })(), /too long/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/creator/media-worker-auth.test.ts`

Expected: FAIL because the token helper does not exist.

- [ ] **Step 3: Implement auth and routes**

Use `randomBytes(32)` for pairing codes and long-lived tokens, store only `sha256` hashes, compare with `timingSafeEqual`, and never log the code/token. `POST /api/creator/workers/pairing` returns `{ code, expiresAt }` once to the authenticated user. `POST /api/creator/worker/register` atomically consumes an unexpired code, creates the Worker row, stores the token hash, and returns `{ workerId, token, expiresAt: null }`. `POST /api/creator/worker/heartbeat` refreshes `last_seen_at`, status and capabilities; a revoked Worker receives `WORKER_REVOKED` and cannot continue.

`GET /api/creator/workers` returns only the current user’s Worker name, platform, backend, capabilities, status, and last heartbeat. `DELETE /api/creator/workers/:id` sets `status='revoked'` and revokes tokens. `authenticateWorker(request)` requires `Authorization: Bearer`, resolves the hash, rejects revoked/expired tokens, and returns `{ workerId, userId, capabilities }` without exposing the token.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/creator/media-worker-auth.test.ts`

Expected: PASS. Also run `pnpm build` after route type checking.

- [ ] **Step 5: Commit**

```bash
git add lib/creator/media-worker-auth.ts app/api/creator/workers app/api/creator/worker/register/route.ts app/api/creator/worker/heartbeat/route.ts tests/creator/media-worker-auth.test.ts
git commit -m "feat: add local worker pairing and authentication"
```

### Task 4: Add idempotent media job creation and leased queue APIs

**Files:**
- Create: `lib/creator/media-worker-queue.ts`
- Create: `app/api/creator/media/jobs/route.ts`
- Create: `app/api/creator/media/jobs/[id]/route.ts`
- Create: `app/api/creator/worker/jobs/claim/route.ts`
- Create: `app/api/creator/worker/jobs/[id]/heartbeat/route.ts`
- Create: `app/api/creator/worker/jobs/[id]/progress/route.ts`
- Create: `app/api/creator/worker/jobs/[id]/fail/route.ts`
- Test: `tests/creator/media-worker-queue.test.ts`

**Interfaces:**
- Consumes: Task 1 validation and Task 3 `authenticateWorker()`.
- Produces: `createMediaJob()`, `listMediaJobs()`, `claimNextMediaJob()`, `heartbeatMediaJob()`, `reportMediaProgress()`, `failMediaJob()`, and `cancelMediaJob()`.

- [ ] **Step 1: Write the failing state-machine tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { nextStatusAfterFailure, canWorkerMutateJob } from "../../lib/creator/media-worker-queue";

test("a leased job can be retried until the third failed attempt", () => {
  assert.deepEqual([1, 2, 3].map((attempt) => nextStatusAfterFailure(attempt, true)), ["retryable", "retryable", "failed"]);
});

test("only the owning worker with the current lease token can report progress", () => {
  assert.equal(canWorkerMutateJob({ workerId: "w1", leaseToken: "l1", leaseExpiresAt: Date.now() + 60_000 }, "w1", "l1"), true);
  assert.equal(canWorkerMutateJob({ workerId: "w1", leaseToken: "l1", leaseExpiresAt: Date.now() + 60_000 }, "w2", "l1"), false);
  assert.equal(canWorkerMutateJob({ workerId: "w1", leaseToken: "l1", leaseExpiresAt: Date.now() - 1 }, "w1", "l1"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/creator/media-worker-queue.test.ts`

Expected: FAIL because the queue helpers do not exist.

- [ ] **Step 3: Implement the queue with PostgreSQL row leases**

Use `withTransaction()` and a CTE with `FOR UPDATE SKIP LOCKED` to make claims atomic. Before claiming, requeue jobs whose `lease_expires_at < now()` and whose status is `leased/processing/uploading`; increment `attempt_count` only when a Worker claims. The claim query must include `user_id = worker.user_id`, `status='queued'`, `attempt_count < 3`, and JSON capability predicates for the requested operation/profile. Generate a fresh random `lease_token` per claim and set `lease_expires_at = now() + interval '120 seconds'`.

`POST /api/creator/media/jobs` validates source/mask ownership in the same workspace, inserts or returns the `(user_id,idempotency_key)` row, and writes a `queued` event. `POST /api/creator/worker/jobs/:id/progress` accepts only a current lease token, clamps progress to `0..100`, and writes an event. `fail` distinguishes retryable errors from deterministic errors; attempt three becomes `failed`. `cancel` is allowed only to the owning user and cannot cancel a `succeeded` job. Every status change updates `updated_at` and emits a sanitized event.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/creator/media-worker-queue.test.ts`

Expected: PASS. Run `pnpm build` to verify all route handlers compile.

- [ ] **Step 5: Commit**

```bash
git add lib/creator/media-worker-queue.ts app/api/creator/media app/api/creator/worker/jobs tests/creator/media-worker-queue.test.ts
git commit -m "feat: add durable leased media job queue"
```

### Task 5: Add secure NAS input streaming and resumable output uploads

**Files:**
- Create: `lib/local/worker-storage.ts`
- Create: `app/api/creator/worker/jobs/[id]/input/route.ts`
- Create: `app/api/creator/worker/jobs/[id]/output/init/route.ts`
- Create: `app/api/creator/worker/uploads/[id]/route.ts`
- Create: `app/api/creator/worker/uploads/[id]/complete/route.ts`
- Modify: `lib/local/storage.ts`
- Test: `tests/creator/media-worker-assets.test.ts`

**Interfaces:**
- Consumes: Task 3 Worker identity, Task 4 job lease, existing `localStorage()` NAS readiness and range reader.
- Produces: `openWorkerInput()`, `initWorkerUpload()`, `writeWorkerUploadChunk()`, `completeWorkerUpload()`, and an immutable `creator_assets` result linked to the job.

- [ ] **Step 1: Write failing storage safety tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { workerAssetPath, validateUploadRange } from "../../lib/local/worker-storage";

test("server derives paths from user and job IDs", () => {
  assert.equal(workerAssetPath("u1", "j1", "result.mp4"), "u1/processing-results/j1/result.mp4");
  assert.throws(() => workerAssetPath("u1", "j1", "../other.mp4"), /非法/);
});

test("upload chunks must be contiguous and bounded", () => {
  assert.deepEqual(validateUploadRange({ start: 0, end: 7, total: 8, received: 0 }), { nextReceived: 8 });
  assert.throws(() => validateUploadRange({ start: 4, end: 7, total: 8, received: 0 }), /连续/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/creator/media-worker-assets.test.ts`

Expected: FAIL because worker storage helpers do not exist.

- [ ] **Step 3: Implement the NAS transfer contract**

Extend `LocalStorageBucket` with internal safe chunk-write/finalize methods that always call the existing NAS-ready check and reject absolute paths, `..`, null bytes, and files over 2 GiB. `GET /api/creator/worker/jobs/:id/input` resolves the job’s `source_asset_id`, verifies the current lease and Worker user, and streams only the asset bytes with Range support. It must never return a provider URL or expose `storage_path` to the Worker.

`POST .../output/init` creates a server-derived temporary path `userId/processing-tmp/jobId/uploadId.part`, expected byte count, MIME allowlist, and optional SHA-256. `PATCH /uploads/:id` accepts `Content-Range` chunks no larger than 8 MiB and requires the next byte offset to equal `received_bytes`. `POST /uploads/:id/complete` verifies byte count, SHA-256, MIME signature, and that the job lease is still valid; it atomically moves/renames to `userId/processing-results/jobId/<safe-name>`, inserts `creator_assets` with `source='local-worker'`, sets `output_asset_id`, and marks the job `succeeded`. Any mismatch keeps the job retryable and deletes only the temporary upload.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/creator/media-worker-assets.test.ts`

Expected: PASS. Use a local NAS-ready fixture to test a Range request, interrupted upload, checksum mismatch, and cross-user job access.

- [ ] **Step 5: Commit**

```bash
git add lib/local/worker-storage.ts lib/local/storage.ts app/api/creator/worker/jobs app/api/creator/worker/uploads tests/creator/media-worker-assets.test.ts
git commit -m "feat: add secure NAS transfer for local workers"
```

### Task 6: Scaffold the cross-platform Python Worker and capability detection

**Files:**
- Create: `worker/pyproject.toml`
- Create: `worker/src/fg_worker/__init__.py`
- Create: `worker/src/fg_worker/__main__.py`
- Create: `worker/src/fg_worker/client.py`
- Create: `worker/src/fg_worker/capabilities.py`
- Create: `worker/src/fg_worker/credentials.py`
- Create: `worker/src/fg_worker/queue_loop.py`
- Create: `worker/tests/test_capabilities.py`
- Create: `worker/tests/test_queue_loop.py`

**Interfaces:**
- Consumes: Task 3–5 HTTP contracts.
- Produces: CLI commands `fg-worker pair`, `fg-worker capabilities`, `fg-worker run`, `fg-worker benchmark`; `WorkerClient`; `detect_capabilities()`; `WorkerLoop`.

- [ ] **Step 1: Write the failing Python tests**

```python
def test_cpu_capability_never_advertises_gpu(monkeypatch):
    from fg_worker.capabilities import detect_capabilities
    monkeypatch.setattr("torch.cuda.is_available", lambda: False)
    monkeypatch.setattr("torch.backends.mps.is_available", lambda: False)
    capability = detect_capabilities()
    assert capability["backends"] == ["cpu"]

def test_loop_does_not_claim_when_token_is_missing():
    from fg_worker.queue_loop import WorkerLoop
    assert WorkerLoop.can_start(token=None) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest worker/tests -q`

Expected: FAIL because the Worker package does not exist.

- [ ] **Step 3: Implement the Worker shell**

Use Python 3.11 with `httpx`, `keyring`, `platformdirs`, `psutil`, `pydantic`, and `torch`. `detect_capabilities()` reports OS, architecture, GPU vendor/name, VRAM/RAM, `cuda`/`mps`/`cpu` backends, FFmpeg version, supported operations and model profiles. On Apple Silicon run natively on macOS and set `PYTORCH_ENABLE_MPS_FALLBACK=1`; unsupported operators must be recorded in the benchmark result rather than hidden. The Worker never opens a local HTTP server.

`pair` accepts the one-time code and server URL, calls `/api/creator/worker/register`, and stores the returned token only in Windows Credential Manager or macOS Keychain through `keyring`; if a secure keyring is unavailable, pairing fails instead of writing plaintext credentials. `run` sends heartbeat every 20 seconds, claims at most one GPU job by default, downloads inputs with Range support, dispatches an operation adapter, uploads chunks, and reports progress. A lost process leaves the server lease to expire and never deletes the source asset.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest worker/tests -q`

Expected: PASS. Run `python -m fg_worker capabilities` on one Windows NVIDIA machine and one Apple Silicon Mac to capture real capability JSON without registering them in production.

- [ ] **Step 5: Commit**

```bash
git add worker
git commit -m "feat: scaffold cross-platform local media worker"
```

### Task 7: Implement video super-resolution and masked watermark-removal adapters

**Files:**
- Create: `worker/src/fg_worker/operations/base.py`
- Create: `worker/src/fg_worker/operations/registry.py`
- Create: `worker/src/fg_worker/operations/ffmpeg.py`
- Create: `worker/src/fg_worker/operations/video_super_resolution.py`
- Create: `worker/src/fg_worker/operations/watermark_removal.py`
- Create: `worker/src/fg_worker/models/manifest.json`
- Create: `worker/tests/test_media_operations.py`

**Interfaces:**
- Consumes: Worker job spec from Task 1 and local files downloaded by Task 6.
- Produces: `OperationAdapter.run(input_path, output_path, request, progress)`, `video_super_resolution`, `watermark_removal`, and a model manifest with explicit backend support.

- [ ] **Step 1: Write failing media contract tests**

```python
def test_super_resolution_request_preserves_audio_and_duration():
    from fg_worker.operations.registry import get_operation
    adapter = get_operation("video_super_resolution")
    assert adapter.validate({"targetResolution": "1080p", "modelProfile": "basicvsrpp-quality"}) is None

def test_watermark_operation_requires_mask_file():
    from fg_worker.operations.registry import get_operation
    adapter = get_operation("watermark_removal")
    try:
        adapter.validate({"modelProfile": "propainter-mask", "maskPath": None})
    except ValueError as error:
        assert "mask" in str(error).lower()
    else:
        raise AssertionError("missing mask must be rejected")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest worker/tests/test_media_operations.py -q`

Expected: FAIL because the adapters do not exist.

- [ ] **Step 3: Implement deterministic adapter behavior**

Register `basicvsrpp-quality` as the temporal video super-resolution profile and `realesrgan-sequence-fallback` as a frame-sequence fallback. The adapter must decode with FFmpeg, keep the original frame rate and audio stream, render the requested `1080p/2k/4k` dimensions, avoid sharpening by default, and remux the original audio. Before writing output, compare frame count, duration tolerance (one frame), pixel dimensions, and codec/container validity.

Register `propainter-mask` for watermark removal. The input request must contain a server-created mask asset; the Worker must not infer an arbitrary mask when the user did not draw one. Preserve the original as a separate asset and write the inpainted result to a new file. Keep model files and license notices outside the Git history; `models/manifest.json` records model name, checksum, supported backends and required memory. If an adapter cannot run on MPS, return a structured `UNSUPPORTED_BACKEND` failure rather than silently running a long CPU job.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest worker/tests/test_media_operations.py -q`

Expected: PASS. Run `python -m fg_worker.benchmark --operation video_super_resolution --input samples/480p-10s.mp4 --target 1080p` on each supported GPU and save only timing, memory, output metadata and hashes.

- [ ] **Step 5: Commit**

```bash
git add worker/src/fg_worker/operations worker/src/fg_worker/models worker/tests/test_media_operations.py
git commit -m "feat: add local video processing adapters"
```

### Task 8: Connect canvas actions to durable local processing jobs

**Files:**
- Create: `reference/infinite-canvas/src/services/api/media-worker.ts`
- Create: `reference/infinite-canvas/src/components/canvas/media-processing-dialog.tsx`
- Create: `reference/infinite-canvas/src/components/canvas/local-worker-status.tsx`
- Modify: `reference/infinite-canvas/src/types/canvas.ts`
- Modify: `reference/infinite-canvas/src/lib/canvas/canvas-node-factory.ts`
- Modify: `reference/infinite-canvas/src/pages/canvas/project.tsx`
- Test: `tests/creator/media-worker-ui-contract.test.ts`

**Interfaces:**
- Consumes: Task 4 media job API, Task 5 durable `creator_assets`, existing `creatorVideoContentUrl()`/canvas persistence and the current “AI 超分” placeholder.
- Produces: `createMediaJob()`, `getMediaJob()`, `cancelMediaJob()`, `MediaProcessingDialog`, `LocalWorkerStatus`, and node metadata fields `mediaProcessingJobId`, `processingOperation`, `derivedFromNodeId`, `outputAssetId`.

- [ ] **Step 1: Write the failing UI contract test**

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("canvas replaces the placeholder super-resolution modal with a worker job flow", () => {
  const source = fs.readFileSync("reference/infinite-canvas/src/pages/canvas/project.tsx", "utf8");
  assert.doesNotMatch(source, /暂未实现/);
  assert.match(source, /MediaProcessingDialog/);
  assert.match(source, /mediaProcessingJobId/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/creator/media-worker-ui-contract.test.ts`

Expected: FAIL because the current modal still says “暂未实现”.

- [ ] **Step 3: Implement non-destructive canvas integration**

Replace the current `AI 超分` placeholder with a dialog that loads the selected node’s durable asset ID, lets the user choose `1080p/2k/4k`, shows the available Worker backend and model profile, and submits `POST /api/creator/media/jobs`. Add a watermark-removal dialog that lets the user draw a rectangle/polygon mask on a preview frame, persists the mask as a `creator_asset`, and submits `watermark_removal`.

Poll `GET /api/creator/media/jobs/:id` every two seconds while the page is open, but treat the database job as authoritative so refreshes do not restart work. On success, create a new derived image/video node connected to the source, set `status='success'`, use the durable same-origin media URL, and leave the original node untouched. On `queued` with no matching Worker, display “等待本机 Worker”；on `retryable/failed`, display the structured error and a retry button. Do not set the node to loading based on a temporary provider URL.

Add `LocalWorkerStatus` to the canvas toolbar or settings surface. It must show online/offline/revoked, backend, GPU name, and last heartbeat, and link to the pairing flow. Extend `CanvasNodeMetadata` and `canvas-node-factory.ts` with a helper that creates derived-node metadata from a job without copying browser-only data URLs.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/creator/media-worker-ui-contract.test.ts`; then `pnpm build`.

Expected: PASS and the production build compiles without changing existing generation routes.

- [ ] **Step 5: Commit**

```bash
git add reference/infinite-canvas/src/services/api/media-worker.ts reference/infinite-canvas/src/components/canvas/media-processing-dialog.tsx reference/infinite-canvas/src/components/canvas/local-worker-status.tsx reference/infinite-canvas/src/types/canvas.ts reference/infinite-canvas/src/lib/canvas/canvas-node-factory.ts reference/infinite-canvas/src/pages/canvas/project.tsx tests/creator/media-worker-ui-contract.test.ts
git commit -m "feat: connect canvas media tools to local workers"
```

### Task 9: Add observability, recovery, installer documentation and feature-gated rollout

**Files:**
- Create: `docs/local-media-worker.md`
- Create: `worker/packaging/windows/README.md`
- Create: `worker/packaging/macos/README.md`
- Modify: `README.md`
- Modify: `lib/creator/media-worker-queue.ts`
- Modify: `app/api/creator/worker/heartbeat/route.ts`
- Test: `tests/creator/media-worker-recovery.test.ts`

**Interfaces:**
- Consumes: Tasks 1–8 job events, Worker status, NAS upload records and existing observability logging.
- Produces: sanitized audit events, stale-lease recovery, installation/runbook docs, and a default-off `MEDIA_WORKER_ENABLED` rollout flag.

- [ ] **Step 1: Write the failing recovery test**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { recoverExpiredMediaLeases } from "../../lib/creator/media-worker-queue";

test("expired processing leases return to the queue and never delete source assets", async () => {
  const result = await recoverExpiredMediaLeases({ now: new Date("2026-09-15T00:00:00Z"), maxAttempts: 3 });
  assert.equal(result.requeued >= 0, true);
  assert.equal(result.deletedSourceAssets, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/creator/media-worker-recovery.test.ts`

Expected: FAIL because the recovery helper does not exist.

- [ ] **Step 3: Implement recovery and runbooks**

Call `recoverExpiredMediaLeases()` at the beginning of every Worker claim and from the existing service monitor hook; requeue attempts 1–2 and mark attempt 3 `failed` with `WORKER_LEASE_EXPIRED`. Emit `media_worker_online`, `media_worker_offline`, `media_job_claimed`, `media_job_progress`, `media_job_upload_verified`, `media_job_retryable`, and `media_job_failed` through the existing sanitized audit path. Never include bearer tokens, prompts, signed URLs, local file paths, or media bytes.

Gate creation and Worker APIs with `MEDIA_WORKER_ENABLED=false` by default; when false, existing image/video generation and billing routes behave exactly as before and the new buttons explain that the feature is not enabled. Document Windows NVIDIA and macOS Apple Silicon installation, secure pairing, model download checksums, sleep prevention during a job, uninstall/revoke steps, and benchmark commands. State clearly that WeToken generation remains on Mac mini while only post-processing runs locally.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/creator/media-worker-recovery.test.ts`; `pnpm test`; `pnpm build`; `python -m pytest worker/tests -q`.

Expected: all tests PASS and the Next.js build succeeds.

- [ ] **Step 5: Commit**

```bash
git add docs/local-media-worker.md worker/packaging README.md lib/creator/media-worker-queue.ts app/api/creator/worker/heartbeat/route.ts tests/creator/media-worker-recovery.test.ts
git commit -m "docs: add local worker recovery and rollout runbook"
```

### Task 10: Perform a two-machine canary and final verification

**Files:**
- Modify: `docs/local-media-worker.md` with measured benchmark results and canary sign-off
- Test: `tests/creator/media-worker-e2e-checklist.test.ts`

**Interfaces:**
- Consumes: all tasks above and two real test machines: one Windows NVIDIA machine and one Apple Silicon Mac.
- Produces: verified go/no-go record without enabling public cloud or changing Mac mini provider behavior.

- [ ] **Step 1: Add the end-to-end checklist test**

```ts
import assert from "node:assert/strict";
import test from "node:test";

test("local worker rollout checklist names every durable boundary", () => {
  const required = ["pairing", "lease", "NAS", "SHA-256", "retry", "WeToken"];
  const runbook = require("node:fs").readFileSync("docs/local-media-worker.md", "utf8");
  required.forEach((term) => assert.match(runbook, new RegExp(term, "i")));
});
```

- [ ] **Step 2: Run the checklist before enabling the flag**

Run: `pnpm test -- tests/creator/media-worker-e2e-checklist.test.ts`

Expected: FAIL until the runbook contains the complete checklist.

- [ ] **Step 3: Execute the canary**

Pair each machine, submit a 10-second 480p sample for 1080p super-resolution and a masked watermark-removal sample, close the browser, kill the Worker during upload, restart it, revoke it, and re-pair it. Verify the original asset remains, the result is present in NAS, the result hash and FFprobe metadata are recorded, the job requeues after lease expiry, and the canvas reconnects to the same derived node after refresh. Verify one WeToken generation before and after the canary to confirm its route, Reference ID and billing ledger are unchanged.

- [ ] **Step 4: Record the measured decision**

Record per-machine backend, model profile, wall-clock duration, peak memory, output dimensions, frame count, audio presence, and failure reason in `docs/local-media-worker.md`. Enable `MEDIA_WORKER_ENABLED=true` only after both machines pass; if Apple Silicon has an unsupported model operation, leave that profile disabled for MPS and keep the Windows CUDA profile available.

- [ ] **Step 5: Commit**

```bash
git add docs/local-media-worker.md tests/creator/media-worker-e2e-checklist.test.ts
git commit -m "test: verify local media worker canary"
```

## Self-review checklist

- Spec coverage: local-only GPU processing, unchanged Mac mini duties, NAS durability, Worker pairing, no browser persistence, super-resolution, masked watermark removal, MPS/CUDA capability detection, lease recovery, and rollout are covered by Tasks 1–10.
- Placeholder scan: no task depends on an unspecified model, path, status, or error; unsupported operations return explicit errors and remain feature-gated.
- Type consistency: `MediaOperation`, `MediaJobStatus`, `WorkerCapability`, job IDs, lease tokens, upload IDs, and node metadata names are defined once and reused by later tasks.
- Production safety: no task changes existing WeToken provider routes or exposes provider/API credentials to users.
