import { loadEnvConfig } from '@next/env';
import { Pool } from 'pg';
import { supportEnvironment, assertSupportTarget, assertSupportDatabaseEnvironment } from '../lib/support-bot/environment';

loadEnvConfig(process.cwd());

type Probe = { ready: boolean; reason: string; [key: string]: unknown };
async function database(value: string | undefined, tables: string[], readOnly: boolean): Promise<Probe> {
  if (!value) return { ready: false, reason: 'not_configured' };
  let pool: Pool | undefined;
  try {
    assertSupportTarget(value, 'database');
    pool = new Pool({ connectionString: value, max: 1, connectionTimeoutMillis: 2000, statement_timeout: 3000 });
    const client = await pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      await assertSupportDatabaseEnvironment(client);
      const result = await client.query<{ name: string; readable: boolean; writable: boolean }>(`SELECT name,
        CASE WHEN to_regclass(name) IS NOT NULL THEN has_table_privilege(current_user, name, 'SELECT') ELSE false END AS readable,
        CASE WHEN to_regclass(name) IS NOT NULL THEN has_table_privilege(current_user, name, 'INSERT,UPDATE,DELETE,TRUNCATE') ELSE false END AS writable
        FROM unnest($1::text[]) name`, [tables]);
      const missing = result.rows.filter(row => !row.readable).map(row => row.name);
      if (!missing.length && tables.includes('support_bot_jobs')) await client.query('SELECT id, images, context, stage, progress, feedback_rating, feedback_correction, feedback_updated_at FROM support_bot_jobs LIMIT 0');
      if (!missing.length && tables.includes('api_call_logs') && tables.includes('task_logs')) {
        // Effect diagnostics need historical submission columns, not just readable task-status tables.
        // 效果异常排查需要历史提交字段，不能仅因状态表可读就认定取证就绪。
        try {
          await client.query('SELECT id, user_id, project_id, request_id, trace_id, provider_request_id, status, type, model, created_at, updated_at, input_json, prompt FROM tasks LIMIT 0');
          await client.query('SELECT id, user_id, task_id, request_id, trace_id, provider_request_id, request_kind, status, status_code, request_body, response_body, created_at FROM api_call_logs LIMIT 0');
        } catch { return { ready: false, reason: 'generation_schema_or_select_grant_missing' }; }
      }
      const writable = readOnly && result.rows.some(row => row.writable);
      return { ready: !missing.length && !writable, reason: missing.length ? 'schema_or_select_grant_missing' : writable ? 'source_role_not_read_only' : 'environment_and_schema_verified', missing };
    } finally { await client.query('ROLLBACK').catch(() => undefined); client.release(); }
  } catch { return { ready: false, reason: 'environment_connection_or_schema_failed' }; }
  finally { await pool?.end(); }
}

async function main() {
  const environment = supportEnvironment();
  const { supportServices, supportServiceId } = await import('../lib/support-bot/services');
  const { isNativeProduct, probeProductNative } = await import('../lib/support-bot/product-native');
  const probeUser = process.env.SUPPORT_BOT_NATIVE_PROBE_USER_ID;
  const probeRange = { from: process.env.SUPPORT_BOT_NATIVE_PROBE_FROM || undefined, to: process.env.SUPPORT_BOT_NATIVE_PROBE_TO || undefined };
  const { probeSupportNativeLogs } = await import('../lib/support-bot/native-logs');
  const { captureSupportRuntime, resolveSupportRuntime } = await import('../lib/support-bot/runtime');
  const services = Object.keys(supportServices).filter(id => !['infrastructure', 'repository'].includes(id)) as Array<keyof typeof supportServices>;
  const requested = process.argv.find(arg => arg.startsWith('--require='))?.slice('--require='.length).split(',') ?? services;
  if (!requested.length || requested.some(id => !supportServiceId(id) || !services.includes(id as keyof typeof supportServices))) throw new Error('Invalid required services');
  const fg = await database(process.env.DATABASE_URL, ['support_bot_jobs', 'support_bot_tickets', 'observability_log_events', 'observability_error_events', 'observability_service_events', 'audit_events'], false);
  const { SUPPORT_CANVAS_ASSET_TABLES } = await import('../lib/support-bot/canvas-assets');
  const canvas = await database(process.env.SUPPORT_BOT_CANVAS_DATABASE_URL, ['fg_accounts', 'users', 'projects', 'canvas_projects', 'tasks', 'task_logs', 'api_call_logs', 'drama_jobs', 'drama_productions', ...SUPPORT_CANVAS_ASSET_TABLES], true);
  const gateway = await database(process.env.SUPPORT_BOT_CANVAS_DATABASE_URL, ['fg_accounts', 'users', 'projects', 'canvas_projects', 'tasks', 'fg_music_jobs', 'fg_speech_jobs', 'fg_speech_usage', 'fg_creator_jobs', 'fg_adcraft_jobs', 'fg_adcraft_workspaces', 'fg_meilin_calls', 'fg_meilin_projects', 'fg_budget_reservations'], true);
  const production = await database(process.env.SUPPORT_BOT_PRODUCTION_LAB_DATABASE_URL || process.env.PRODUCTION_LAB_DATABASE_URL,
    ['production_lab_state', 'production_lab_media_jobs', 'production_lab_media_job_events', 'production_lab_script_runs'], true);
  const snapshot = await captureSupportRuntime();
  const fgRuntime = await resolveSupportRuntime(snapshot, 'fg');
  const matrix: Record<string, unknown>[] = [];
  for (const service of services) {
    const fgService = ['fg', 'production-lab'].includes(service);
    const resolution = fgService ? fgRuntime : await resolveSupportRuntime(undefined, service, probeUser);
    const runtime = fgService ? { connected: fgRuntime.verified, environment: snapshot.environment, reason: fgRuntime.evidence.reason }
      : resolution.evidence.nativeRuntime!;
    const availability = resolution.evidence.sourceAvailability;
    const source = { ...availability, ready: availability?.available === true,
      reason: availability?.reason || resolution.evidence.reason, description: resolution.evidence.description,
      workerCheckout: resolution.evidence.workerCheckout ?? snapshot.checkoutRevision, paths: supportServices[service].paths };
    const product = isNativeProduct(service) ? await probeProductNative(service, probeUser, probeRange) : undefined;
    const logs = product || (['fg', 'production-lab'].includes(service) ? fg : supportServices[service].data === 'browser'
      ? { ready: true, reason: 'browser_has_no_native_business_log; inspect_gateway_and_canvas' } : await probeSupportNativeLogs(service));
    const data = product || (service === 'fg' ? fg : service === 'production-lab' ? production
      : service === 'yingce-gateway' ? gateway : ['canvas', 'yingce-agent'].includes(service) ? canvas
      : supportServices[service].data === 'browser' ? { ready: true, reason: 'browser_has_no_business_database' }
      : { ready: false, reason: 'native_source_not_configured' });
    const versionReady = source.ready && runtime.connected && (!isNativeProduct(service) || ('identityVerified' in runtime && runtime.identityVerified === true)) && runtime.environment === (environment === 'local' ? 'development' : 'production')
      && (environment === 'local' || ['fg', 'production-lab'].includes(service) || resolution.verified);
    matrix.push({ service, required: requested.includes(service), ready: !!(fg.ready && data.ready && logs.ready && versionReady), data, logs, runtime, source });
  }
  // A browser-only check must not pass while its required backend evidence sources are disconnected.
  // 网页自身不需要业务库，但验收不能跳过其实际依赖的后端数据源。
  for (const row of matrix) if (row.required && row.service === 'yingce-web') {
    const dependencies = supportServices['yingce-web'].dependencies.map(service => matrix.find(item => item.service === service));
    row.ready = row.ready && dependencies.every(item => item?.ready === true);
    row.dataDependencies = dependencies.map(item => ({ service: item?.service, ready: item?.ready === true }));
  }
  const ready = matrix.every(row => !row.required || row.ready);
  console.log(JSON.stringify({ environment, ready, matrix, note: 'Configuration/source readiness only; product instances are checked for the configured probe actor, not all users. Empty data is not E2E proof; development builds are reference-only. No model requests, job claiming, or external notifications.' }, null, 2));
  if (!ready) process.exitCode = 1;
}
main().catch(() => { console.error('support-bot preflight failed: check environment configuration and --require service names'); process.exitCode = 1; });
