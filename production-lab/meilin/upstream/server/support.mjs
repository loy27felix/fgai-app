import {database} from './fg-store.mjs';
import {build,supportAuthorized,supportQuery,requestLogs,identifier,errorCode,recordStatus} from './support-common.mjs';

async function records(query){
 const db=await database();
 // Authorize in PostgreSQL before projecting metadata; never load another actor's document.
 // 先在 PostgreSQL 检查所有者/成员，再投影元数据，不读取其他成员的完整文档。
 const result=await db.query(`WITH visible AS (
  SELECT d.* FROM fg_meilin_dramas d WHERE
   (d.owner_id=$1 OR EXISTS(SELECT 1 FROM fg_meilin_members m WHERE m.drama_id=d.id AND m.user_id=$1))
   AND ($4::text IS NULL OR d.id::text=$4)
 ), evidence AS (
  SELECT d.id::text AS id,'project' AS kind,CASE WHEN d.deleted_at IS NULL THEN 'active' ELSE 'deleted' END AS status,
   d.created_at,d.updated_at,d.id::text AS project_id,NULL::text AS task_id,NULL::text AS request_id,NULL::text AS trace_id,NULL::text AS error_code
  FROM visible d
  UNION ALL
  SELECT 'event:'||e.id,'event','recorded',e.created_at,e.created_at,d.id::text,
   e.detail->>'taskId',e.detail->>'requestId',e.detail->>'traceId',NULL
  FROM fg_meilin_events e JOIN visible d ON d.id=e.drama_id WHERE e.actor_id=$1
  UNION ALL
  SELECT p->>'id','production',p->>'status',
   CASE WHEN p->>'quotedAt' ~ '^[0-9]{1,13}$' THEN to_timestamp((p->>'quotedAt')::double precision/1000) ELSE NULL END,
   d.updated_at,d.id::text,p->>'taskId',p->>'requestId',p->>'traceId',p->>'errorCode'
  FROM visible d CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(d.document->'production')='array' THEN d.document->'production' ELSE '[]'::jsonb END) p
  UNION ALL
  SELECT r->>'id','studio_run',r->>'status',NULL::timestamptz,d.updated_at,d.id::text,r->>'taskId',r->>'requestId',r->>'traceId',r->>'errorCode'
  FROM visible d CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(d.document->'studio'->'runs')='array' THEN d.document->'studio'->'runs' ELSE '[]'::jsonb END) r
 ) SELECT * FROM evidence WHERE updated_at >= $2::timestamptz AND updated_at <= $3::timestamptz
  AND ($5::text IS NULL OR task_id=$5 OR (kind IN ('production','studio_run') AND id=$5)) AND ($6::text IS NULL OR request_id=$6) AND ($7::text IS NULL OR trace_id=$7)
 ORDER BY updated_at DESC,id LIMIT $8`,[query.actorId,query.start,query.end,query.projectId||null,query.taskId||null,query.requestId||null,query.traceId||null,query.limit+1]);
 return {records:result.rows.slice(0,query.limit).map(row=>({id:row.id,kind:row.kind,status:recordStatus(row.status),
  ...(row.created_at?{createdAt:new Date(row.created_at).toISOString()}:{}),updatedAt:new Date(row.updated_at).toISOString(),projectId:row.project_id,
  ...(identifier(row.task_id)?{taskId:row.task_id}:{}),...(identifier(row.request_id)?{requestId:row.request_id}:{}),
  ...(identifier(row.trace_id)?{traceId:row.trace_id}:{}),...(errorCode(row.error_code)?{errorCode:row.error_code}:{})})),truncated:result.rows.length>query.limit};
}
export async function supportRequest(req,res,send){
 const url=new URL(req.url,'http://meilin');
 if(url.pathname!=='/internal/support'&&!url.pathname.startsWith('/internal/support/'))return false;
 const fail=(status,errorCode)=>send(res,status,{errorCode,error:{code:errorCode}});
 if(!supportAuthorized(req)){fail(403,'SUPPORT_FORBIDDEN');return true;}
 if(req.method!=='GET'){fail(405,'SUPPORT_METHOD_NOT_ALLOWED');return true;}
 if(url.pathname==='/internal/support/version'){send(res,200,{service:'meilin',build});return true;}
 if(url.pathname!=='/internal/support/evidence'){fail(404,'SUPPORT_NOT_FOUND');return true;}
 let query;try{query=supportQuery(url);}catch{fail(400,'SUPPORT_INVALID_QUERY');return true;}
 const logs=await requestLogs(query);let result,storageAvailable=true;
 try{result=await records(query);}catch{storageAvailable=false;result={records:[],truncated:false};}
 send(res,200,{service:'meilin',build,scope:{actorId:query.actorId,start:query.start,end:query.end,...Object.fromEntries(['taskId','requestId','traceId','projectId'].filter(key=>query[key]!==undefined).map(key=>[key,query[key]]))},records:result.records,logs:logs.logs,
  coverage:{operations:{available:storageAvailable,...(!storageAvailable?{reason:'SUPPORT_STORAGE_UNAVAILABLE'}:{}),
   source:['fg_meilin_dramas','fg_meilin_members','fg_meilin_events'],ownership:'current owner or member; events additionally require actor_id match',
   timeField:'updatedAt (nested production/studio records use parent document snapshot time)',
   correlation:'Only persisted identifiers are searchable; historical event requestId/traceId and task error codes may be absent.'},inboundHttp:logs.coverage},
  incomplete:!storageAvailable||logs.incomplete,truncated:result.truncated||logs.truncated});
 return true;
}
