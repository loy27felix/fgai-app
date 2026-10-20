import { assertSupportLease, claimSupportJob, completeSupportJob, failSupportJob, saveSupportDiagnosis, type DiagnosisResult } from './store';
import { diagnoseSupportJob } from './diagnose';
import { deliverSupportResult } from './feishu';
import { logServerEvent } from '@/lib/observability/server-log';

export async function runSupportBotOnce() {
  if (process.env.SUPPORT_BOT_ENABLED !== 'true' || process.env.SUPPORT_BOT_SEND_ENABLED !== 'true') throw new Error('SUPPORT_BOT_SEND_ENABLED 未开启，未领取任务');
  const job = await claimSupportJob().catch((error) => {
    logServerEvent('support_bot_job_claim_failed', { service: 'support-bot' }, 'error');
    throw error;
  });
  if (!job) return { processed:false };
  const fields = { service: 'support-bot', jobId: job.id, ticketId: job.ticketId, attempts: job.attempts };
  logServerEvent('support_bot_job_claimed', fields);
  let stage = 'diagnosis';
  try {
    let result: DiagnosisResult;
    if (job.diagnosis) result=job.diagnosis;
    else result=await diagnoseSupportJob(job);
    await saveSupportDiagnosis(job,result);
    logServerEvent('support_bot_diagnosis_completed', fields);
    stage = 'delivery';
    await assertSupportLease(job);
    await deliverSupportResult(job,result);
    logServerEvent('support_bot_delivery_completed', fields);
    stage = 'completion';
    await completeSupportJob(job);
    return {processed:true,ticketId:job.ticketId};
  } catch(error) {
    // Log fixed stages and identifiers only; SDK errors may embed credentials.
    // 仅记录固定阶段与标识，避免 SDK 错误对象携带凭据落入日志。
    logServerEvent('support_bot_job_failed', { ...fields, stage }, 'error');
    await failSupportJob(job,error);
    throw error;
  }
}
