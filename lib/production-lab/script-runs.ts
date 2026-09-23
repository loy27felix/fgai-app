import { createHash } from "node:crypto";
import { database } from "./store";
export function requestFingerprint(value:unknown){return createHash("sha256").update(JSON.stringify(value)).digest("hex");}
export async function reserveScriptRun(actor:string,requestId:string,hash:string,model:string,skills:unknown,projectId:string,taskId:string,episode:number){
  if(!/^[0-9a-f-]{36}$/i.test(requestId))throw new Error("请求编号无效");
  const inserted=await database().query("INSERT INTO production_lab_script_runs(actor_id,request_id,request_hash,model_id,status,skill_versions,project_id,task_id,episode) VALUES($1,$2,$3,$4,'running',$5::jsonb,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING request_id",[actor,requestId,hash,model,JSON.stringify(skills),projectId,taskId,episode]);
  if(inserted.rowCount)return {fresh:true as const};
  const found=await database().query("SELECT request_hash,status,result FROM production_lab_script_runs WHERE actor_id=$1 AND request_id=$2",[actor,requestId]);
  const run=found.rows[0];
  if(!run||run.request_hash!==hash)throw new Error("同一请求编号不能更改输入或模型");
  return {fresh:false as const,status:run.status as string,result:run.result};
}
export async function finishScriptRun(actor:string,id:string,status:"succeeded"|"failed"|"unknown",result:unknown,error:string|null){
  await database().query("UPDATE production_lab_script_runs SET status=$3,result=$4::jsonb,error=$5,updated_at=now() WHERE actor_id=$1 AND request_id=$2",[actor,id,status,JSON.stringify(result),error]);
}
export async function recentScriptRuns(actor:string,projectId?:string){
  const result=await database().query("SELECT request_id,model_id,project_id,task_id,episode,CASE WHEN status='running' AND updated_at < now()-interval '3 minutes' THEN 'unknown' ELSE status END AS status,skill_versions,result,error,created_at,updated_at FROM production_lab_script_runs WHERE actor_id=$1 AND ($2::text IS NULL OR project_id=$2) ORDER BY created_at DESC LIMIT 30",[actor,projectId||null]);
  return result.rows;
}
