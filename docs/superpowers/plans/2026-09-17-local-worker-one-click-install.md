# 本地 Worker 一键安装 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 发布一个用户无需安装开发依赖即可运行的 FG Studio 本地 GPU Worker 安装包，并让服务端安全地提供平台匹配、哈希校验的运行包和模型包。

**Architecture:** Mac mini 继续作为控制面和 NAS 存储；一键安装器使用短期配对码读取服务端 release manifest，下载服务端签名的 artifact，安装到用户目录后注册 Worker。Worker 运行时通过本地配置加载打包的 FFmpeg 和模型 Runner，队列仍按用户、操作、模型能力和资源上限分配任务。

**Tech Stack:** Next.js 14 API routes、现有 PostgreSQL/NAS storage、Python 3.11+ Worker、PyInstaller 发布入口、HTTPS、SHA-256、Windows CUDA 与 Apple Silicon MPS。

**Spec:** `docs/superpowers/specs/2026-09-17-local-worker-one-click-install.md`

## Global Constraints

- 最终用户不安装 Python、FFmpeg、PyTorch 或模型权重；这些由 release artifact 隐藏安装。
- 不在 Git 提交模型权重、CUDA runtime、FFmpeg 二进制或真实 API 凭据。
- 下载地址只由服务端 manifest 的 artifact ID 解析，禁止客户端提交任意 NAS 路径或任意 URL。
- `MEDIA_WORKER_ENABLED=false` 默认关闭；没有真实平台 canary 不得发布为可领取能力。
- Worker Token 只写入系统 keyring；日志和配置不得写入 Token、提示词、signed URL 或本地绝对路径。

### Task 1: Add runtime configuration and packaged tool resolution

**Files:**
- Create: `worker/src/fg_worker/runtime_config.py`
- Modify: `worker/src/fg_worker/capabilities.py`
- Modify: `worker/src/fg_worker/operations/ffmpeg.py`
- Modify: `worker/src/fg_worker/operations/video_super_resolution.py`
- Modify: `worker/src/fg_worker/operations/watermark_removal.py`
- Test: `worker/tests/test_runtime_config.py`

- [x] Add a JSON config under the platform user data directory containing only server URL, install root, runner command paths and FFmpeg directory.
- [x] Make environment variables override config for development, while packaged installs use config paths.
- [x] Detect NVIDIA via `nvidia-smi` when bundled Torch is absent, but advertise an operation only when its configured runner exists.
- [x] Resolve bundled `ffmpeg`/`ffprobe` before PATH and keep the existing explicit no-CPU-fallback behavior.
- [x] Test config round-trip, runner allowlisting and bundled FFmpeg lookup.

### Task 2: Implement the manifest downloader and one-click installer

**Files:**
- Create: `worker/src/fg_worker/installer.py`
- Modify: `worker/src/fg_worker/__main__.py`
- Test: `worker/tests/test_installer.py`

- [x] Validate a release descriptor, HTTPS same-origin download path, safe ZIP members, expected byte count and SHA-256.
- [x] Download to a staging directory, extract atomically under the user data directory, and preserve the previous release on failure.
- [x] Save runtime config, register with the existing pairing endpoint, save the returned token in keyring and launch the installed Worker.
- [x] Provide a Tkinter prompt when no CLI arguments are supplied, with a headless error that explains the same two fields.
- [x] Test traversal rejection, digest mismatch cleanup, successful local ZIP installation and no token written to config.

### Task 3: Add server release manifest and artifact routes

**Files:**
- Create: `lib/creator/media-worker-bootstrap.ts`
- Create: `app/api/creator/worker/bootstrap/manifest/route.ts`
- Create: `app/api/creator/worker/bootstrap/artifacts/[id]/route.ts`
- Create: `app/api/creator/worker/bootstrap/installer/route.ts`
- Modify: `.env.example`
- Modify: `.env.docker.example`
- Test: `tests/creator/media-worker-bootstrap.test.ts`

- [x] Load and validate `FG_WORKER_RELEASE_MANIFEST_PATH` without exposing NAS bucket/path fields.
- [x] Verify an active pairing code before returning a platform release or redirecting an artifact download.
- [x] Resolve artifact IDs server-side, check NAS size, and redirect to a short-lived signed URL.
- [x] Let a logged-in browser download the matching installer artifact without exposing a raw NAS path.
- [x] Test disabled/missing-release/invalid-code/unknown-artifact responses and public manifest redaction.

### Task 4: Make the canvas provide the zero-install path

**Files:**
- Modify: `reference/infinite-canvas/src/components/canvas/local-worker-status.tsx`
- Modify: `reference/infinite-canvas/src/services/api/media-worker.ts`
- Test: `tests/creator/media-worker-ui-contract.test.ts`

- [x] Add a “下载一键安装包” action beside the pairing code and explain that the user only pastes the code into the installer.
- [x] Select Windows/NVIDIA or macOS/Apple Silicon installer by the browser platform without asking for Python/FFmpeg commands.
- [x] Keep the existing worker status, revoke and feature-disabled states unchanged.

### Task 5: Add release build scripts and user-facing runbook

**Files:**
- Create: `worker/packaging/windows/build-release.ps1`
- Create: `worker/packaging/macos/build-release.sh`
- Modify: `worker/packaging/windows/README.md`
- Modify: `worker/packaging/macos/README.md`
- Modify: `docs/local-media-worker.md`
- Modify: `README.md`

- [x] Build installer/runtime artifacts with PyInstaller on a maintainer machine, copy only approved runners/weights, compute SHA-256 and emit a manifest.
- [x] Document that end users double-click the installer and never install development dependencies.
- [x] Document release publication to NAS, manifest environment setup, versioned rollback and token revoke.

### Task 6: Validate this NVIDIA computer before canary

**Files:**
- Create: `worker/packaging/windows/preflight.ps1`
- Test: `worker/tests/test_preflight_contract.py`

- [x] Report NVIDIA model, driver, CUDA visibility, disk space and FFmpeg availability without uploading any local files.
- [x] Fail closed when CUDA or a packaged model Runner is missing.
- [x] Run the preflight on the RTX 4060 Ti machine; it detected the GPU/driver/FFmpeg and failed closed because no packaged Runner is installed.
- [ ] Complete the real 480p→1080p and interruption/restart canary before enabling the feature flag.

## Verification

- `node node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/bin/tsc --noEmit --pretty false`
- `python -m py_compile worker/src/fg_worker/*.py worker/src/fg_worker/operations/*.py`
- `python -m pytest worker/tests -q` in a normal (non-sandboxed) Windows environment
- `pnpm test -- tests/creator/media-worker-bootstrap.test.ts tests/creator/media-worker-ui-contract.test.ts`
- `pnpm build` on the deployment host
- `worker/packaging/windows/preflight.ps1` on the RTX 4060 Ti machine
