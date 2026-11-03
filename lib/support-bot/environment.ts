import type { QueryResult, QueryResultRow } from 'pg';

export class SupportEnvironmentError extends Error {
  constructor(readonly reason: string) { super(reason); this.name = 'SupportEnvironmentError'; }
}

export function supportEnvironment(): 'local' | 'production' {
  const environment = process.env.SUPPORT_BOT_ENVIRONMENT;
  if (environment !== 'local' && environment !== 'production') throw new SupportEnvironmentError('support_environment_not_configured');
  if (environment === 'production' && process.env.NODE_ENV !== 'production') throw new SupportEnvironmentError('support_environment_process_mismatch');
  if (environment === 'local' && process.env.SUPPORT_BOT_SEND_ENABLED === 'true') throw new SupportEnvironmentError('support_local_external_delivery_forbidden');
  return environment;
}

export function assertSupportTarget(value: string, kind: 'database' | 'runtime'): URL {
  const environment = supportEnvironment();
  let url: URL;
  try { url = new URL(value); } catch { throw new SupportEnvironmentError('support_source_url_invalid'); }
  const protocols = kind === 'database' ? ['postgres:', 'postgresql:'] : ['http:', 'https:'];
  if (!protocols.includes(url.protocol) || !url.hostname || url.hash) throw new SupportEnvironmentError('support_source_url_invalid');
  if (kind === 'database' && (!url.pathname.slice(1) || [...url.searchParams.keys()].some(key => !['sslmode', 'sslrootcert', 'sslcert', 'sslkey'].includes(key)))) {
    throw new SupportEnvironmentError('support_database_target_ambiguous');
  }
  if (kind === 'runtime' && (url.username || url.password || url.search)) throw new SupportEnvironmentError('support_source_url_invalid');
  if (environment === 'local' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname.toLowerCase())) {
    throw new SupportEnvironmentError('support_local_remote_source_forbidden');
  }
  return url;
}

// Inspect the database-level marker, not current_setting(): URL/role/session options can override it.
// 核验数据库级标记而非会被连接参数、角色或会话覆盖的 current_setting()，防止本地隧道误接生产库。
export async function assertSupportDatabaseEnvironment(db: { query: <T extends QueryResultRow>(text: string) => Promise<QueryResult<T>> }): Promise<void> {
  const expected = supportEnvironment();
  const result = await db.query<{ environment: string }>(`SELECT split_part(setting, '=', 2) AS environment
    FROM pg_catalog.pg_db_role_setting s
    JOIN pg_catalog.pg_database d ON d.oid = s.setdatabase
    CROSS JOIN LATERAL unnest(s.setconfig) AS setting
    WHERE d.datname = current_database() AND s.setrole = 0
      AND split_part(setting, '=', 1) = 'fg.support_environment'`);
  if (result.rows.length !== 1 || result.rows[0].environment !== expected) throw new SupportEnvironmentError('support_database_environment_mismatch');
}

export async function assertSupportPrimaryEnvironment() {
  assertSupportTarget(process.env.DATABASE_URL || '', 'database');
  const { query } = await import('@/lib/local/db');
  await assertSupportDatabaseEnvironment({ query });
}

export function supportRuntimeEnvironment() {
  return supportEnvironment() === 'local' ? 'development' : 'production';
}
