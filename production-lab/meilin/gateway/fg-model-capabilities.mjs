// Provider-specific profiles shared by native configuration and verification.
// Limits are selected from the provider docs; unconfirmed options stay hidden.
const disabled={supported:false,default:false};
// Official model contracts, independent of a reseller's catalog metadata.
// https://developers.openai.com/api/docs/guides/image-generation
// https://developers.openai.com/api/reference/resources/images/methods/generate
const gptImage2Sizes=['auto','1024x1024','1536x1024','1024x1536','1536x864','864x1536','1360x1024','1024x1360','2048x880','2048x2048','2048x1152','1152x2048','2304x1728','1728x2304','2496x1664','1664x2496','3136x1344','2880x2880','3840x2160','2160x3840','3264x2448','2448x3264','3504x2336','2336x3504','3808x1632'];
const isGPTImage2=id=>/^gpt-image-2(?:-2026-04-21|\.5-(?:flare|sunburst)(?:-2026-09-08)?)?$/.test(id);
const ratios=['1:1','4:3','3:4','16:9','9:16','3:2','2:3','21:9'];
const imageRows={
 pro1:['1024x1024','1152x864','864x1152','1424x800','800x1424','1248x832','832x1248','1568x672'],
 pro15:['1536x1536','1792x1344','1344x1792','2048x1152','1152x2048','1872x1248','1248x1872','2352x1008'],
 pro2:['2048x2048','2368x1776','1776x2368','2816x1584','1584x2816','2496x1664','1664x2496','3136x1344'],
 lite2:['2048x2048','2304x1728','1728x2304','2848x1600','1600x2848','2496x1664','1664x2496','3136x1344'],
 lite3:['3072x3072','3456x2592','2592x3456','4096x2304','2304x4096','3744x2496','2496x3744','4704x2016'],
 lite4:['4096x4096','4704x3520','3520x4704','5504x3040','3040x5504','4992x3328','3328x4992','6240x2656'],
};
const presets=(rows)=>rows.flatMap(([key,tier])=>imageRows[key].map((size,i)=>{
 const [width,height]=size.split('x').map(Number);return {size,tier,ratio:ratios[i],width,height};
}));
export function capabilities(spec,{legacy=false}={}){
 const id=spec.id;
 if(spec.capability==='text'){
  // The transport ceiling is independent of the provider's token context.
  const models={
   // Official token limits; the company route still caps image attachments at 16.
   'gpt-6.1-sol':[1050000,128000,16],
   'claude-opus-5-5-t3a':[1000000,128000,600],
   'claude-sonnet-5-5-t3a':[1000000,128000,600],
   'deepseek-v4-pro':[1048576,393216,0],
   'gpt-6-astra':[1050000,128000,1500],
   'gpt-5.6-sol-t1a':[1050000,128000,1500],
   // Unverified reseller alias remains disabled; do not copy Flash parameters.
   'gemini-3.5-pro':[0,0,0],
  };
  const limits=models[id];if(!limits)throw Error('Missing official text profile: '+id);
  return {version:1,text:{streaming:true,contextWindowTokens:limits[0],maxOutputTokens:limits[1],references:{promptMaxChars:0,maxImages:limits[2],maxImageBytes:id.startsWith('claude-')?5*1024*1024:20*1024*1024,maxVideos:0,maxVideoBytes:0}}};
 }
 if(spec.capability==='image'){
  let size={parameter:'size',values:['1024x1024','1536x1024','1024x1536'],default:'1024x1024',allowCustom:false};
  let quality={supported:false,values:[],default:''},maxImages=8,maskSupported=false,maxImageBytes=0;
  if(id==='dola-seedream-5-0-pro-260628'||id==='seedream-5-0-lite-260128'){
   const values=presets(id.startsWith('dola-')?[['pro1','1k'],['pro15','1.5k'],['pro2','2k']]:[['lite2','2k'],['lite3','3k'],['lite4','4k']]);
   size={...size,values:values.map(x=>x.size),presets:values,default:id.startsWith('dola-')?'1024x1024':'2048x2048',allowCustom:true,constraints:{minPixels:id.startsWith('dola-')?921600:3686400,maxPixels:id.startsWith('dola-')?4624220:16777216,maxRatio:16}};maxImages=id.startsWith('dola-')?10:14;maxImageBytes=30*1024*1024;
  }else if(id.startsWith('gemini-')){
   const flash=id==='gemini-3.1-flash-image-preview';
   const banana21=id==='gemini-nano-banana-2.1';
   // Google: 2.1 has 14 native ratios and 1K/2K/4K; no 512px tier.
   // "auto" omits aspectRatio at the protocol boundary (input ratio, else square).
   // https://ai.google.dev/gemini-api/docs/generate-content/image-generation
   size={parameter:'aspect_ratio',values:[...(banana21?['auto']:[]),'1:1','2:3','3:2','3:4','4:3','4:5','5:4','9:16','16:9','21:9',...(flash||banana21?['1:4','4:1','1:8','8:1']:[])],default:banana21?'auto':'1:1',allowCustom:false};
   quality={supported:true,values:[...(flash?['512px']:[]),'1K','2K','4K'],default:'1K'};maxImages=14;
  }else if(isGPTImage2(id)){
   size={...size,values:[...gptImage2Sizes],default:'1024x1024',allowCustom:true,constraints:{minPixels:655360,maxPixels:8294400,maxRatio:3,maxSide:3840,edgeMultiple:16}};maxImageBytes=50*1024*1024;
   quality={supported:true,values:['auto','low','medium','high',...(id.includes('2.5-')?['xhigh','max']:[])],default:'low'};maxImages=16;maskSupported=true;
  }else if(id==='wan2.7-image-pro'){
   const values=presets([['pro1','1k'],['lite2','2k']]);
   const large=['4096x4096','4096x2304','2304x4096','4096x3072','3072x4096'].map((size,i)=>({size,tier:'4k',ratio:['1:1','16:9','9:16','4:3','3:4'][i],width:Number(size.split('x')[0]),height:Number(size.split('x')[1])}));
   size={parameter:'size',values:[...values,...large].map(x=>x.size),presets:[...values,...large],default:'1024x1024',allowCustom:true,constraints:{minPixels:589824,maxPixels:16777216,maxRatio:8,maxReferencePixels:4194304}};
   maxImages=9;maxImageBytes=20*1024*1024;
  }else{throw Error('Missing official image profile: '+id);}
  return {version:1,image:{references:{promptMaxChars:isGPTImage2(id)?32000:id==='wan2.7-image-pro'?5000:0,maxImages,maxImageBytes,maskSupported},size,quality,transparentBackground:isGPTImage2(id)?{supported:true,default:false}:disabled,responseFormat:{supported:false},outputFormat:{supported:isGPTImage2(id)},maxOutputs:isGPTImage2(id)?10:id==='wan2.7-image-pro'?4:1}};
 }
 const seed=spec.protocol.includes('ark'),seed25=id==='dreamina-seedance-2-5-filter-off',wan3=spec.protocol==='fg-wetoken-wan3-video',h3=id==='MiniMax-H3',happy=id.startsWith('happyhorse-'),i2v=id.endsWith('-i2v'),r2v=id.endsWith('-r2v');
 const operations=i2v?['image_to_video']:r2v?['reference_to_video']:happy?['text_to_video']:seed||h3?['text_to_video','image_to_video','reference_to_video']:['text_to_video','image_to_video','reference_to_video'];
 // Wan 3 uses 2–30 seconds; the generic video fallback is not its duration limit.
 // https://help.aliyun.com/zh/model-studio/wan3-video-generation-guide
 if(!wan3&&!seed&&!h3&&!happy)throw Error('Missing official video profile: '+id);
 const values=Array.from({length:wan3?29:seed25?27:happy?13:12},(_,i)=>i+(wan3?2:happy?3:4));
 // Seedance documents recommended wording, not a hard character ceiling.
 const references={promptMaxChars:0,minImages:i2v||r2v?1:0,maxImages:seed25?30:seed||h3||r2v?9:i2v?1:0,maxImageBytes:(seed?30:20)*1024*1024,maxVideos:seed25?10:seed||h3?3:0,maxVideoBytes:200*1024*1024,maxVideoDurationSeconds:seed25?30:seed||h3?15:0,maxAudios:seed25?10:seed||h3?3:0,maxAudioBytes:15*1024*1024,maxAudioDurationSeconds:seed25?30:seed||h3?15:0};
 if(seed)Object.assign(references,{imageBytesExclusive:true,minImageSide:300,maxImageSide:6000,minImageRatio:.4,maxImageRatio:2.5,minVideoPixels:407696,maxVideoPixels:8295044,minVideoDurationSeconds:2,maxTotalVideoDurationSeconds:seed25?30:15,minAudioDurationSeconds:2,maxTotalAudioDurationSeconds:seed25?30:15,audioOnlySupported:seed25,imageFormats:['jpeg','jpg','png','webp','bmp','tiff','gif','heic','heif'],videoFormats:['mp4','mov'],audioFormats:['wav','mp3']});
 // https://help.aliyun.com/zh/model-studio/wan3-video-generation-api-reference
 if(wan3)Object.assign(references,{promptMaxChars:20000,maxImages:10,maxVideos:5,maxVideoBytes:100*1024*1024,minVideoDurationSeconds:1,maxVideoDurationSeconds:15,maxTotalVideoDurationSeconds:15,maxInputOutputDurationSeconds:30,minVideoSide:240,maxVideoSide:4096,maxAudios:5,minAudioDurationSeconds:1,maxAudioDurationSeconds:15,maxTotalAudioDurationSeconds:15,minImageSide:240,maxImageSide:8000,minImageRatio:1/8,maxImageRatio:8,audioOnlySupported:true,imageFormats:['jpg','jpeg','png','bmp','webp'],videoFormats:['mp4','mov'],audioFormats:['wav','mp3']});
 if(happy)Object.assign(references,{promptMaxChars:2500,promptMaxNonChineseChars:5000,maxImageBytes:20*1024*1024,minImageSide:r2v?400:i2v?300:0,minImageRatio:i2v?.4:0,maxImageRatio:i2v?2.5:0,imageFormats:['jpg','jpeg','png','webp'],maxVideoBytes:0,maxAudioBytes:0});
 // https://platform.minimax.io/docs/guides/video-generation
 if(h3)Object.assign(references,{promptMaxChars:7000,maxImageBytes:30*1024*1024,maxVideoBytes:50*1024*1024,minImageSide:256,maxImageSide:5760,minVideoSide:256,maxVideoSide:5760,minImageRatio:.4,maxImageRatio:2.5,minVideoDurationSeconds:2,maxTotalVideoDurationSeconds:15,minAudioDurationSeconds:2,maxTotalAudioDurationSeconds:15,maxTotalReferences:12,audioOnlySupported:true,imageFormats:['jpg','jpeg','png','webp','heic','heif'],videoFormats:['mp4','mov'],audioFormats:['wav','mp3']});
 if(wan3)return {version:1,video:{references,duration:{selection:'enum',values,default:5},durationSupported:true,ratios:['adaptive','21:9','16:9','4:3','1:1','3:4','9:16'],defaultRatio:'adaptive',resolutions:['480p','720p','1080p'],defaultResolution:'1080p',generateAudio:{supported:true,default:true},watermark:{supported:true,default:false},operations,defaultOperation:'text_to_video'}};
  // FG explicitly selects 16:9 for reference/T2V budgeting; official adaptive remains selectable.
  // Strict I2V follows the first frame and remains adaptive regardless of this default.
  return {version:1,video:{references,duration:{selection:'enum',values,default:values.includes(5)?5:values[0]},durationSupported:true,ratios:i2v?['adaptive']:happy?['16:9','9:16','1:1','4:3','3:4','4:5','5:4','9:21','21:9']:['16:9','4:3','1:1','3:4','9:16','21:9','adaptive'],defaultRatio:i2v?'adaptive':'16:9',resolutions:h3?['768P','2K']:happy?['480P','720P','1080P']:seed25?['480p','720p','1080p']:id==='doubao-seedance-2-0-filter-off'?['480p','720p','1080p','4k']:['480p','720p'],defaultResolution:h3?'768P':happy?'1080P':'720p',generateAudio:{supported:seed||h3||wan3,default:seed||h3||wan3},watermark:{supported:seed||h3||happy,default:false},operations,defaultOperation:operations[0]}};
}
