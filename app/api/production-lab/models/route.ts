import { NextResponse } from "next/server";
import { labActor } from "@/lib/production-lab/access";
import { labTextModels, scriptMessages } from "@/lib/production-lab/text-models";
import { scriptSkillContext, scriptSkillCatalog } from "@/lib/production-lab/script-skills";
import { reserveScriptRun, finishScriptRun, recentScriptRuns, requestFingerprint } from "@/lib/production-lab/script-runs";
import { readLab } from "@/lib/production-lab/store";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(req:Request){
  const actor=await labActor();
  if(!actor)return NextResponse.json({error:"无试用权限"},{status:403});
  if(new URL(req.url).searchParams.get("view")==="runs"){
    const projectId=new URL(req.url).searchParams.get("projectId")||undefined;
    try{
      if(projectId){
        const state=await readLab();
        const project=state.projects.find(item=>item.id===projectId);
        if(!project)return NextResponse.json({error:"项目不存在"},{status:404});
        if(project.ownerId!==actor.id&&!actor.reviewer)return NextResponse.json({error:"无权查看此项目的运行记录"},{status:403});
      }
      return NextResponse.json({runs:await recentScriptRuns(actor.id,projectId)});
    }catch{return NextResponse.json({error:"独立任务数据库尚未初始化"},{status:503});}
  }
  try{return NextResponse.json({models:labTextModels().map(m=>({id:m.id,label:m.label,configured:true})),skills:scriptSkillCatalog});}
  catch{return NextResponse.json({error:"独立模型配置无效"},{status:503});}
}
export async function POST(req:Request){
  const actor=await labActor();
  if(!actor)return NextResponse.json({error:"无试用权限"},{status:403});
  if(req.headers.get("origin")!==new URL(req.url).origin)return NextResponse.json({error:"请求来源无效"},{status:403});
  const raw=await req.text();if(raw.length>60000)return NextResponse.json({error:"请求过大"},{status:413});
  type Body = Parameters<typeof scriptMessages>[0] & {model:string;requestId:string;projectId:string;taskId:string};
  let body:Body, model: ReturnType<typeof labTextModels>[number] | undefined;
  try{body=JSON.parse(raw);model=labTextModels().find(m=>m.id===body.model);}
  catch{return NextResponse.json({error:"请求或独立模型配置无效"},{status:400});}
  if(typeof body.brief!=="string"||body.brief.length>20000||typeof body.projectId!=="string"||typeof body.taskId!=="string")return NextResponse.json({error:"项目、分集或补充要求格式无效"},{status:400});
  if(!model)return NextResponse.json({error:"所选模型尚未配置"},{status:503});
  let state:Awaited<ReturnType<typeof readLab>>;
  try{state=await readLab();}catch{return NextResponse.json({error:"独立项目数据库尚未初始化"},{status:503});}
  const project=state.projects.find(item=>item.id===body.projectId);
  const task=state.tasks.find(item=>item.id===body.taskId);
  if(!project||!task||task.projectId!==project.id||task.episode!==body.episode)return NextResponse.json({error:"当前项目没有对应分集任务，请先在项目推进中建立任务"},{status:409});
  if(project.ownerId!==actor.id&&!actor.reviewer)return NextResponse.json({error:"无权生成此项目的剧本"},{status:403});
  if(!["立项草案","剧本开发"].includes(project.stage)||task.directionSnapshot!==project.direction||task.bibleSnapshot!==project.bible)return NextResponse.json({error:"项目创作依据已变更或已进入制作，请刷新项目后再生成"},{status:409});
  const brief=[`项目：${project.title} / ${project.tier} 级 / ${project.market} / ${project.style}`,`已确认方向：\n${project.direction}`,`故事圣经：\n${project.bible}`,`分集任务：${task.title}`,body.brief.trim()?`本批补充要求：\n${body.brief.trim()}`:"本批无额外要求。按项目方向与故事圣经编写，遵守分集任务和连续性，不擅自改写已确认角色、世界规则或分集大纲。"].join("\n\n");
  let messages:ReturnType<typeof scriptMessages>;
  try{messages=scriptMessages({...body,brief});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"剧本请求格式无效"},{status:400});}
  const skillVersions=scriptSkillContext(body.skillIds).versions;
  try{
    const reservation=await reserveScriptRun(actor.id,body.requestId,requestFingerprint({model:model.model,endpoint:model.endpoint,messages}),body.model,skillVersions,project.id,task.id,task.episode);
    if(!reservation.fresh){
      if(reservation.status==="succeeded")return NextResponse.json({...reservation.result,replayed:true});
      return NextResponse.json({error:"该请求已提交，状态未成功，不会重复扣费调用；请查看生成记录",requestId:body.requestId},{status:409});
    }
  }catch{return NextResponse.json({error:"任务登记失败或请求编号冲突，未调用模型；请检查独立数据库与请求编号"},{status:503});}
  async function fail(error:string,status:"failed"|"unknown"="unknown"){
    try{await finishScriptRun(actor!.id,body.requestId,status,null,error);}catch{/* Reservation remains and blocks accidental resubmission. */}
    return NextResponse.json({error,requestId:body.requestId},{status:502});
  }
  try{
    const upstream=await fetch(model.endpoint,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${model.apiKey}`},body:JSON.stringify({model:model.model,messages,max_tokens:6000}),signal:AbortSignal.timeout(120000),redirect:"error",cache:"no-store"});
    if(!upstream.ok)return fail(`模型服务返回 ${upstream.status}，未自动重试；请核对服务商计费记录`,"failed");
    const data=await upstream.json();const text=data?.choices?.[0]?.message?.content;
    if(typeof text!=="string"||!text.trim())return fail("模型未返回可用剧本；请核对供应商计费记录");
    const result={text,model:body.model,usage:data.usage||null,requestId:body.requestId,skillVersions,projectId:project.id,taskId:task.id,episode:task.episode};
    try{await finishScriptRun(actor.id,body.requestId,"succeeded",result,null);}catch{return NextResponse.json({...result,persistenceWarning:"模型已返回但任务结果保存失败，请立即复制剧本并核对记录"});}
    return NextResponse.json(result);
  }catch{return fail("模型调用中断或超时；可能已经计费，请先核对供应商记录");}
}
