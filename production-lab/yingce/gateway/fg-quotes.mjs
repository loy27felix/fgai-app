// Provider rates are estimates; only an exactly matched expense receipt is actual.
import {minimumVideoTokens} from './fg-seedance-minimum.mjs';
const dimensions={
 '480p':[[864,496],[752,560],[640,640],[560,752],[496,864],[992,432]],
 '720p':[[1280,720],[1112,834],[960,960],[834,1112],[720,1280],[1470,630]],
 '1080p':[[1920,1080],[1664,1248],[1440,1440],[1248,1664],[1080,1920],[2206,946]],
 '4k':[[3840,2160],[3326,2494],[2880,2880],[2494,3326],[2160,3840],[4398,1886]],
};
const ratios=['16:9','4:3','1:1','3:4','9:16','21:9'];
const number=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
export function priceQuote(model,price,intent,fx){
 const d=number(price?.discount),result={model,estimatedCny:null,estimateKind:'estimate',discount:d,fx,lines:[],notes:['最终费用以 WeToken 消费账单核销，预计费用不计入实际花费。']};
 if(!price?.enabled||d===null||d<=0){result.notes.unshift('当前账户费率尚未核验。');return result;}
 const money=v=>'¥'+(v*d*fx).toLocaleString('zh-CN',{maximumFractionDigits:6});
 const options=intent.options||{},inputs=intent.inputs||{},rules=price.pricing_rules?.rules||[];
 const count=Math.max(1,Math.min(100,number(options.count)||1));
 const rawResolution=String(options.vquality||'').toLowerCase();
 const resolution=/^\d+$/.test(rawResolution)?rawResolution+'p':rawResolution,seconds=number(options.videoSeconds),videoCount=number(inputs.video)||0;
 const referenceSeconds=videoCount?number(options.referenceVideoSeconds):0;
 if(intent.capability==='text'){
  const tiers=price.tiered_pricing?.length?price.tiered_pricing:[{input_price_per_m:price.pricing_rules?.input_price,output_price_per_m:price.pricing_rules?.output_price, max_input_tokens:-1}];
  for(const tier of tiers){
   const prefix=tier.max_input_tokens>0?`输入 ≤ ${tier.max_input_tokens.toLocaleString()} Token：`:tiers.length>1?'超出前档：':'';
   if(Number.isFinite(tier.input_price_per_m)&&Number.isFinite(tier.output_price_per_m))result.lines.push(prefix+`输入 ${money(tier.input_price_per_m)} / 输出 ${money(tier.output_price_per_m)}${Number.isFinite(tier.cached_price_per_m)?` / 缓存输入 ${money(tier.cached_price_per_m)}`:''}，每百万 Token`);
  }
  result.notes.unshift('按实际输入、输出与缓存用量计费，不设固定单次价格。');
 }else if(intent.capability==='image'){
  let amount=null;
  if(model.startsWith('dola-seedream')){
   const size=String(options.size||'').match(/^(\d+)x(\d+)$/);
   if(size){amount=(Number(size[1])*Number(size[2])<2360000?.045:.09)*count+(number(inputs.image)||0)*.003;result.lines.push(`输出 ${money(amount/count)} / 张（含当前参考图费用）`);}
   result.notes.unshift(`WeToken 以 236 万像素区分输出档位；每张参考图另计 ${money(.003)}（已按账户折扣折算）。`);
  }else if(model.startsWith('gemini-')){
   result.estimateKind='partial';
   const quality=String(options.quality||'1K').toUpperCase();
   const row=rules.find(r=>r.tier==='standard'&&r.token_type==='Output image'&&String(r.image_size).split('/').includes(quality));
   if(row){amount=row.price*count;result.lines.push(`图片输出 ${money(row.price)} / 张起`);}
   result.notes.unshift('另计输入素材、文本输出与思考 Token；这里只显示图片输出部分，不是费用上限。');
  }else if(model.startsWith('gpt-image-')){
   const rs=rules.length?rules:[{modality:'Text',token_type:'Input',price:5},{modality:'Image',token_type:'Input',price:8},{modality:'Image',token_type:'Output',price:30}];
   result.lines.push(...rs.map(r=>`${r.token_type} · ${r.modality} ${money(r.price)} / 百万 Token`));
   result.notes.unshift('按图片与文本实际 Token 计费，尺寸和质量会改变输出用量。');
  }else if(model==='wan2.7-image-pro'){
   const observed=price.observedImagePrices||[],proof=observed.find(x=>x.size===String(options.size));
   result.lines.push(...observed.map(x=>`实测 ${x.size}：¥${(x.usd*fx).toFixed(6)} / 张（已含折扣）`));
   if(proof)amount=proof.usd/d*count;
   result.notes.unshift('WeToken 公开单价与实际消费存在差异，仅用已核验尺寸展示实测金额；其他尺寸暂不显示确定价格。');
  }else if(price.quota_type===1&&Number.isFinite(price.model_price)){amount=price.model_price*count;result.lines.push(`${money(price.model_price)} / 次`);}
  if(amount!==null)result.estimatedCny=amount*d*fx;
 }else if(intent.capability==='video'){
  if(model.toLowerCase().includes('seedance')){
   const scenario=videoCount?'with_video_input':'without_video_input';
   const row=rules.find(r=>r.scenario===scenario&&String(r.resolution).toLowerCase().split('/').includes(resolution));
   const ratioIndex=ratios.indexOf(String(options.size));
   const autoFrame=model==='dreamina-seedance-2-5-filter-off'&&intent.operation==='image_to_video';
   const dims=autoFrame?null:model==='dreamina-seedance-2-5-filter-off'&&resolution==='480p'&&[0,4].includes(ratioIndex)?(ratioIndex===0?[854,480]:[480,854]):dimensions[resolution]?.[ratioIndex];
   if(autoFrame)result.notes.unshift('2.5 首帧／首尾帧模式按参考图自适应比例；读取实际输出像素后更新用量估算。');
   result.lines.push(...rules.map(r=>`${r.resolution} · ${r.scenario==='with_video_input'?'参考视频':'无参考视频'} ${money(r.price)} / 百万视频 Token`));
   if(rules.some(r=>r.priceOrigin==='matched_receipt_inference'))result.notes.unshift('1080P 无参考视频费率由已匹配账单样本与实际 Token 推算，仍为暂定估算；参考视频的 1080P 费率尚未确认。');
   if(row&&dims&&seconds>0){
    const ref=referenceSeconds===null?(model==='dreamina-seedance-2-5-filter-off'?30:15):referenceSeconds;
    const formulaTokens=Math.ceil(((seconds+ref)*24+1)*dims[0]*dims[1]/1024);
    const minimum=videoCount?minimumVideoTokens(model,resolution,String(options.size),seconds):null;
    const tokens=Math.max(formulaTokens,minimum?.tokens||0);
    result.estimatedCny=tokens*row.price/1000000*d*fx;
    result.notes.unshift(`按 ${dims[0]}×${dims[1]}、24 fps、输出 ${seconds} 秒${videoCount?` + 参考视频 ${ref} 秒`:''}估算 ${tokens.toLocaleString()} 视频 Token。`);
    if(minimum)result.notes.unshift(`已应用火山官方最低用量 ${minimum.tokens.toLocaleString()} Token：与当前公式值 ${formulaTokens.toLocaleString()} 比较后取较大值。`);
   }
   if(videoCount&&referenceSeconds===null)result.notes.unshift(`参考视频时长尚未读取，暂按累计上限 ${model==='dreamina-seedance-2-5-filter-off'?30:15} 秒估算；实际输出用量可能不同。`);
   if(videoCount&&!minimumVideoTokens(model,resolution,String(options.size),seconds)){result.estimateKind='lower_bound';result.notes.unshift('当前比例或时长没有可匹配的官方最低 Token 表值；仅显示公式部分，完成后按实际 Token 更新，出账后核销。');}
   if(model==='dreamina-seedance-2-5-filter-off'&&resolution==='1080p'&&!row)result.notes.unshift('官方支持 1080p；该 WeToken 档位费率尚未确认，不套用 720p 的价格。');
   result.notes.unshift('参考图片不切换参考视频费率；参考视频同时改变费率并增加计费时长。');
  }else if(model==='MiniMax-H3'){
   const rate=resolution==='768p'?.08:resolution==='2k'?.13:null;
   result.lines.push(`768P ${money(.08)} / 秒；2K ${money(.13)} / 秒；超过 5 张参考图每张 ${money(.04)}`);
   if(rate!==null&&seconds>0&&referenceSeconds!==null)result.estimatedCny=(rate*(seconds+referenceSeconds)+Math.max(0,(number(inputs.image)||0)-5)*.04)*d*fx;
   result.notes.unshift('参考视频时长另计；音频生成不另收费用。');
  }else if(price.pricing_rules?.type==='per_second'){
   const row=rules.find(r=>String(r.resolution).toLowerCase()===resolution);
   result.lines.push(...rules.map(r=>`${r.resolution} ${money(r.price)} / 秒`));
   if(price.billing_doc?.billing_unit==='per_call'&&!price.verifiedBillingUnit){result.notes.unshift('供应商公开计费单位存在冲突，正在以实际消费单核验；暂不展示确定金额。');}
   else if(row&&seconds>0)result.estimatedCny=row.price*seconds*d*fx;
  }
 }
 if(!result.lines.length)result.notes.unshift('该模型的详细费率尚未确认，不显示虚假的零费用。');
 return result;
}
