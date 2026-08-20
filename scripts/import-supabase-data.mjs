#!/usr/bin/env node

import { randomBytes, scryptSync } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const { Client } = pg;
const args = process.argv.slice(2);
const sourceIndex = args.indexOf('--source');
const sourceDir = sourceIndex >= 0 ? args[sourceIndex + 1] : '';
const apply = args.includes('--apply');

if (!sourceDir || (!apply && !args.includes('--check'))) {
  throw new Error('用法 / Usage: import-supabase-data.mjs --source <目录> --check|--apply');
}
if (!process.env.DATABASE_URL && !process.env.PGHOST) {
  throw new Error('DATABASE_URL 或 PGHOST 未配置');
}
if (apply && (!process.env.IMPORT_PASSWORD || process.env.IMPORT_PASSWORD.length < 8)) {
  throw new Error('--apply 需要至少 8 个字符的 IMPORT_PASSWORD');
}

const dataPath = `${sourceDir}/database/public-data.json`;
const manifestPath = `${sourceDir}/database/public-data-manifest.json`;
const [exportData, manifest] = await Promise.all([
  readFile(dataPath, 'utf8').then(JSON.parse),
  readFile(manifestPath, 'utf8').then(JSON.parse),
]);

if (exportData.schema !== 'public' || manifest.schema !== 'public') {
  throw new Error('只支持 public schema 导出');
}
if (!exportData.tables || !Array.isArray(exportData.tables.profiles) || exportData.tables.profiles.length === 0) {
  throw new Error('导出缺少 profiles 数据');
}

const importOrder = [
  'profiles',
  'whitelist',
  'projects',
  'project_members',
  'project_join_requests',
  'episodes',
  'scenes',
  'shots',
  'subshots',
  'scripts',
  'script_versions',
  'assets',
  'generations',
  'ai_usage',
  'custom_presets',
  'chat_sessions',
  'canvases',
  'creator_workspaces',
  'creator_folders',
  'creator_sessions',
  'creator_messages',
  'creator_canvases',
  'creator_assets',
  'creator_generation_tasks',
  'generation_tasks',
  'ai_usage_ledger',
  'ai_usage_budgets',
];
const supportedTables = new Set(importOrder);

for (const [table, rows] of Object.entries(exportData.tables)) {
  if (!Array.isArray(rows)) throw new Error(`导出表 ${table} 不是数组`);
  const expected = manifest.tables?.[table];
  if (expected !== rows.length) throw new Error(`manifest 记录数不一致：${table}`);
  if (rows.length > 0 && !supportedTables.has(table)) {
    throw new Error(`本地 schema 不支持含数据的旧表：${table}`);
  }
}

const manifestTotal = Object.values(manifest.tables || {}).reduce((sum, count) => sum + count, 0);
if (manifest.total_rows !== manifestTotal) throw new Error('manifest 总记录数不一致');

async function assertMediaFile(bucket, storagePath, label) {
  if (!storagePath) return;
  const bucketRoot = path.resolve(sourceDir, 'storage', bucket);
  const filePath = path.resolve(bucketRoot, storagePath);
  if (!filePath.startsWith(`${bucketRoot}${path.sep}`)) throw new Error(`${label} 包含非法媒体路径`);
  await access(filePath).catch(() => {
    throw new Error(`${label} 引用的媒体文件不存在：${bucket}/${storagePath}`);
  });
}

for (const asset of exportData.tables.assets || []) {
  await assertMediaFile('project-assets', asset.storage_path, `assets.${asset.id}`);
}
for (const asset of exportData.tables.creator_assets || []) {
  await assertMediaFile('creator-assets', asset.storage_path, `creator_assets.${asset.id}`);
  await assertMediaFile('creator-assets', asset.thumbnail_path, `creator_assets.${asset.id}.thumbnail`);
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const password = apply ? process.env.IMPORT_PASSWORD : 'check-only-password';
const salt = randomBytes(16).toString('hex');
const passwordHash = `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
const client = process.env.DATABASE_URL
  ? new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10_000 })
  : new Client({ connectionTimeoutMillis: 10_000 });

function databaseTarget() {
  if (!process.env.DATABASE_URL) {
    return `${process.env.PGHOST}:${process.env.PGPORT || '5432'}/${process.env.PGDATABASE || ''}`;
  }
  try {
    const url = new URL(process.env.DATABASE_URL);
    return `${url.hostname}:${url.port || '5432'}${url.pathname}`;
  } catch {
    return 'DATABASE_URL';
  }
}

function rowsForTable(table) {
  const rows = exportData.tables[table] || [];
  if (table !== 'canvases') return rows;

  // Keep the newest legacy canvas for the local schema's unique project/scope/ref key.
  // 本地 schema 对项目画布键有唯一约束，因此保留旧数据中更新时间最新的版本。
  const newestByKey = new Map();
  for (const row of rows) {
    const key = `${row.project_id ?? ''}\u0000${row.scope ?? ''}\u0000${row.ref_key ?? ''}`;
    const current = newestByKey.get(key);
    if (!current || String(row.updated_at || row.created_at) > String(current.updated_at || current.created_at)) {
      newestByKey.set(key, row);
    }
  }
  return [...newestByKey.values()];
}

function normalizeRow(table, sourceRow) {
  const row = { ...sourceRow };
  if (table === 'episodes' && row.summary === undefined) row.summary = row.synopsis ?? null;
  if (table === 'project_join_requests' && row.requested_at === undefined) row.requested_at = row.created_at;
  if (table === 'whitelist' && row.created_at === undefined) row.created_at = row.requested_at;
  return row;
}

function encodeValue(value, dataType) {
  if (value === null || value === undefined) return value;
  if (dataType === 'json' || dataType === 'jsonb') return JSON.stringify(value);
  return value;
}

async function insertRows(table, rows, columnsByTable) {
  const targetColumns = columnsByTable.get(table);
  if (!targetColumns) throw new Error(`目标数据库缺少表：${table}`);

  for (const sourceRow of rows) {
    const row = normalizeRow(table, sourceRow);
    const columns = [];
    const values = [];

    for (const [column, meta] of targetColumns) {
      if (!(column in row) || row[column] === undefined) continue;
      if (meta.data_type === 'uuid' && row[column] !== null && !uuidPattern.test(String(row[column]))) {
        if (meta.column_default) continue;
        throw new Error(`${table}.${column} 不是有效 UUID`);
      }
      columns.push(column);
      values.push(encodeValue(row[column], meta.data_type));
    }

    if (columns.length === 0) continue;
    const quotedColumns = columns.map((column) => `"${column}"`).join(', ');
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
    await client.query(`insert into public."${table}" (${quotedColumns}) values (${placeholders})`, values);
  }
}

try {
  process.stdout.write(`PostgreSQL target: ${databaseTarget()}\n`);
  await client.connect();
} catch (error) {
  throw new Error(
    `无法连接 PostgreSQL (${databaseTarget()})：${error instanceof Error ? error.message : String(error)}`,
    { cause: error },
  );
}
try {
  const columnResult = await client.query(`
    select table_name, column_name, data_type, column_default
    from information_schema.columns
    where table_schema = 'public'
    order by table_name, ordinal_position
  `);
  const columnsByTable = new Map();
  for (const column of columnResult.rows) {
    if (!columnsByTable.has(column.table_name)) columnsByTable.set(column.table_name, new Map());
    columnsByTable.get(column.table_name).set(column.column_name, column);
  }

  await client.query('begin');
  await client.query(`
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
    restart identity cascade
  `);

  for (const profile of exportData.tables.profiles) {
    await client.query(
      `insert into public.app_users (id, email, password_hash, email_verified_at, created_at)
       values ($1, lower($2), $3, now(), $4)`,
      [profile.id, profile.email, passwordHash, profile.created_at],
    );
  }

  for (const table of importOrder) {
    if (table === 'projects') await client.query('alter table public.projects disable trigger projects_add_owner');
    await insertRows(table, rowsForTable(table), columnsByTable);
    if (table === 'projects') await client.query('alter table public.projects enable trigger projects_add_owner');
  }

  const counts = {};
  for (const table of importOrder) {
    const result = await client.query(`select count(*)::integer as count from public."${table}"`);
    counts[table] = result.rows[0].count;
    const expected = rowsForTable(table).length;
    if (counts[table] !== expected) throw new Error(`导入记录数不一致：${table}`);
  }

  if (apply) await client.query('commit');
  else await client.query('rollback');

  const totalRows = Object.values(counts).reduce((sum, count) => sum + count, 0);
  process.stdout.write(`${apply ? '数据库导入完成' : '数据库演练通过并已回滚'}：users=${counts.profiles}, projects=${counts.projects}, creator_assets=${counts.creator_assets}, total=${totalRows}\n`);
} catch (error) {
  await client.query('rollback').catch(() => {});
  throw error;
} finally {
  await client.end();
}
