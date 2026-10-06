// Activate only after the company fills the private account file and the
// read-only account check succeeds. No generation or CAPTCHA purchase here.
import pg from 'pg';import {withNativeAdmin} from './native-admin.mjs';
import {musicServiceSecret} from './fg-music-provider.mjs';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2});
try{
 const headers={authorization:'Bearer '+musicServiceSecret()};
 const status=await fetch('http://suno:3050/status',{headers}).then(r=>r.json());
 if(!status.configured||!status.enabled)throw Error('Suno 私密账号配置尚未完成或未开启');
 const check=await fetch('http://suno:3050/validate',{method:'POST',headers,signal:AbortSignal.timeout(45000)});
 if(!check.ok||(await check.json()).accountReadable!==true)throw Error('Suno 账号验证失败；没有提交音乐任务');
 await withNativeAdmin(pool,async api=>{
  const channels=(await api('/admin/channels?limit=100')).channels;let channel=channels.find(c=>c.name==='Suno 音乐 · FG');
  const config={name:'Suno 音乐 · FG',baseUrl:'http://gateway:3010/internal/fg/speech/v1',apiKey:process.env.FG_ADCRAFT_SECRET,secretKey:'',apiFormat:'openai',models:[],headers:[],enabled:true,concurrencyLimit:1,useGlobalConcurrency:false};
  channel=(await api('/admin/channels'+(channel?'/'+channel.id:''),channel?'PATCH':'POST',config)).channel;
  const existing=(await api('/admin/channels/'+channel.id+'/models')).models.find(m=>m.modelKey==='suno-company-music');
  const model={modelKey:'suno-company-music',providerModelKey:'suno-company-music',displayName:'Suno 音乐 · FG',channelLabel:'公司音乐',capability:'audio',protocol:'openai-audio',enabled:true,billingMode:'fixed_request',priceConfigured:true,unitPriceMicrocredits:0,capabilityConfig:{version:1},description:'公司 Suno 订阅账号制作纯音乐或歌曲。订阅额度和验证码消耗记录待核验。',tags:[],priceTiers:[]};
  await api('/admin/channels/'+channel.id+'/models'+(existing?'/'+existing.id:''),existing?'PATCH':'POST',model);
  await pool.query(`INSERT INTO fg_model_prices(model,snapshot,collected_at) VALUES('suno-company-music',$1,now()) ON CONFLICT(model) DO UPDATE SET snapshot=excluded.snapshot`,[JSON.stringify({enabled:true,currency:'CNY',discount:1,pricing_rules:{},provider:'suno',rateStatus:'pending_verification'})]);
  console.log(JSON.stringify({registered:true,accountReadable:true,generationVerified:false,credentialsServerOnly:true}));
 });
}finally{await pool.end();}
