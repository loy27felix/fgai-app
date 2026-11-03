import {opendir,open} from 'node:fs/promises';
import {join} from 'node:path';
import {build,supportAuthorized,supportQuery,requestLogs,recordMatches,identifier,actorIdentifier,errorCode,recordStatus} from './support-common.mjs';

const scanLimit=5000,maxFileBytes=64*1024,byteLimit=2*1024*1024;
async function records(root,query){
 const found=[];let scanned=0,legacy=0,unreadable=0,scanTruncated=false,bytesRead=0;
 const directory=await opendir(root);
 for await(const entry of directory){
  if(!entry.isFile()||!/^([0-9a-f-]{36})\.json$/.test(entry.name))continue;
  if(scanned>=scanLimit){scanTruncated=true;break;}scanned++;
  let operation,handle;try{
   handle=await open(join(root,entry.name),'r');const size=(await handle.stat()).size;if(size>maxFileBytes){unreadable++;continue;}
   if(bytesRead+size>byteLimit){scanTruncated=true;break;}
   const buffer=Buffer.alloc(size),read=await handle.read(buffer,0,size,0);bytesRead+=read.bytesRead;
   operation=JSON.parse(buffer.subarray(0,read.bytesRead).toString('utf8'));
  }catch{unreadable++;continue;}finally{await handle?.close();}
  if(!actorIdentifier(operation.actorId)||operation.actorSource!=='service-secret'){legacy++;continue;}
  if(operation.actorId!==query.actorId||operation.id+'.json'!==entry.name)continue;
  const created=Date.parse(operation.createdAt),updated=Date.parse(operation.updatedAt);
  if(!Number.isFinite(created)||!Number.isFinite(updated)){unreadable++;continue;}
  const record={id:operation.id,kind:'operation',status:recordStatus(operation.status),createdAt:new Date(created).toISOString(),updatedAt:new Date(updated).toISOString()};
  for(const key of ['projectId','taskId','requestId','traceId'])if(identifier(operation[key]))record[key]=operation[key];
  if(errorCode(operation.errorCode))record.errorCode=operation.errorCode;
  if(recordMatches(record,query)){
   found.push(record);found.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));
   if(found.length>query.limit+1)found.pop();
  }
 }
 return {records:found.slice(0,query.limit),truncated:scanTruncated||found.length>query.limit,scanTruncated,scanned,legacy,unreadable,bytesRead};
}
export async function supportRequest(req,res,send,root){
 const url=new URL(req.url,'http://suno');
 if(url.pathname!=='/internal/support'&&!url.pathname.startsWith('/internal/support/'))return false;
 const fail=(status,errorCode)=>send(res,status,{errorCode,error:{code:errorCode}});
 if(!supportAuthorized(req)){fail(403,'SUPPORT_FORBIDDEN');return true;}
 if(req.method!=='GET'){fail(405,'SUPPORT_METHOD_NOT_ALLOWED');return true;}
 if(url.pathname==='/internal/support/version'){send(res,200,{service:'suno',build});return true;}
 if(url.pathname!=='/internal/support/evidence'){fail(404,'SUPPORT_NOT_FOUND');return true;}
 let query;try{query=supportQuery(url);}catch{fail(400,'SUPPORT_INVALID_QUERY');return true;}
 const logs=await requestLogs(query);let result,storageAvailable=true;
 try{result=await records(root,query);}catch{storageAvailable=false;result={records:[],truncated:false,scanned:0,legacy:0,unreadable:0};}
 send(res,200,{service:'suno',build,scope:{actorId:query.actorId,start:query.start,end:query.end,...Object.fromEntries(['taskId','requestId','traceId','projectId'].filter(key=>query[key]!==undefined).map(key=>[key,query[key]]))},records:result.records,logs:logs.logs,
  coverage:{operations:{available:storageAvailable&&result.unreadable===0,...(!storageAvailable?{reason:'SUPPORT_STORAGE_UNAVAILABLE'}:result.unreadable>0?{reason:'SUPPORT_OPERATION_FILE_UNREADABLE'}:{}),source:'operation-files',
   ownership:'actorId verified by business secret at creation; legacy unowned operations excluded',timeField:'updatedAt',
   scanLimit,byteLimit,bytesRead:result.bytesRead||0,scanned:result.scanned,scanTruncated:!!result.scanTruncated,legacyUnownedExcluded:result.legacy,unreadableFiles:result.unreadable},inboundHttp:logs.coverage},
  incomplete:!storageAvailable||logs.incomplete||!!result.scanTruncated||result.unreadable>0,truncated:result.truncated||logs.truncated});
 return true;
}
