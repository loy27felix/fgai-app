// Audited internal configuration only. Never read or print provider keys.
import pg from 'pg';
import {withNativeAdmin} from './native-admin.mjs';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2});
try {
  await withNativeAdmin(pool,async api=>{
    const {setting:policy}=await api('/admin/settings/runtime-policy');
    const next={...policy,resource:{...policy.resource,storedFileGB:0},task:{...policy.task,workerConcurrency:4,channelConcurrency:4,agentMaxSessions:8}};
    const {setting:saved}=await api('/admin/settings/runtime-policy','PUT',next);
    const agent=await api('/admin/system-performance/agent-limit','PUT',{maxSessions:8});
    const channels=(await api('/admin/channels?limit=100')).channels;
    const wetoken=channels.filter(c=>c.name==='WeToken · FG 制作');
    if(wetoken.length!==1)throw new Error('Expected one verified WeToken channel');
    await api('/admin/channels/'+wetoken[0].id,'PATCH',{concurrencyLimit:4,useGlobalConcurrency:false});
    const plugins=await api('/admin/plugins');
    const payments=plugins.plugins.filter(p=>p.management.kind==='payment');
    for(const p of payments)await api('/admin/plugins/'+encodeURIComponent(p.manifest.id)+'/availability','PUT',{available:false});
    const {setting:check}=await api('/admin/settings/runtime-policy');
    const pluginCheck=await api('/admin/plugins');
    if(check.resource.storedFileGB!==0||check.task.workerConcurrency!==4||check.task.channelConcurrency!==4||agent.limit!==8||agent.configuredLimit!==8)throw new Error('Team policy did not take effect');
    if(payments.some(p=>pluginCheck.states[p.manifest.id]?.effectiveEnabled))throw new Error('Payment plugin remains enabled');
    const channelCheck=(await api('/admin/channels?limit=100')).channels.find(c=>c.id===wetoken[0].id);
    if(channelCheck?.concurrencyLimit!==4)throw new Error('WeToken concurrency did not take effect');
    console.log(JSON.stringify({storageUnlimited:true,worker:check.task.workerConcurrency,agent:agent.limit,wetoken:channelCheck.concurrencyLimit,paymentPluginsDisabled:payments.length,frequencyRulesUnchanged:JSON.stringify(saved.request)===JSON.stringify(policy.request),activeTaskLimit:check.task.activeTaskLimit}));
  });
} finally {await pool.end();}
