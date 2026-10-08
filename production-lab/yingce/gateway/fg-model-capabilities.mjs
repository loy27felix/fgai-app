// Provider-specific profiles shared by native configuration and verification.
// Limits are selected from the provider docs; unconfirmed options stay hidden.
const disabled={supported:false,default:false};
const ratios=['1:1','4:3','3:4','16:9','9:16','3:2','2:3','21:9'];
const imageRows={
 pro1:['1024x1024','1152x864','864x1152','1424x800','800x1424','1248x832','832x1248','1568x672'],
 pro2:['2048x2048','2368x1776','1776x2368','2816x1584','1584x2816','2496x1664','1664x2496','3136x1344'],
 lite2:['2048x2048','2304x1728','1728x2304','2848x1600','1600x2848','2496x1664','1664x2496','3136x1344'],
 lite3:['3072x3072','3456x2592','2592x3456','4096x2304','2304x4096','3744x2496','2496x3744','4704x2016'],
 lite4:['4096x4096','4704x3520','3520x4704','5504x3040','3040x5504','4992x3328','3328x4992','6240x2656'],
};
const presets=(rows)=>rows.flatMap(([key,tier])=>imageRows[key].map((size,i)=>{
 const [width,height]=size.split('x').map(Number);return {size,tier,ratio:ratios[i],width,height};
}));
export function capabilities(spec,{legacy=false}={}){
 const id=spec.id,p=spec.price.capabilities?.params||{},inputs=spec.price.capabilities?.inputs||{};
 if(spec.capability==='text')return {version:1,text:{streaming:true,contextWindowTokens:128000,maxOutputTokens:16384,references:{promptMaxChars:32000,maxImages:id==='deepseek-v4-pro'?0:8,maxImageBytes:7*1024*1024,maxVideos:0,maxVideoBytes:0}}};
 if(spec.capability==='image'){
  let size={parameter:'size',values:['1024x1024','1536x1024','1024x1536'],default:'1024x1024',allowCustom:false};
  let quality={supported:false,values:[],default:''},maxImages=8,maskSupported=false,maxImageBytes=0;
  if(id==='dola-seedream-5-0-pro-260628'||id==='seedream-5-0-lite-260128'){
   const values=presets(id.startsWith('dola-')?[['pro1','1k'],['pro2','2k']]:legacy?[['lite2','2k']]:[['lite2','2k'],['lite3','3k'],['lite4','4k']]);
   size={...size,values:values.map(x=>x.size),presets:values,default:id.startsWith('dola-')?'1024x1024':'2048x2048',allowCustom:true,constraints:{minPixels:id.startsWith('dola-')?921600:3686400,maxPixels:id.startsWith('dola-')?4624220:16777216,maxRatio:16}};maxImages=14;maxImageBytes=30*1024*1024;
  }else if(id.startsWith('gemini-')){
   size={parameter:'aspect_ratio',values:p.aspectRatio?.values||ratios,default:'1:1',allowCustom:false};
   quality={supported:true,values:p.imageSize?.values||['1K','2K','4K'],default:'1K'};maxImages=14;
  }else if(id==='gpt-image-2'){
   size={...size,values:p.size?.values||size.values,default:'1024x1024',allowCustom:true};maxImageBytes=50*1024*1024;
   quality={supported:true,values:p.quality?.values||['low','medium','high','auto'],default:'low'};maxImages=16;maskSupported=true;
  }else if(id==='wan2.7-image-pro'){
   const values=presets([['pro1','1k'],['lite2','2k']]);
   size={parameter:'size',values:values.map(x=>x.size),presets:values,default:'1024x1024',allowCustom:false};
   maxImages=9;maxImageBytes=20*1024*1024;
  }
  return {version:1,image:{references:{promptMaxChars:32000,maxImages,maxImageBytes,maskSupported},size,quality,transparentBackground:disabled,responseFormat:{supported:false},outputFormat:{supported:false},maxOutputs:1}};
 }
 const seed=spec.protocol.includes('ark'),seed25=id==='dreamina-seedance-2-5-filter-off',h3=id==='MiniMax-H3',happy=id.startsWith('happyhorse-'),i2v=id.endsWith('-i2v'),r2v=id.endsWith('-r2v');
 const operations=i2v?['image_to_video']:r2v?['reference_to_video']:happy?['text_to_video']:seed||h3?['text_to_video','image_to_video','reference_to_video']:['text_to_video','image_to_video','reference_to_video'];
 const values=(seed25?Array.from({length:27},(_,i)=>i+4):p.duration?.values||Array.from({length:seed||h3?12:13},(_,i)=>i+(seed||h3?4:3))).filter(x=>x>0);
 const references={promptMaxChars:8000,minImages:i2v||r2v?1:0,maxImages:seed25?30:seed||h3||r2v?9:i2v?1:0,maxImageBytes:(seed?30:20)*1024*1024,maxVideos:seed25?10:seed||h3?3:0,maxVideoBytes:200*1024*1024,maxVideoDurationSeconds:seed25?30:seed||h3?15:0,maxAudios:seed25?10:seed||h3?3:0,maxAudioBytes:15*1024*1024,maxAudioDurationSeconds:seed25?30:seed||h3?15:0};
 if(seed)Object.assign(references,{imageBytesExclusive:true,minImageSide:300,maxImageSide:6000,minImageRatio:.4,maxImageRatio:2.5,minVideoPixels:407696,maxVideoPixels:8295044,minVideoDurationSeconds:2,maxTotalVideoDurationSeconds:seed25?30:15,minAudioDurationSeconds:2,maxTotalAudioDurationSeconds:seed25?30:15,audioOnlySupported:seed25,imageFormats:['jpeg','jpg','png','webp','bmp','tiff','gif','heic','heif'],videoFormats:['mp4','mov'],audioFormats:['wav','mp3']});
 return {version:1,video:{references,duration:{selection:'enum',values,default:values.includes(5)?5:values[0]},durationSupported:true,ratios:i2v?['adaptive']:p.ratio?.values||['16:9','4:3','1:1','3:4','9:16','21:9','adaptive'],defaultRatio:i2v?'adaptive':'16:9',resolutions:h3?['768P','2K']:seed25?['480p','720p','1080p']:p.resolution?.values||(seed?['480p','720p']:['480p','720p','1080p']),defaultResolution:h3?'768P':happy?'720P':seed?'480p':'720p',generateAudio:{supported:seed||h3,default:seed||h3},watermark:{supported:seed||h3,default:false},operations,defaultOperation:operations[0]}};
}
