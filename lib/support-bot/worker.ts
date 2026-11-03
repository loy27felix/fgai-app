import { appendSupportProgress, assertSupportLease, claimSupportJob, completeSupportJob, failSupportJob, isSupportJobCancelled, saveSupportDiagnosis, type DiagnosisResult, updateSupportStage } from './store';
import { diagnoseSupportJob } from './diagnose';
import { deliverSupportResult } from './feishu';
import { logServerEvent } from '@/lib/observability/server-log';

export async function runSupportBotOnce() {
  if (process.env.SUPPORT_BOT_ENABLED !== 'true') throw new Error('SUPPORT_BOT_ENABLED 未开启');
  const webOnly = process.env.SUPPORT_BOT_SEND_ENABLED !== 'true';
  const job = await claimSupportJob(webOnly).catch((error) => {
    logServerEvent('support_bot_job_claim_failed', { service: 'support-bot' }, 'error');
    throw error;
  });
  if (!job) return { processed:false };
  const fields = { service: 'support-bot', jobId: job.id, ticketId: job.ticketId, attempts: job.attempts };
  logServerEvent('support_bot_job_claimed', fields);
  const controller = new AbortController();
  let checking = false;
  // The Web API and worker run in separate processes; revoked database leases signal cancellation.
  // 网页接口与 worker 分进程运行，通过数据库租约撤销传递终止请求。
  const monitor = job.chatId.startsWith('web:') ? setInterval(async () => {
    if (checking || controller.signal.aborted) return;
    checking = true;
    try { await assertSupportLease(job); }
    catch (error) { controller.abort(error); }
    finally { checking = false; }
  }, 750) : undefined;
  let stage = 'diagnosis';
  try {
    await assertSupportLease(job);
    let result: DiagnosisResult;
    if (job.diagnosis) result=job.diagnosis;
    else result=await diagnoseSupportJob(job, {
      signal: controller.signal,
      onProgress: stage => updateSupportStage(job, stage),
      onEvidence: job.chatId.startsWith('web:') ? text => appendSupportProgress(job, text) : undefined,
    });
    controller.signal.throwIfAborted();
    await saveSupportDiagnosis(job,result);
    logServerEvent('support_bot_diagnosis_completed', fields);
    stage = 'delivery';
    await assertSupportLease(job);
    // Web conversations persist results without sending Feishu messages.
    // 网页会话通过事件流读取结果，不向飞书投递。
    if (!job.chatId.startsWith('web:')) await deliverSupportResult(job,result);
    logServerEvent('support_bot_delivery_completed', fields);
    stage = 'completion';
    await completeSupportJob(job);
    return {processed:true,ticketId:job.ticketId};
  } catch(error) {
    if (job.chatId.startsWith('web:') && await isSupportJobCancelled(job)) {
      logServerEvent('support_bot_job_cancelled', fields);
      return { processed: true, ticketId: job.ticketId, cancelled: true };
    }
    // Log fixed stages and identifiers only; SDK errors may embed credentials.
    // 仅记录固定阶段与标识，避免 SDK 错误对象携带凭据落入日志。
    logServerEvent('support_bot_job_failed', { ...fields, stage }, 'error');
    await failSupportJob(job,error);
    throw error;
  } finally {
    clearInterval(monitor);
  }
}
