// Server-only bootstrap: read the existing platform key from stdin. Never print it.
import fs from 'node:fs/promises';
import pg from 'pg';
import {withNativeAdmin} from './native-admin.mjs';
import {initializeFG} from './fg-integration.mjs';
import {capabilities} from './fg-model-capabilities.mjs';
let input='';for await(const chunk of process.stdin)input+=chunk;
const config=JSON.parse(input);input='';
const specs=JSON.parse(await fs.readFile(new URL('./model-specs.json',import.meta.url),'utf8'));
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2});
try{
    await initializeFG(pool);
    const response=await fetch(config.baseUrl.replace(/\/$/,'')+'/models',{headers:{authorization:'Bearer '+config.apiKey},signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error('WeToken model catalog unavailable: '+response.status);
    const catalog=(await response.json()).data||[];const available=new Map(catalog.map(m=>[m.id,m]));
    await withNativeAdmin(pool,async api=>{
        for(const file of (await fs.readdir(new URL('./protocol-packages/',import.meta.url))).filter(f=>f.endsWith('.yingce-plugin'))){
            await api('/plugins','POST',await fs.readFile(new URL('./protocol-packages/'+file,import.meta.url)));
        }
        const channels=(await api('/admin/channels?limit=100')).channels;
        let channel=channels.find(c=>c.name==='WeToken · FG 制作');
        const body={name:'WeToken · FG 制作',baseUrl:config.baseUrl,apiKey:config.apiKey,secretKey:'',concurrencyLimit:24,useGlobalConcurrency:false,models:[],headers:[],enabled:true};
        if(!channel)channel=(await api('/admin/channels','POST',body)).channel;
        else channel=(await api('/admin/channels/'+channel.id,'PATCH',body)).channel;
        const current=(await api('/admin/channels/'+channel.id+'/models')).models;
        for(const spec of specs){
            const enabled=available.has(spec.id)&&spec.id!=='gemini-3.5-pro',existing=current.find(m=>m.modelKey===spec.id);
            const model={modelKey:spec.id,providerModelKey:spec.id,displayName:spec.id,channelLabel:'WeToken',capability:spec.capability,protocol:spec.protocol,billingMode:'fixed_request',priceConfigured:true,enabled,capabilityConfig:capabilities(spec),description:enabled?'WeToken 服务端接入；实际人民币费用见 FG 对账。':'当前 Key 的可用目录未列出此型号，需验证供应商生成路由；不代表模型能力分类不支持。',tags:[],priceTiers:[]};
            await api('/admin/channels/'+channel.id+'/models'+(existing?'/'+existing.id:''),existing?'PATCH':'POST',model);
            const snapshot={...spec.price,discount:available.get(spec.id)?.discount_ratio??null,enabled};
            await pool.query('INSERT INTO fg_model_prices(model,snapshot,collected_at) VALUES($1,$2,now()) ON CONFLICT(model) DO UPDATE SET snapshot=excluded.snapshot,collected_at=now()',[spec.id,JSON.stringify(snapshot)]);
        }
        await api('/admin/system-performance/agent-limit','PUT',{maxSessions:24});
        console.log(JSON.stringify({configuredModels:specs.length,enabled:specs.filter(s=>available.has(s.id)).length,pending:specs.filter(s=>!available.has(s.id)).map(s=>s.id),keyStoredServerSide:true}));
    });
}finally{config.apiKey='';await pool.end();}
