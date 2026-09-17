#!/usr/bin/env bash
set -euo pipefail

# Maintainer-only build. End users download the resulting setup app and never
# install Python, FFmpeg, PyTorch or model weights themselves.
VERSION="${1:?usage: build-release.sh VERSION RUNNER_DIR FFMPEG_DIR [OUTPUT_DIR]}"
RUNNER_DIR="${2:?usage: build-release.sh VERSION RUNNER_DIR FFMPEG_DIR [OUTPUT_DIR]}"
FFMPEG_DIR="${3:?usage: build-release.sh VERSION RUNNER_DIR FFMPEG_DIR [OUTPUT_DIR]}"
OUTPUT_DIR="${4:-dist/fg-worker-release}"
SERVER_URL="${FG_STUDIO_SERVER_URL:-}"
WORKER_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE_ROOT="$WORKER_ROOT/src"
STAGE="$OUTPUT_DIR/runtime-macos-arm64"

command -v pyinstaller >/dev/null || { echo "维护者构建机缺少 PyInstaller；最终用户不需要安装它。" >&2; exit 1; }
test -d "$RUNNER_DIR" || { echo "Runner 目录不存在：$RUNNER_DIR" >&2; exit 1; }
test -d "$FFMPEG_DIR" || { echo "FFmpeg 目录不存在：$FFMPEG_DIR" >&2; exit 1; }
for runner in basicvsrpp realesrgan propainter; do
  test -f "$RUNNER_DIR/$runner" || { echo "Required packaged Runner is missing: $runner" >&2; exit 1; }
done
rm -rf "$OUTPUT_DIR"
mkdir -p "$STAGE"
cd "$WORKER_ROOT"
printf '%s' "$SERVER_URL" > "$SOURCE_ROOT/fg_worker/default-server.txt"
trap 'rm -f "$SOURCE_ROOT/fg_worker/default-server.txt"' EXIT
PYINSTALLER_ARGS=(--noconfirm --clean --onefile --paths "$SOURCE_ROOT" --add-data "$SOURCE_ROOT/fg_worker/default-server.txt:fg_worker" --collect-all keyring --hidden-import tkinter)
pyinstaller "${PYINSTALLER_ARGS[@]}" --name FGStudioWorkerSetup "$SOURCE_ROOT/fg_worker/__main__.py"
pyinstaller "${PYINSTALLER_ARGS[@]}" --name fg-worker "$SOURCE_ROOT/fg_worker/__main__.py"
cp "dist/FGStudioWorkerSetup" "$OUTPUT_DIR/FGStudioWorkerSetup"
cp "dist/fg-worker" "$STAGE/fg-worker"
mkdir -p "$STAGE/runners" "$STAGE/ffmpeg"
cp -R "$RUNNER_DIR"/* "$STAGE/runners/"
cp -R "$FFMPEG_DIR"/* "$STAGE/ffmpeg/"
(cd "$STAGE" && zip -qr "../runtime-macos-arm64-$VERSION.zip" .)
echo "已生成运行包；请使用 sha256sum 计算 setup/runtime 摘要并按 windows manifest 结构发布 macos-arm64 清单。"
