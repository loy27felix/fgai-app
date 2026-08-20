#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="check"
EXPORT_DIR=""
ENV_FILE="${ENV_FILE:-$PROJECT_ROOT/.env.local}"

usage() {
  printf '%s\n' \
    "用法 / Usage:" \
    "  $0 --source <导出目录> --check" \
    "  read -s IMPORT_PASSWORD && export IMPORT_PASSWORD" \
    "  $0 --source <导出目录> --apply" \
    "" \
    "--check  演练完整数据库重建并回滚，只预览 NAS 覆盖。" \
    "         Rehearse the database rebuild and only preview the NAS mirror." \
    "--apply  清空当前数据库，并使用导出目录镜像覆盖 NAS。" \
    "         Reset the current database and mirror the export onto the NAS."
}

fail() {
  printf '错误 / Error: %s\n' "$*" >&2
  exit 1
}

read_env_value() {
  local key="$1"
  local line
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"
  line="${line#*=}"
  line="${line%\"}"
  line="${line#\"}"
  line="${line%\'}"
  line="${line#\'}"
  printf '%s' "$line"
}

while (($#)); do
  case "$1" in
    --source)
      (($# >= 2)) || fail "--source 缺少目录"
      EXPORT_DIR="$2"
      shift 2
      ;;
    --check)
      MODE="check"
      shift
      ;;
    --apply)
      MODE="apply"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "不支持的参数：$1"
      ;;
  esac
done

[[ -n "$EXPORT_DIR" ]] || fail "必须通过 --source 指定 Supabase 导出目录"
[[ -d "$EXPORT_DIR" ]] || fail "导出目录不存在：$EXPORT_DIR"
[[ -f "$ENV_FILE" ]] || fail "环境文件不存在：$ENV_FILE"

EXPORT_DIR="$(cd "$EXPORT_DIR" && pwd -P)"
DATA_JSON="$EXPORT_DIR/database/public-data.json"
MANIFEST_JSON="$EXPORT_DIR/database/public-data-manifest.json"
STORAGE_SOURCE="$EXPORT_DIR/storage"
[[ -s "$DATA_JSON" ]] || fail "数据库 JSON 导出为空：$DATA_JSON"
[[ -s "$MANIFEST_JSON" ]] || fail "数据库 manifest 为空：$MANIFEST_JSON"
[[ -d "$STORAGE_SOURCE" ]] || fail "Storage 导出目录不存在：$STORAGE_SOURCE"

command -v node >/dev/null 2>&1 || fail "缺少 node 命令"
command -v rsync >/dev/null 2>&1 || fail "缺少 rsync 命令"

DATABASE_URL="${DATABASE_URL:-$(read_env_value DATABASE_URL)}"
[[ -n "$DATABASE_URL" ]] || fail "DATABASE_URL 未配置"
export DATABASE_URL

# Rehearse field conversion and every foreign key before touching the NAS.
# 在写入 NAS 前演练字段转换和全部外键关系。
node "$PROJECT_ROOT/scripts/import-supabase-data.mjs" --source "$EXPORT_DIR" --check

NAS_MEDIA_PATH="${NAS_MEDIA_PATH:-$(read_env_value NAS_MEDIA_PATH)}"
[[ -n "$NAS_MEDIA_PATH" ]] || fail "NAS_MEDIA_PATH 未配置"
[[ -d "$NAS_MEDIA_PATH" ]] || fail "NAS 目录不存在：$NAS_MEDIA_PATH"
NAS_MEDIA_PATH="$(cd "$NAS_MEDIA_PATH" && pwd -P)"
[[ "$NAS_MEDIA_PATH" != "/" ]] || fail "拒绝使用根目录作为 NAS_MEDIA_PATH"
[[ "$NAS_MEDIA_PATH" != "$PROJECT_ROOT" ]] || fail "拒绝使用项目目录作为 NAS_MEDIA_PATH"
[[ "$NAS_MEDIA_PATH" != "$EXPORT_DIR" ]] || fail "导出目录不能同时作为 NAS 目标目录"
[[ -w "$NAS_MEDIA_PATH" ]] || fail "NAS 目录不可写：$NAS_MEDIA_PATH"

MOUNT_SOURCE="$(df -P "$NAS_MEDIA_PATH" | awk 'END { print $1 }')"
MOUNT_LINE="$(mount | awk -v source="$MOUNT_SOURCE" 'index($0, source " on ") == 1 { print; exit }')"
[[ -n "$MOUNT_LINE" ]] || fail "无法识别 NAS_MEDIA_PATH 所在的挂载点"
if [[ "$MOUNT_LINE" == *" type "* ]]; then
  FILESYSTEM_TYPE="$(sed -E 's/^.* type ([^ ]+) .*$/\1/' <<< "$MOUNT_LINE")"
else
  FILESYSTEM_TYPE="$(sed -E 's/^.*\(([^, )]+).*$/\1/' <<< "$MOUNT_LINE")"
fi
case "$FILESYSTEM_TYPE" in
  smbfs|nfs|nfs3|nfs4|cifs) ;;
  *) fail "NAS_MEDIA_PATH 当前文件系统为 ${FILESYSTEM_TYPE}，不是 SMB/NFS 挂载" ;;
esac

FILE_COUNT="$(find "$STORAGE_SOURCE" -type f ! -name '.DS_Store' | wc -l | tr -d ' ')"
[[ "$FILE_COUNT" -gt 0 ]] || fail "Storage 导出中没有媒体文件"
RSYNC_ARGS=(-a --delete --delete-excluded --checksum --omit-dir-times --exclude .DS_Store)

printf '预检 / Preflight: files=%s, NAS=%s (%s)\n' "$FILE_COUNT" "$NAS_MEDIA_PATH" "$FILESYSTEM_TYPE"
if [[ "$MODE" == "check" ]]; then
  printf '%s\n' "NAS 覆盖预览 / NAS mirror preview:"
  rsync -ni "${RSYNC_ARGS[@]}" "$STORAGE_SOURCE/" "$NAS_MEDIA_PATH/"
  exit 0
fi

[[ -n "${IMPORT_PASSWORD:-}" ]] || fail "--apply 必须通过 IMPORT_PASSWORD 设置导入账号的初始密码"
((${#IMPORT_PASSWORD} >= 8)) || fail "IMPORT_PASSWORD 至少需要 8 个字符"
export IMPORT_PASSWORD

printf '%s\n' "开始镜像覆盖 NAS / Mirroring export onto NAS..."
rsync "${RSYNC_ARGS[@]}" "$STORAGE_SOURCE/" "$NAS_MEDIA_PATH/"

printf '%s\n' "开始重建数据库 / Rebuilding database..."
node "$PROJECT_ROOT/scripts/import-supabase-data.mjs" --source "$EXPORT_DIR" --apply

VERIFY_OUTPUT="$(rsync -ni "${RSYNC_ARGS[@]}" "$STORAGE_SOURCE/" "$NAS_MEDIA_PATH/")"
[[ -z "$VERIFY_OUTPUT" ]] || fail "NAS 校验失败，重新执行同一条 --apply 命令即可恢复"
printf '%s\n' "导入完成 / Import completed: database reset, NAS files=$FILE_COUNT"
