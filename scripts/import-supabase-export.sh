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
    "--check  在事务中演练完整数据库重建并回滚，不修改数据库或 NAS。" \
    "         Rehearse the complete database rebuild in a transaction and roll it back." \
    "--apply  清空当前数据库，并使用导出目录镜像覆盖 NAS。" \
    "         Reset the current database and mirror the exported storage onto the NAS."
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
STORAGE_SOURCE="$EXPORT_DIR/storage"
DATA_SQL="$EXPORT_DIR/database/public-data.sql"
if [[ ! -f "$DATA_SQL" ]]; then
  DATA_SQL="$EXPORT_DIR/database/public-schema.sql"
fi

[[ -s "$DATA_SQL" ]] || fail "数据库导出为空：$DATA_SQL"
[[ -d "$STORAGE_SOURCE" ]] || fail "Storage 导出目录不存在：$STORAGE_SOURCE"

# Require a data-only COPY dump so schema, RLS and Supabase functions cannot replace the local schema.
# 只接受 data-only COPY dump，避免 Supabase schema、RLS 和函数覆盖本地结构。
grep -Eq '^COPY public\.[a-zA-Z_][a-zA-Z0-9_]*[[:space:](]' "$DATA_SQL" \
  || fail "SQL 不包含 COPY public.* 数据，请重新导出 data-only + use-copy 文件"
if grep -Eiq '^[[:space:]]*(CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE|BEGIN|COMMIT)[[:space:]]' "$DATA_SQL"; then
  fail "SQL 包含结构或写操作语句，只能使用 public schema 的 data-only COPY 导出"
fi
if grep -E '^COPY[[:space:]]' "$DATA_SQL" | grep -Evq '^COPY public\.'; then
  fail "SQL 包含 public 以外的 COPY 数据"
fi
grep -Eq '^COPY public\.profiles[[:space:](]' "$DATA_SQL" \
  || fail "SQL 缺少 public.profiles，无法重建本地账号"

ALLOWED_TABLES=(
  profiles whitelist projects project_members project_join_requests
  episodes scenes shots subshots scripts script_versions assets generations ai_usage
  custom_presets chat_sessions canvases creator_workspaces creator_folders creator_sessions
  creator_messages creator_canvases creator_assets creator_generation_tasks generation_tasks
  ai_usage_ledger ai_usage_budgets
)
declare -A ALLOWED_TABLE_SET=()
for table in "${ALLOWED_TABLES[@]}"; do
  ALLOWED_TABLE_SET["$table"]=1
done

while IFS= read -r table; do
  [[ -n "${ALLOWED_TABLE_SET[$table]:-}" ]] || fail "SQL 包含当前本地库不支持的表：public.$table"
done < <(sed -nE 's/^COPY public\.([a-zA-Z_][a-zA-Z0-9_]*).*/\1/p' "$DATA_SQL" | sort -u)

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
  *) fail "NAS_MEDIA_PATH 当前文件系统为 $FILESYSTEM_TYPE，不是 SMB/NFS 挂载" ;;
esac

command -v docker >/dev/null 2>&1 || fail "缺少 docker 命令"
command -v rsync >/dev/null 2>&1 || fail "缺少 rsync 命令"
command -v node >/dev/null 2>&1 || fail "缺少 node 命令"

POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-$(docker ps \
  --filter label=com.docker.compose.project=fgai-app \
  --filter label=com.docker.compose.service=postgres \
  --format '{{.Names}}' | head -n 1)}"
[[ -n "$POSTGRES_CONTAINER" ]] || fail "未找到 fgai-app PostgreSQL 容器"
docker inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1 || fail "PostgreSQL 容器不存在：$POSTGRES_CONTAINER"

FILE_COUNT="$(find "$STORAGE_SOURCE" -type f | wc -l | tr -d ' ')"
[[ "$FILE_COUNT" -gt 0 ]] || fail "Storage 导出中没有文件"

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/fg-studio-import.XXXXXX")"
cleanup() {
  find "$TEMP_DIR" -depth -delete
}
trap cleanup EXIT
TRANSFORMED_SQL="$TEMP_DIR/public-data-staged.sql"
sed -E 's/^COPY public\./COPY import_stage./' "$DATA_SQL" > "$TRANSFORMED_SQL"

if [[ "$MODE" == "apply" ]]; then
  [[ -n "${IMPORT_PASSWORD:-}" ]] || fail "--apply 必须通过 IMPORT_PASSWORD 设置导入账号的初始密码"
  ((${#IMPORT_PASSWORD} >= 8)) || fail "IMPORT_PASSWORD 至少需要 8 个字符"
else
  IMPORT_PASSWORD="check-only-password"
fi
export IMPORT_PASSWORD

PASSWORD_HASH="$(node <<'NODE'
const { randomBytes, scryptSync } = require('node:crypto');
const password = process.env.IMPORT_PASSWORD;
if (!password) process.exit(1);
const salt = randomBytes(16).toString('hex');
process.stdout.write(`${salt}:${scryptSync(password, salt, 64).toString('hex')}`);
NODE
)"

psql_container() {
  docker exec -i "$POSTGRES_CONTAINER" sh -lc \
    'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
}

emit_import_sql() {
  local finish_statement="$1"

  printf '%s\n' \
    'begin;' \
    'drop schema if exists import_stage cascade;' \
    'create schema import_stage;'

  for table in "${ALLOWED_TABLES[@]}"; do
    printf 'create unlogged table import_stage.%s (like public.%s including defaults);\n' "$table" "$table"
  done

  cat "$TRANSFORMED_SQL"

  cat <<SQL
do \$\$
begin
  if not exists (select 1 from import_stage.profiles) then
    raise exception 'public.profiles 没有数据';
  end if;
end
\$\$;

truncate table
  public.sessions, public.app_users, public.profiles, public.whitelist,
  public.projects, public.project_members, public.project_join_requests,
  public.episodes, public.scenes, public.shots, public.subshots,
  public.scripts, public.script_versions, public.assets, public.generations,
  public.ai_usage, public.custom_presets, public.chat_sessions, public.canvases,
  public.creator_workspaces, public.creator_folders, public.creator_sessions,
  public.creator_messages, public.creator_canvases, public.creator_assets,
  public.creator_generation_tasks, public.generation_tasks,
  public.ai_usage_ledger, public.ai_usage_budgets
restart identity cascade;

insert into public.app_users (id, email, password_hash, email_verified_at, created_at)
select id, lower(email), '$PASSWORD_HASH', now(), created_at
from import_stage.profiles;

insert into public.profiles select * from import_stage.profiles;
insert into public.whitelist select * from import_stage.whitelist;

alter table public.projects disable trigger projects_add_owner;
insert into public.projects select * from import_stage.projects;
alter table public.projects enable trigger projects_add_owner;

insert into public.project_members select * from import_stage.project_members;
insert into public.project_join_requests select * from import_stage.project_join_requests;
insert into public.episodes select * from import_stage.episodes;
insert into public.scenes select * from import_stage.scenes;
insert into public.shots select * from import_stage.shots;
insert into public.subshots select * from import_stage.subshots;
insert into public.scripts select * from import_stage.scripts;
insert into public.script_versions select * from import_stage.script_versions;
insert into public.assets select * from import_stage.assets;
insert into public.generations select * from import_stage.generations;
insert into public.ai_usage select * from import_stage.ai_usage;
insert into public.custom_presets select * from import_stage.custom_presets;
insert into public.chat_sessions select * from import_stage.chat_sessions;
insert into public.canvases select * from import_stage.canvases;
insert into public.creator_workspaces select * from import_stage.creator_workspaces;
insert into public.creator_folders select * from import_stage.creator_folders;
insert into public.creator_sessions select * from import_stage.creator_sessions;
insert into public.creator_messages select * from import_stage.creator_messages;
insert into public.creator_canvases select * from import_stage.creator_canvases;
insert into public.creator_assets select * from import_stage.creator_assets;
insert into public.creator_generation_tasks select * from import_stage.creator_generation_tasks;
insert into public.generation_tasks select * from import_stage.generation_tasks;
insert into public.ai_usage_ledger select * from import_stage.ai_usage_ledger;
insert into public.ai_usage_budgets select * from import_stage.ai_usage_budgets;

select 'profiles=' || count(*) from public.profiles;
select 'projects=' || count(*) from public.projects;
select 'creator_assets=' || count(*) from public.creator_assets;
select 'creator_generation_tasks=' || count(*) from public.creator_generation_tasks;

drop schema import_stage cascade;
$finish_statement;
SQL
}

printf '预检 / Preflight: SQL=%s, files=%s, NAS=%s (%s), DB=%s\n' \
  "$DATA_SQL" "$FILE_COUNT" "$NAS_MEDIA_PATH" "$FILESYSTEM_TYPE" "$POSTGRES_CONTAINER"

# Rehearse the destructive database path first; rollback guarantees no target data changes.
# 先完整演练破坏性数据库流程，并通过 rollback 保证目标数据不发生变化。
emit_import_sql rollback | psql_container

if [[ "$MODE" == "check" ]]; then
  printf '%s\n' "检查通过 / Check passed: 数据库事务已回滚，NAS 未修改。"
  printf '%s\n' "NAS 覆盖预览 / NAS mirror preview:"
  rsync -ani --delete --checksum --omit-dir-times "$STORAGE_SOURCE/" "$NAS_MEDIA_PATH/"
  exit 0
fi

printf '%s\n' "开始镜像覆盖 NAS / Mirroring export onto NAS..."
rsync -a --delete --checksum --omit-dir-times "$STORAGE_SOURCE/" "$NAS_MEDIA_PATH/"

printf '%s\n' "开始重建数据库 / Rebuilding database..."
emit_import_sql commit | psql_container

VERIFY_OUTPUT="$(rsync -ani --delete --checksum --omit-dir-times "$STORAGE_SOURCE/" "$NAS_MEDIA_PATH/")"
[[ -z "$VERIFY_OUTPUT" ]] || fail "NAS 校验失败，重新执行同一条 --apply 命令即可恢复"

printf '%s\n' "导入完成 / Import completed: database reset, NAS files=$FILE_COUNT"
