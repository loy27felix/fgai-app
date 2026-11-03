import {mkdir,appendFile,writeFile,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';

const root=join(process.env.SUNO_STATE_DIR||'/state','support-http');
const byteLimit=2*1024*1024,lineLimit=5000;
let pending=Promise.resolve(),writeFailed=false;
export function persistLog(entry){
 pending=pending.then(async()=>{
  await mkdir(root,{recursive:true,mode:0o700});
  try{await writeFile(join(root,'since.json'),JSON.stringify({since:entry.timestamp}),{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
  await appendFile(join(root,entry.timestamp.slice(0,10)+'.jsonl'),JSON.stringify(entry)+'\n',{mode:0o600});
 }).catch(()=>{writeFailed=true;});
}
async function readPart(path,maxBytes){
 let file;try{
  file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  const size=(await file.stat()).size,length=Math.min(size,maxBytes),offset=size-length;
  const buffer=Buffer.alloc(length);const {bytesRead}=await file.read(buffer,0,length,offset);
  return {buffer:buffer.subarray(0,bytesRead),offset,size};
 }finally{await file?.close();}
}
export async function readLogs(query){
 await pending;
 const base={source:'state/support-http+stdout',retention:'UTC daily JSONL files across restarts; no automatic deletion; reads bounded to 2 MiB / 5000 lines.',byteLimit,lineLimit};
 let since=null,bytesRead=0,linesRead=0,truncated=false,unreadable=false;const logs=[];
 try{
  const marker=await readPart(join(root,'since.json'),1024);bytesRead+=marker.buffer.length;
  if(marker.offset)throw Error('SUPPORT_LOG_INVALID_MARKER');
  const value=JSON.parse(marker.buffer.toString('utf8')).since;
  if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))throw Error('SUPPORT_LOG_INVALID_MARKER');since=new Date(value).toISOString();
 }catch(error){
  if(error.code!=='ENOENT')unreadable=true;
 }
 const startDay=query.start.slice(0,10),endDay=query.end.slice(0,10);
 for(let day=Date.parse(endDay+'T00:00:00Z');day>=Date.parse(startDay+'T00:00:00Z');day-=86400000){
  if(bytesRead>=byteLimit||linesRead>=lineLimit){truncated=true;break;}
  let part;try{part=await readPart(join(root,new Date(day).toISOString().slice(0,10)+'.jsonl'),byteLimit-bytesRead);}catch(error){if(error.code!=='ENOENT')unreadable=true;continue;}
  bytesRead+=part.buffer.length;let data=part.buffer;
  if(part.offset){truncated=true;const newline=data.indexOf(10);data=newline===-1?Buffer.alloc(0):data.subarray(newline+1);}
  const lines=data.toString('utf8').split('\n');if(lines.at(-1)==='')lines.pop();
  for(let index=lines.length-1;index>=0;index--){
   if(linesRead>=lineLimit){truncated=true;break;}linesRead++;
   let entry;try{entry=JSON.parse(lines[index]);}catch{unreadable=true;continue;}
   if(!entry||typeof entry!=='object'||entry.event!=='support_http_request'||entry.service!=='suno'||typeof entry.timestamp!=='string'){unreadable=true;continue;}
   if(entry.actor_id!==query.actorId||entry.timestamp<query.start||entry.timestamp>query.end)continue;
   if(!['taskId','requestId','traceId','projectId'].every(key=>!query[key]||entry[({taskId:'task_id',requestId:'request_id',traceId:'trace_id',projectId:'project_id'})[key]]===query[key]))continue;
   logs.push(entry);
  }
 }
 logs.sort((a,b)=>b.timestamp.localeCompare(a.timestamp));
 return {...base,logs:logs.slice(0,query.limit),truncated:truncated||logs.length>query.limit,bytesRead,linesRead,
  available:!writeFailed&&!unreadable,availableSince:since,incomplete:writeFailed||unreadable||truncated||!since||query.start<since,
  ...(writeFailed?{reason:'SUPPORT_LOG_WRITE_FAILED'}:unreadable?{reason:'SUPPORT_LOG_READ_FAILED'}:truncated?{reason:'SUPPORT_LOG_READ_BUDGET_EXCEEDED'}:!since||query.start<since?{reason:'Requested window predates persisted HTTP logging; no historical backfill.'}:{})};
}
