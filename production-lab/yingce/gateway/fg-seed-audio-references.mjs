const maxReferenceBytes=10<<20;
export const maxSpeechInputBytes=42<<20;

// No network requests here: the official audio service receives validated,
// ordered references. FG never follows a caller-supplied URL with its API key.
export function seedAudioReferences(input,fail){
 const refs=input.references??[];
 if(!Array.isArray(refs)||refs.length>3)throw fail();
 let images=0,audios=0;
 const result=refs.map(ref=>{
  if(!ref||typeof ref!=='object'||Array.isArray(ref))throw fail();
  const keys=['audio_data','audio_url','speaker','image_data','image_url'].filter(key=>ref[key]!==undefined);
  if(keys.length!==1)throw fail();
  const key=keys[0],value=ref[key];if(typeof value!=='string'||!value.trim())throw fail();
  if(key.startsWith('image_'))images++;else audios++;
  if(key==='speaker') {if(!/^[A-Za-z0-9_-]{1,256}$/.test(value))throw fail();}
  else if(key.endsWith('_data')) {
   if(value.length>4*Math.ceil(maxReferenceBytes/3)||value.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw fail();
   const bytes=Buffer.from(value,'base64');if(!bytes.length||bytes.length>maxReferenceBytes||bytes.toString('base64')!==value)throw fail();
  }else{
   let url;try{url=new URL(value);}catch{throw fail();}
   if(!['https:','http:'].includes(url.protocol)||url.username||url.password||!url.hostname)throw fail();
  }
  return {[key]:value};
 });
 if(images>1||(images&&audios))throw fail();
 return {references:result,audioCount:audios};
}

export function seedAudioPrompt(prompt,audioCount,fail){
 const normalized=prompt.replace(/@(?:Audio|音频)(\d+)/gi,'@音频$1');
 const slots=[...normalized.matchAll(/@音频(\d+)/g)].map(match=>Number(match[1]));
 if(slots.some(index=>index<1||index>audioCount))throw fail();
 if(audioCount>1&&Array.from({length:audioCount},(_,i)=>i+1).some(index=>!slots.includes(index)))throw fail();
 return audioCount===1&&!slots.length?'使用@音频1作为说话人的音色参考，按以下内容生成新的音频：\n'+normalized:normalized;
}
