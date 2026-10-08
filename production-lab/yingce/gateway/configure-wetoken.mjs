// Server-only bootstrap: read the existing platform key from stdin. Never print it.
import fs from 'node:fs/promises';
import pg from 'pg';
import {withNativeAdmin} from './native-admin.mjs';
import {initializeFG} from './fg-integration.mjs';
let input='';for await(const chunk of process.stdin)input+=chunk;
const config=JSON.parse(input);input='';
const specs=JSON.parse(await fs.readFile(new URL('./model-specs.json',import.meta.url),'utf8'));
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2});
const bool={supported:false,default:false};
function capabilities(spec){
    const p=spec.price.capabilities?.params||{},inputs=spec.price.capabilities?.inputs||{};
    if(spec.capability==='text')return {version:1,text:{streaming:true,contextWindowTokens:128000,maxOutputTokens:16384,references:{promptMaxChars:32000,maxImages:0,maxImageBytes:0,maxVideos:0,maxVideoBytes:0}}};
    if(spec.capability==='image'){
        const gemini=spec.protocol.includes('gemini'),ark=spec.protocol.includes('ark'),wan=spec.protocol.includes('wan');
        const sizeValues=gemini?p.aspectRatio?.values||['1:1','9:16','16:9']:p.size?.values||['1:1','16:9','9:16','2048x2048','2560x1440','1440x2560'];
        const sizeDefault=gemini?'1:1':ark?'2048x2048':p.size?.default||'1:1';
        return {version:1,image:{references:{promptMaxChars:32000,maxImages:inputs.image?.max_count||14,maxImageBytes:30*1024*1024,maskSupported:spec.protocol==='openai-image'},size:{parameter:gemini?'aspect_ratio':'size',values:sizeValues,default:sizeDefault,allowCustom:!gemini},quality:{supported:!ark,values:gemini?p.imageSize?.values||['1K','2K','4K']:wan?['1K','2K']:['auto','low','medium','high'],default:gemini?'1K':wan?'2K':'auto'},transparentBackground:bool,responseFormat:{supported:!ark&&!gemini&&!wan},outputFormat:{supported:false},maxOutputs:1}};
    }
    const seedance=spec.protocol.includes('ark'),happy=spec.protocol.includes('happyhorse'),i2v=spec.id.endsWith('-i2v'),r2v=spec.id.endsWith('-r2v');
    const durations=(p.duration?.values||Array.from({length:seedance?12:13},(_,i)=>i+(seedance?4:3))).filter(n=>n>0);
    return {version:1,video:{references:{promptMaxChars:8000,minImages:i2v||r2v?1:0,maxImages:seedance||r2v?9:i2v?1:happy?0:2,maxImageBytes:30*1024*1024,maxVideos:seedance?3:0,maxVideoBytes:seedance?200*1024*1024:0,maxVideoDurationSeconds:seedance?15:0,maxAudios:seedance?3:0,maxAudioBytes:seedance?15*1024*1024:0,maxAudioDurationSeconds:seedance?15:0},duration:{selection:'enum',values:durations,default:p.duration?.default||5},durationSupported:true,ratios:p.ratio?.values||['16:9','9:16','1:1','4:3','3:4'],defaultRatio:'16:9',resolutions:p.resolution?.values||(seedance?['480p','720p']:['720P','1080P']),defaultResolution:seedance?'720p':'720P',generateAudio:{supported:seedance,default:seedance},watermark:{supported:seedance,default:false},operations:i2v?['image_to_video']:r2v?['reference_to_video']:happy?['text_to_video']:seedance?['text_to_video','image_to_video','reference_to_video']:['text_to_video','image_to_video'],defaultOperation:i2v?'image_to_video':r2v?'reference_to_video':'text_to_video'}};
}
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
