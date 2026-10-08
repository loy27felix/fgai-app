import {createHash,randomUUID} from 'node:crypto';
import {mkdir,link,unlink,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
export function musicInput(input){
 const prompt=String(input.input||'').trim();
 if(input.model!=='suno-company-music'||!prompt||prompt.length>3000||!['mp3',undefined].includes(input.response_format)||!['instrumental','song','alloy',undefined].includes(input.voice))throw Error('SUNO_INVALID_INPUT');
 let options=input.suno;
 if(options===undefined&&typeof input.instructions==='string'&&input.instructions.startsWith('{"fgSuno":')){try{options=JSON.parse(input.instructions).fgSuno;}catch{throw Error('SUNO_INVALID_INPUT');}}
 if(options!==undefined){
  if(!options||Array.isArray(options)||typeof options!=='object')throw Error('SUNO_INVALID_INPUT');
  const fields={mode:options.mode??'custom',sunoModel:options.model??'auto',lyrics:options.lyrics??'',styles:options.styles??'',title:options.title??'',negativeStyles:options.negativeStyles??''};
  if(Object.values(fields).some(v=>typeof v!=='string')||!['custom','inspiration'].includes(fields.mode)||fields.lyrics.length>5000||fields.styles.length>1000||fields.title.length>100||fields.negativeStyles.length>1000||!/^[a-zA-Z0-9.-]{1,80}$/.test(fields.sunoModel))throw Error('SUNO_INVALID_INPUT');
  if(fields.mode==='custom'&&(!fields.styles.trim()||(input.voice==='song'&&!fields.lyrics.trim())))throw Error('SUNO_INVALID_INPUT');
  return {prompt,instrumental:input.voice!=='song',...fields};
 }
 return {prompt:[String(input.instructions||'').slice(0,1000),prompt].filter(Boolean).join('\n'),instrumental:input.voice!=='song'};
}
export function audioURL(value){
 const url=new URL(value);
 // The current download endpoint also returns signed files from this exact
 // Suno-owned bucket. Never permit arbitrary S3 buckets or redirects.
 const allowedHost=/^cdn\d*\.suno\.(?:ai|com)$/.test(url.hostname)||url.hostname==='suno-data-uploads.s3.amazonaws.com';
 if(url.protocol!=='https:'||url.username||url.password||url.port||!allowedHost||!url.pathname.endsWith('.mp3'))throw Error('SUNO_INVALID_RESULT');
 return url.href;
}
export async function claim(root,id,input){
 if(!/^[0-9a-f-]{36}$/.test(id))throw Error('SUNO_INVALID_OPERATION');
 await mkdir(root,{recursive:true});const path=join(root,id+'.json');
 const fingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex');
 const temporary=path+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify({id,fingerprint,status:'sending'}),{mode:0o600,flag:'wx'});
 try{await link(temporary,path);return {created:true,id,path,fingerprint,status:'sending'};}
 catch(error){if(error.code!=='EEXIST')throw error;const old=JSON.parse(await readFile(path,'utf8'));if(old.fingerprint!==fingerprint)throw Error('SUNO_OPERATION_CONFLICT');return {created:false,path,...old};}
 finally{await unlink(temporary);}
}
export async function save(record,update){
 Object.assign(record,update);const path=record.path+'.next';const {created,path:ignored,...data}=record;await writeFile(path,JSON.stringify(data),{mode:0o600});await rename(path,record.path);
}
