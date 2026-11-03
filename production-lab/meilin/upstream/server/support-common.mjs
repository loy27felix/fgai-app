const SERVICE='meilin';
import {timingSafeEqual,randomUUID} from 'node:crypto';
import {persistLog,readLogs} from './support-log.mjs';

export const identifier=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value)?value:undefined;
export const actorIdentifier=value=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)?value:undefined;
function date(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return;
 const [year,month,day,hour,minute,second]=value.slice(0,19).split(/[-T:]/).map(Number);
 if(month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate()||hour>23||minute>59||second>59||!Number.isFinite(Date.parse(value)))return;
 return new Date(value).toISOString();
}
const metadata=value=>typeof value==='string'&&value.trim()&&value.length<=160&&!/[\r\n]/.test(value)?value:'unknown';
export const build=Object.freeze({
 commit:metadata(process.env.BUILD_COMMIT),version:metadata(process.env.BUILD_VERSION),
 buildTime:date(process.env.BUILD_TIME)||'unknown',environment:metadata(process.env.BUILD_ENVIRONMENT),
 dirty:process.env.BUILD_DIRTY==='true'?true:process.env.BUILD_DIRTY==='false'?false:null,
});
export function supportAuthorized(req){
 const expected=process.env.SUPPORT_BOT_NATIVE_READ_TOKEN;
 const header=req.headers.authorization;
 if(!expected||expected.length<32||typeof header!=='string'||!header.startsWith('Bearer '))return false;
 const supplied=Buffer.from(header.slice(7)),secret=Buffer.from(expected);
 return supplied.length===secret.length&&timingSafeEqual(supplied,secret);
}
export function supportQuery(url){
 const allowed=['actorId','start','end','taskId','requestId','traceId','projectId','limit'];
 for(const key of url.searchParams.keys())if(!allowed.includes(key)||url.searchParams.getAll(key).length!==1)throw Error('SUPPORT_INVALID_QUERY');
 const actorId=actorIdentifier(url.searchParams.get('actorId'));
 const end=url.searchParams.has('end')?date(url.searchParams.get('end')):new Date().toISOString();
 const start=url.searchParams.has('start')?date(url.searchParams.get('start')):end?new Date(Date.parse(end)-86400000).toISOString():undefined;
 const rawLimit=url.searchParams.get('limit')??'50',limit=Number(rawLimit);
 if(!actorId||!start||!end||start>end||Date.parse(end)-Date.parse(start)>7*86400000||!/^\d{1,3}$/.test(rawLimit)||limit<1||limit>100)throw Error('SUPPORT_INVALID_QUERY');
 const query={actorId,start,end,limit};
 for(const key of ['taskId','requestId','traceId','projectId']){
  if(!url.searchParams.has(key))continue;
  const value=identifier(url.searchParams.get(key));if(!value)throw Error('SUPPORT_INVALID_QUERY');query[key]=value;
 }
 return query;
}
export function requestMetadata(req){
 return {requestId:identifier(req.headers['x-request-id'])||identifier(req.headers['x-fg-operation-id'])||randomUUID(),
  traceId:identifier(req.headers['x-trace-id']),taskId:identifier(req.headers['x-fg-task-id']),projectId:identifier(req.headers['x-fg-project-id'])};
}
export function observeRequest(req,res,{actorId,route,metadata=requestMetadata(req)}){
 const path=new URL(req.url,'http://local').pathname;
 if(/^\/(?:internal\/support(?:\/|$)|health(?:\/|$)|version(?:\/|$)|api\/(?:health|version)(?:\/|$))/.test(path)||['/status','/validate','/api/config'].includes(route))return;
 const began=Date.now();let emitted=false;
 const finish=()=>{
  if(emitted)return;emitted=true;
  const entry={event:'support_http_request',timestamp:new Date().toISOString(),service:SERVICE,
   actor_id:actorIdentifier(actorId)||null,request_id:metadata.requestId,
   trace_id:metadata.traceId||null,task_id:metadata.taskId||null,project_id:metadata.projectId||null,
   method:['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(req.method)?req.method:'OTHER',route,
   http_status:res.writableFinished?res.statusCode:499,duration_ms:Math.max(0,Date.now()-began),
   error_code:res.supportErrorCode||null,build_commit:build.commit,build_version:build.version,build_time:build.buildTime,build_environment:build.environment,build_dirty:build.dirty};
  persistLog(entry);console.log(JSON.stringify(entry));
 };
 res.once('finish',finish);res.once('close',finish);
}
export async function requestLogs(query){
 let result;try{result=await readLogs(query);}catch{return {logs:[],truncated:false,incomplete:true,coverage:{available:false,reason:'SUPPORT_LOG_READ_FAILED',retention:'Persistent native log store unavailable.'}};}
 const {logs,truncated,incomplete,...coverage}=result;
 const valid=logs.filter(entry=>entry&&typeof entry==='object'&&entry.event==='support_http_request'&&entry.service===SERVICE&&date(entry.timestamp)&&identifier(entry.request_id)&&actorIdentifier(entry.actor_id)&&Number.isInteger(entry.http_status)&&typeof entry.route==='string'&&typeof entry.method==='string');
 if(valid.length!==logs.length){coverage.available=false;coverage.reason='SUPPORT_LOG_INVALID_ENTRY';}
 const fields=['event','timestamp','service','actor_id','request_id','trace_id','task_id','project_id','method','route','http_status','duration_ms','error_code','build_commit','build_version','build_time','build_environment','build_dirty'];
 return {logs:valid.map(entry=>Object.fromEntries(fields.filter(key=>entry[key]!==undefined).map(key=>[key,entry[key]]))),truncated,incomplete:incomplete||valid.length!==logs.length,coverage};
}
export function recordMatches(record,query){
 return record.updatedAt>=query.start&&record.updatedAt<=query.end&&['taskId','requestId','traceId','projectId'].every(key=>!query[key]||record[key]===query[key]||(key==='taskId'&&record.id===query[key]));
}
export function recordStatus(value){
 return ['active','deleted','recorded','draft','queued','running','awaiting_confirmation','confirmed','submitted','sending','succeeded','failed','cancelled','archiving','recovering','rejected','uncertain','done','complete'].includes(value)?value:'unknown';
}
export const errorCode=value=>typeof value==='string'&&/^[A-Z][A-Z0-9_]{1,79}$/.test(value)?value:undefined;
