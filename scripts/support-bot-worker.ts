import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());
async function main() {
  const {closeDb}=await import('../lib/local/db');
  try {
    if (process.argv.includes('--check')) {
      const { ensureSupportSchema } = await import('../lib/support-bot/store');
      await ensureSupportSchema();
      console.log('support-bot schema ready; no messages sent');
      return;
    }
    const { ensureSupportSchema } = await import('../lib/support-bot/store');
    await ensureSupportSchema();
    if (process.env.SUPPORT_BOT_ENABLED !== 'true') throw new Error('support bot intake disabled');
    const { captureSupportRuntime } = await import('../lib/support-bot/runtime');
    const { logServerEvent } = await import('../lib/observability/server-log');
    const runtime = await captureSupportRuntime();
    // Report the loaded worker checkout without printing any connection or provider credentials.
    // 记录当前 worker checkout，避免用 Web 版本或配置文件存在代替实际 worker 验证。
    logServerEvent('support_bot_worker_started', { service: 'support-bot',
      environment: process.env.SUPPORT_BOT_ENVIRONMENT, deploymentVersion: runtime.deploymentVersion,
      commit: runtime.checkoutRevision, webOnly: process.env.SUPPORT_BOT_SEND_ENABLED !== 'true' });
    const {runSupportBotOnce}=await import('../lib/support-bot/worker');
    if (process.argv.includes('--once')) { console.log(JSON.stringify(await runSupportBotOnce())); return; }
    for (;;) {
      try { await runSupportBotOnce(); }
      catch { console.error('support-bot iteration failed; durable queue will retry'); }
      await new Promise(resolve=>setTimeout(resolve,3000));
    }
  } finally {
    const { closeSupportOperationConnections } = await import('../lib/support-bot/operations');
    const { closeProductionLabOperationConnections } = await import('../lib/support-bot/production-operations');
    await closeSupportOperationConnections();
    await closeProductionLabOperationConnections();
    await closeDb();
  }
}
main().catch(()=>{console.error('support-bot worker failed');process.exitCode=1;});
