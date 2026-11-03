import {database} from './fg-store.mjs';

let pending=Promise.resolve(),writeFailed=false;
export function persistLog(entry){
 pending=pending.then(async()=>{
  const db=await database();
  await db.query('INSERT INTO fg_meilin_support_http(actor_id,created_at,entry) VALUES($1,$2,$3)',[entry.actor_id,entry.timestamp,entry]);
 }).catch(()=>{writeFailed=true;});
}
export async function readLogs(query){
 await pending;
 const base={source:'fg_meilin_support_http+stdout',retention:'Persistent PostgreSQL rows across restarts; no automatic deletion; at most 101 rows per evidence read.'};
 try{
  const db=await database();
  const since=(await db.query('SELECT min(created_at) AS since FROM fg_meilin_support_http')).rows[0]?.since;
  const result=await db.query(`SELECT entry FROM fg_meilin_support_http WHERE actor_id=$1 AND created_at >= $2::timestamptz AND created_at <= $3::timestamptz
   AND ($4::text IS NULL OR entry->>'task_id'=$4) AND ($5::text IS NULL OR entry->>'request_id'=$5)
   AND ($6::text IS NULL OR entry->>'trace_id'=$6) AND ($7::text IS NULL OR entry->>'project_id'=$7)
   ORDER BY created_at DESC,id DESC LIMIT $8`,[query.actorId,query.start,query.end,query.taskId||null,query.requestId||null,query.traceId||null,query.projectId||null,query.limit+1]);
  const availableSince=since?new Date(since).toISOString():null;
  return {...base,logs:result.rows.slice(0,query.limit).map(row=>row.entry),truncated:result.rows.length>query.limit,
   available:!writeFailed,availableSince,incomplete:writeFailed||!availableSince||query.start<availableSince,
   ...(writeFailed?{reason:'SUPPORT_LOG_WRITE_FAILED'}:!availableSince||query.start<availableSince?{reason:'Requested window predates the first persisted HTTP log; no historical backfill.'}:{})};
 }catch{return {...base,logs:[],truncated:false,available:false,incomplete:true,reason:'SUPPORT_LOG_STORAGE_UNAVAILABLE'};}
}
