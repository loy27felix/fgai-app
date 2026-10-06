import {createHash,randomUUID} from 'node:crypto';
import {mkdir,link,unlink,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
export function musicInput(input){
 const prompt=String(input.input||'').trim();
 if(input.model!=='suno-company-music'||!prompt||prompt.length>3000||!['mp3',undefined].includes(input.response_format)||!['instrumental','song','alloy',undefined].includes(input.voice))throw Error('SUNO_INVALID_INPUT');
 return {prompt:[String(input.instructions||'').slice(0,1000),prompt].filter(Boolean).join('\n'),instrumental:input.voice!=='song'};
}
export function audioURL(value){
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.port||!/^cdn\d*\.suno\.(?:ai|com)$/.test(url.hostname)||!url.pathname.endsWith('.mp3'))throw Error('SUNO_INVALID_RESULT');
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
