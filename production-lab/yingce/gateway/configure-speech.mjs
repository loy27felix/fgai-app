// Run inside FG's gateway. Provider credentials remain in the private key volume.
import pg from 'pg';
import {withNativeAdmin} from './native-admin.mjs';
import {speechKey,speechModels} from './fg-speech-provider.mjs';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2});
try{
 await speechKey();
 await withNativeAdmin(pool,async api=>{
  const channels=(await api('/admin/channels?limit=100')).channels;
  let channel=channels.find(c=>c.name==='火山语音 · FG');
  const config={name:'火山语音 · FG',baseUrl:'http://gateway:3010/internal/fg/speech/v1',apiKey:process.env.FG_ADCRAFT_SECRET,secretKey:'',apiFormat:'openai',models:[],headers:[],enabled:true,concurrencyLimit:2,useGlobalConcurrency:false};
  channel=(await api('/admin/channels'+(channel?'/'+channel.id:''),channel?'PATCH':'POST',config)).channel;
  const current=(await api('/admin/channels/'+channel.id+'/models')).models;
  for(const m of speechModels){
   const existing=current.find(x=>x.modelKey===m.id);
   const model={modelKey:m.id,providerModelKey:m.id,displayName:m.name,channelLabel:'火山语音',capability:'audio',protocol:'openai-audio',enabled:true,billingMode:'fixed_request',priceConfigured:false,capabilityConfig:{version:1},description:m.id==='seed-audio-1.0'?'描述对白、音乐与环境音；输出 mp3/wav。费用等待供应商账单确认。':'固定音色配音；输出 mp3/wav。费用等待供应商账单确认。',tags:[],priceTiers:[]};
   await api('/admin/channels/'+channel.id+'/models'+(existing?'/'+existing.id:''),existing?'PATCH':'POST',model);
   await pool.query(`INSERT INTO fg_model_prices(model,snapshot,collected_at) VALUES($1,$2,now()) ON CONFLICT(model) DO NOTHING`,[m.id,JSON.stringify({enabled:true,currency:'CNY',discount:1,pricing_rules:{},provider:'volcengine',rateStatus:'pending_verification'})]);
  }
  console.log(JSON.stringify({audioModels:speechModels.length,providerKeyServerOnly:true,unverifiedRatesFailClosedWithBudgets:true}));
 });
}finally{await pool.end();}
