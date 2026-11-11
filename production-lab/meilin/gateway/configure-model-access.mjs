// Supplier permission update, read-only catalog check. Never submit a generation.
import pg from 'pg';
import {withNativeAdmin} from './native-admin.mjs';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2});
try {
    await withNativeAdmin(pool,async api=>{
        const channel=(await api('/admin/channels?limit=100')).channels.find(c=>c.name==='WeToken · FG 制作');
        if(!channel?.enabled)throw new Error('Verified enabled WeToken channel required');
        const path='/admin/channels/'+channel.id+'/models';
        const list=(await api(path)).models;
        for(const [key,enabled,description] of [
            ['gemini-3.5-pro',false,'WeToken 已确认暂未开放此账号权限；保留多模态文本能力配置。'],
            ['wan3.0-video',true,'WeToken 已确认开放权限；文生视频 / 图生视频。费用以人民币账单核销。'],
        ]) {
            const found=list.filter(m=>m.modelKey===key);
            if(found.length!==1)throw new Error('Expected one configured model '+key);
            await api(path+'/'+found[0].id,'PATCH',{...found[0],enabled,description});
            await pool.query("UPDATE fg_model_prices SET snapshot=jsonb_set(snapshot,'{enabled}',$2::jsonb) WHERE model=$1",[key,JSON.stringify(enabled)]);
        }
        const check=(await api(path)).models;
        console.log(JSON.stringify({models:check.filter(m=>['gemini-3.5-pro','wan3.0-video'].includes(m.modelKey)).map(m=>({model:m.modelKey,enabled:m.enabled,protocol:m.protocol})),paidRequests:0}));
    });
} finally {await pool.end();}
