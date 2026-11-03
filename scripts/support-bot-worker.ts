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
