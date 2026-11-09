import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const help = `离线 FG -> native 账号迁移（不会导入 browser sessions）

用法：node migrate-platform-accounts.mjs [--dry-run | --apply]
      node migrate-platform-accounts.mjs --help

必填环境变量（无默认值，不加载 .env）：
  SOURCE_FG_DATABASE_URL      源 FG PostgreSQL URL；请使用仅 SELECT 权限账号
  TARGET_NATIVE_DATABASE_URL  目标 native PostgreSQL URL；必须是不同数据库
两个 URL 均须显式包含 host、database、username，仅支持 postgres/postgresql。
连接后还会核对服务器/数据库身份，不能用别名或不同账号绕过同库检查。

默认 --dry-run：两个数据库均只读事务，仅输出计数和冲突类型，不输出身份、密码或 URL。
--apply：仅在有明确授权的离线维护窗口，对已备份的数据库执行；源保持只读快照，
目标先锁定 users/fg_accounts，再在一个事务内重新检查并写入；任何冲突全部拒绝。
连接/锁等待限时 5 秒，单条 SQL 限时 60 秒；失败不自动重试。

支持仓库 docker/initdb/001-local.sql 的 app_users/profiles 结构；源字段增减时
拒绝执行，尤其不能忽略新增的 status/disabled/deleted 字段。源现有结构无账号状态。
source superadmin -> native admin，user/member/admin -> native user，与现桥接合同一致；
未知或缺失角色、缺失 profile、profile 邮箱不同、跨 UUID 的邮箱/用户名交叉冲突均拒绝。
已有 native ID 可为 32hex 或 36UUID；只新增源 app_users 的 UUID，不重映射资源 owner。
已有 native role 必须匹配，fg_accounts 既有 platform_role 必须匹配；不会升降既有权限。
已有 native status 必须为 active/disabled，并原样保留；不会复活 disabled 账号。
新账号使用源 UUID 和确定性 fg_ 用户名，status=active（源无 status）；不改其他账号。
新账号保留源创建时间与邮箱验证时间；既有 native 邮箱验证状态不变。
只补空的 native email/password_hash；保留已有 username、验证状态和非空密码。
保留非空 native 密码的账号须继续使用原 native 密码，不保证其 FG 密码可登录。
只接受固定 32hex:128hex 的源密码，写为 fg-scrypt$32hex:128hex。
Go 验证固定 scrypt N=16384,r=8,p=1，salt 是 hex 文本；bcrypt 保持原样。
不会登录后自动转 bcrypt：现 repository 无密码 CAS 升级接口，旧密码可超过 72 bytes，
不能以 bcrypt 截断/失败锁住用户；用户主动改密仍走既有 native 密码流程。

输出 counts 为迁移计划计数；conflicts 为冲突类型及次数，非账号清单。
退出码：0=只读检查成功/事务提交成功，2=存在冲突（无写入），1=参数/数据库错误。
不修改 session、owner、钱包或资源；新账号钱包等初始化沿用 native 既有登录流程。
apply 前必须准备并验证目标完整备份，冻结源写入并确认旧桥接不会覆盖 status/role。
源只读快照与目标提交不是分布式事务；提交后源改密/角色变更不会自动同步。
回滚边界：提交前失败由事务回滚；提交后恢复已验证的目标备份，不删除账号或记录。
若 COMMIT 后连接中断，提交结果可能不确定：先只读核验，禁止盲目自动重试。
本工具不执行备份/恢复、不启停任何服务、不销毁数据；不会自动识别生产环境，
操作者必须仅提供经授权的离线数据库副本，不能把生产 URL 当作本地验证目标。
`;

const sourceColumns = {
  app_users: ['id', 'email', 'password_hash', 'email_verified_at', 'created_at'],
  profiles: ['id', 'email', 'platform_role', 'created_at'],
};
const targetColumns = {
  users: ['id', 'username', 'email', 'email_verified_at', 'display_name', 'role', 'status', 'password_hash', 'created_at', 'updated_at'],
  fg_accounts: ['user_id', 'email', 'platform_role'],
};
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const nativeID = /^(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;
const fgHash = /^[0-9a-f]{32}:[0-9a-f]{128}$/i;
const nativeRoles = new Map([['superadmin', 'admin'], ['user', 'user'], ['member', 'user'], ['admin', 'user']]);
const safeErrors = new Set(['SOURCE_FG_DATABASE_URL_INVALID', 'TARGET_NATIVE_DATABASE_URL_INVALID',
  'SOURCE_TARGET_SAME_DATABASE', 'SOURCE_SCHEMA_MISMATCH', 'TARGET_SCHEMA_MISMATCH',
  'DATABASE_IDENTITY_UNAVAILABLE', 'TARGET_USER_CHANGED']);
const normalize = value => typeof value === 'string' ? value.trim().toLowerCase() : '';

function sameHash(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

// 计划阶段不访问数据库，冲突只计数，不泄露账号或密码。
// Planning is database-free; conflicts contain counts, never identities or credentials.
export function planAccountMigration(source, users, accounts) {
  const conflicts = {};
  const conflict = reason => { conflicts[reason] = (conflicts[reason] || 0) + 1; };
  const counts = { source: source.length, createUsers: 0, existingUsers: 0, fillPasswords: 0,
    preservePasswords: 0, alreadyImportedPasswords: 0, fillEmails: 0, preserveDisabled: 0,
    createAccountLinks: 0, existingAccountLinks: 0 };
  const byID = new Map();
  const links = new Map();
  const aliases = new Map();
  const sourceIDs = new Set();
  const operations = [];
  const addAlias = (value, id) => {
    const alias = normalize(value);
    if (!alias) return;
    const owners = aliases.get(alias) || new Set();
    owners.add(id);
    aliases.set(alias, owners);
  };
  for (const user of users) {
    if (typeof user.id !== 'string' || ![32, 36].includes(user.id.length) || !nativeID.test(user.id) || byID.has(user.id)) conflict('invalid_native_identity');
    byID.set(user.id, user);
    addAlias(user.username, user.id);
    addAlias(user.email, user.id);
  }
  for (const account of accounts) {
    if (!byID.has(account.user_id) || links.has(account.user_id)) conflict('invalid_native_account_link');
    links.set(account.user_id, account);
    addAlias(account.email, account.user_id);
  }
  for (const owners of aliases.values()) {
    if (owners.size > 1) conflict('existing_native_alias_collision');
  }
  for (const row of source) {
    const email = normalize(row.email);
    const role = nativeRoles.get(row.platform_role);
    if (typeof row.id !== 'string' || row.id.length !== 36 || !uuid.test(row.id) || sourceIDs.has(row.id)) {
      conflict('invalid_source_identity');
      continue;
    }
    sourceIDs.add(row.id);
    if (!email || email !== row.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || [...email].length > 160) {
      conflict('invalid_source_email');
      continue;
    }
    if (row.profile_id !== row.id || normalize(row.profile_email) !== email || !role) {
      conflict('invalid_source_profile_or_role');
      continue;
    }
    if (typeof row.password_hash !== 'string' || row.password_hash.length !== 161 || !fgHash.test(row.password_hash)) {
      conflict('invalid_source_password_format');
      continue;
    }
    const createdAt = new Date(row.created_at);
    if (!row.created_at || !Number.isFinite(createdAt.getTime())) {
      conflict('invalid_source_created_at');
      continue;
    }
    const emailVerifiedAt = row.email_verified_at ?? null;
    if (emailVerifiedAt !== null && !Number.isFinite(new Date(emailVerifiedAt).getTime())) {
      conflict('invalid_source_email_verified_at');
      continue;
    }
    const user = byID.get(row.id);
    const link = links.get(row.id);
    const username = user ? user.username : 'fg_' + row.id.replaceAll('-', '').slice(0, 29);
    if (!username || typeof username !== 'string' || username.trim() !== username) conflict('invalid_native_username');
    for (const alias of new Set([email, normalize(username)])) {
      if ([...(aliases.get(alias) || [])].some(id => id !== row.id)) conflict('account_alias_owned_by_another_id');
      addAlias(alias, row.id);
    }
    if (user) {
      counts.existingUsers++;
      if (user.role !== role) conflict('native_role_mismatch');
      if (!['active', 'disabled'].includes(user.status)) conflict('unknown_native_status');
      if (user.status === 'disabled') counts.preserveDisabled++;
      if (user.email && normalize(user.email) !== email) conflict('native_email_mismatch');
      if (user.password_hash != null && typeof user.password_hash !== 'string') conflict('invalid_native_password_type');
    } else counts.createUsers++;
    if (link) {
      counts.existingAccountLinks++;
      if (normalize(link.email) !== email) conflict('native_account_email_mismatch');
      if (link.platform_role !== row.platform_role) conflict('native_platform_role_mismatch');
    } else counts.createAccountLinks++;
    const password = 'fg-scrypt$' + row.password_hash;
    const fillPassword = !user?.password_hash;
    const fillEmail = !user?.email;
    if (fillPassword) counts.fillPasswords++;
    else {
      counts.preservePasswords++;
      if (typeof user.password_hash === 'string' && sameHash(user.password_hash, password)) counts.alreadyImportedPasswords++;
    }
    if (fillEmail) counts.fillEmails++;
    operations.push({ id: row.id, email, username, role, platformRole: row.platform_role,
      password, createdAt: row.created_at, emailVerifiedAt, create: !user, fillPassword, fillEmail, createLink: !link });
  }
  return { counts, conflicts, operations };
}

function databaseURL(value, name) {
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || url.pathname.length < 2) throw new Error();
    // 禁止 query 参数重写连接身份或 search_path；只允许明确的 TLS 配置。
    // Prevent query parameters from overriding identity or search_path; allow explicit TLS settings only.
    for (const key of url.searchParams.keys()) {
      if (!['sslmode', 'sslcert', 'sslkey', 'sslrootcert'].includes(key)) throw new Error();
    }
    return url;
  } catch {
    throw new Error(name + '_INVALID');
  }
}

async function checkSchema(client, expected, exact) {
  const { rows } = await client.query(`SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name=ANY($1::text[])`, [Object.keys(expected)]);
  for (const [table, required] of Object.entries(expected)) {
    const actual = rows.filter(row => row.table_name === table).map(row => row.column_name);
    if (required.some(column => !actual.includes(column)) || (exact && actual.length !== required.length)) {
      throw new Error(exact ? 'SOURCE_SCHEMA_MISMATCH' : 'TARGET_SCHEMA_MISMATCH');
    }
  }
}

async function databaseIdentity(client) {
  const { rows: [identity] } = await client.query(`SELECT current_database() AS name,
    (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid,
    inet_server_addr()::text AS address, inet_server_port() AS port,
    extract(epoch FROM pg_postmaster_start_time())::text AS started_at`);
  if (!identity?.name || !identity.oid || !identity.address || !identity.port || !identity.started_at) {
    throw new Error('DATABASE_IDENTITY_UNAVAILABLE');
  }
  return identity;
}

async function writePlan(target, operations) {
  for (const op of operations) {
    if (op.create) {
      await target.query(`INSERT INTO public.users
        (id,username,email,display_name,role,status,password_hash,created_at,email_verified_at,updated_at)
        VALUES($1,$2,$3,$4,$5,'active',$6,$7,$8,now())`,
      [op.id, op.username, op.email, op.email.split('@')[0].slice(0, 80), op.role, op.password, op.createdAt, op.emailVerifiedAt]);
    } else if (op.fillPassword || op.fillEmail) {
      // 只补空值，不写 role/status 或旧密码；表锁覆盖检查到提交之间的并发写入。
      // Fill blanks only, never role/status or existing passwords; table locks cover checks through commit.
      const result = await target.query(`UPDATE public.users SET
        email=CASE WHEN COALESCE(email,'')='' THEN $2 ELSE email END,
        password_hash=CASE WHEN COALESCE(password_hash,'')='' THEN $3 ELSE password_hash END,
        updated_at=now() WHERE id=$1`, [op.id, op.email, op.password]);
      if (result.rowCount !== 1) throw new Error('TARGET_USER_CHANGED');
    }
    if (op.createLink) {
      await target.query('INSERT INTO public.fg_accounts(user_id,email,platform_role) VALUES($1,$2,$3)',
        [op.id, op.email, op.platformRole]);
    }
  }
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log(help);
    return;
  }
  if (args.length > 1 || (args.length === 1 && !['--dry-run', '--apply'].includes(args[0]))) {
    console.error('INVALID_ARGUMENTS: use --help');
    process.exitCode = 1;
    return;
  }
  const apply = args[0] === '--apply';
  const clients = [];
  const transactions = new Set();
  let stage = 'configuration';
  let committing = false;
  try {
    const sourceURL = databaseURL(process.env.SOURCE_FG_DATABASE_URL, 'SOURCE_FG_DATABASE_URL');
    const targetURL = databaseURL(process.env.TARGET_NATIVE_DATABASE_URL, 'TARGET_NATIVE_DATABASE_URL');
    if (normalize(sourceURL.hostname) === normalize(targetURL.hostname) &&
        (sourceURL.port || '5432') === (targetURL.port || '5432') &&
        decodeURIComponent(sourceURL.pathname) === decodeURIComponent(targetURL.pathname)) {
      throw new Error('SOURCE_TARGET_SAME_DATABASE');
    }
    const { default: pg } = await import('pg');
    const source = new pg.Client({ connectionString: sourceURL.href, connectionTimeoutMillis: 5000,
      application_name: 'fg-account-migration-source' });
    const target = new pg.Client({ connectionString: targetURL.href, connectionTimeoutMillis: 5000,
      application_name: 'fg-account-migration-target' });
    for (const [client, name] of [[source, 'source'], [target, 'target']]) {
      stage = name + '_connect';
      clients.push(client);
      // 不输出异步连接异常的原始内容，以免泄露连接参数或账号。
      // Never print raw asynchronous connection errors, which may expose connection or account data.
      client.on('error', () => {});
      await client.connect();
      stage = name + '_transaction';
      await client.query(client === target && apply ? 'BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      transactions.add(client);
      await client.query("SET LOCAL statement_timeout='60s'");
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout='120s'");
      await client.query('SET LOCAL search_path=pg_catalog,public');
    }
    stage = 'database_identity';
    const a = await databaseIdentity(source);
    const b = await databaseIdentity(target);
    if (a.name === b.name && a.oid === b.oid &&
        ((a.address === b.address && a.port === b.port) || a.started_at === b.started_at)) {
      throw new Error('SOURCE_TARGET_SAME_DATABASE');
    }
    stage = 'schema_check';
    await checkSchema(source, sourceColumns, true);
    await checkSchema(target, targetColumns, false);
    if (apply) {
      stage = 'target_lock';
      await target.query('LOCK TABLE public.users, public.fg_accounts IN SHARE ROW EXCLUSIVE MODE');
    }
    stage = 'read_accounts';
    const sourceRows = (await source.query(`SELECT u.id::text,u.email,u.password_hash,
      u.created_at::text AS created_at,u.email_verified_at::text AS email_verified_at,
      p.id::text AS profile_id,p.email AS profile_email,p.platform_role
      FROM public.app_users u LEFT JOIN public.profiles p ON p.id=u.id ORDER BY u.id`)).rows;
    const users = (await target.query('SELECT id,username,email,role,status,password_hash FROM public.users ORDER BY id')).rows;
    const accounts = (await target.query('SELECT user_id,email,platform_role FROM public.fg_accounts ORDER BY user_id')).rows;
    const { counts, conflicts, operations } = planAccountMigration(sourceRows, users, accounts);
    const report = { mode: apply ? 'apply' : 'dry-run', counts, conflicts };
    if (Object.keys(conflicts).length) {
      console.log(JSON.stringify({ ...report, outcome: 'conflicts_no_writes' }, null, 2));
      process.exitCode = 2;
      return;
    }
    if (!apply) {
      console.log(JSON.stringify({ ...report, outcome: 'dry_run_no_writes' }, null, 2));
      return;
    }
    stage = 'target_write';
    await writePlan(target, operations);
    stage = 'target_commit';
    committing = true;
    await target.query('COMMIT');
    transactions.delete(target);
    committing = false;
    console.log(JSON.stringify({ ...report, outcome: 'committed' }, null, 2));
  } catch (error) {
    const reason = safeErrors.has(error.message) ? error.message : 'DATABASE_OR_CONFIGURATION_ERROR';
    const code = /^[A-Z0-9]{5}$/.test(error.code || '') ? error.code : undefined;
    console.error(JSON.stringify({ outcome: committing ? 'commit_outcome_unknown_verify_before_retry' : 'failed_no_commit', stage, reason, code }));
    process.exitCode = 1;
  } finally {
    for (const client of transactions) {
      try { await client.query('ROLLBACK'); } catch { /* 连接已断开时不输出原始异常。 / Do not expose raw disconnect errors. */ }
    }
    for (const client of clients) {
      try { await client.end(); } catch { /* 清理连接不泄露凭据。 / Connection cleanup must not leak credentials. */ }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
