const ratioOf=size=>{const m=/^(\d+)x(\d+)$/.exec(size||'');if(!m)return null;const a=Number(m[1]),b=Number(m[2]);const gcd=(a,b)=>b?gcd(b,a%b):a;const g=gcd(a,b);return g?`${a/g}:${b/g}`:null;};
export function creatorGenerationConfig(selected,payload,mode,{standardImageQuality=false}={}){
 const profile=selected.profile[mode];
 if(mode==='text')return {};
 if(mode==='image'){
  let size=payload.size||profile.size.default;
  const ratio=ratioOf(size);
  if(profile.size.parameter==='aspect_ratio'&&ratio)size=ratio;
  if(!profile.size.values.includes(size)&&profile.size.presets?.length){
   const tier=profile.size.presets.find(p=>p.size===profile.size.default)?.tier;
   const preset=profile.size.presets.find(p=>p.ratio===ratio&&p.tier===tier);
   if(preset)size=preset.size;
  }
  if(!profile.size.values.includes(size)&&!profile.size.allowCustom)throw Error('此模型不支持该图片尺寸');
  // ArcReel's generic OpenAI adapter supplies a quality tier even for models
  // without that field. Such models use their declared size tier only.
  const quality=standardImageQuality&&!profile.quality.supported?profile.quality.default:payload.quality||profile.quality.default;
  if(quality&&(!profile.quality.supported||!profile.quality.values.includes(quality)))throw Error('此模型不支持该图片质量');
  return {size,quality};
 }
 const seconds=Number(payload.duration??profile.duration.default),size=payload.ratio||profile.defaultRatio,resolution=String(payload.resolution||profile.defaultResolution);
 if(!profile.duration.values.includes(seconds)||!profile.ratios.includes(size)||!profile.resolutions.some(x=>x.toLowerCase()===resolution.toLowerCase()))throw Error('此模型不支持当前时长、比例或分辨率');
 if(payload.generate_audio===true&&!profile.generateAudio.supported)throw Error('此模型不支持同时生成声音');
 return {size,videoSeconds:String(seconds),vquality:resolution.toUpperCase(),videoGenerateAudio:profile.generateAudio.supported&&(payload.generate_audio??profile.generateAudio.default)?'true':'false'};
}
