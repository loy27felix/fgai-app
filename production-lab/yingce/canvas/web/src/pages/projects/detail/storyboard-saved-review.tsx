import {useState} from "react";
import {Alert,App,Button,Checkbox,Input,Select,Space} from "antd";
import {useQueryClient} from "@tanstack/react-query";
import {AppModal} from "@/components/ui/product/app-modal";
import {queryGenerationTask,type GenerationTask} from "@/services/api/task-center";
import type {ProjectDetail} from "@/services/api/projects";
import {storyboardBatchInfo} from "@/lib/chapter-storyboard-batches";
import {importSavedChapterStoryboard} from "./storyboard-result-import";
import {useStoryboardReferenceReview} from "./storyboard-reference-review";

/** Review stored provider output; this path never submits a model request. */
export function StoryboardSavedReview({detail,unitId,tasks}:{detail:ProjectDetail;unitId:string;tasks:GenerationTask[]}) {
 const {message,modal}=App.useApp(),client=useQueryClient(),review=useStoryboardReferenceReview();
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [edits,setEdits]=useState<Record<string,string>>({}),[selected,setSelected]=useState(""),[row,setRow]=useState(0),[reviewedDialogue,setReviewedDialogue]=useState(false);
 let document:{rows?:Array<Record<string,unknown>>}|undefined;
 try {document=JSON.parse((edits[selected]||"").replace(/^\s*```(?:json)?\s*|\s*```\s*$/g,""));} catch {}
 const rows=Array.isArray(document?.rows)?document.rows:[],current=rows[row];
 const load=async()=>{
  setBusy(true);setError("");setReviewedDialogue(false);
  try {
   const full=await Promise.all(tasks.map(task=>queryGenerationTask(task.id)));
   setEdits(Object.fromEntries(full.map(task=>{let text="";try{text=JSON.parse(task.resultJson||"{}").text||"";}catch{}return[task.id,text||task.textDraft||""];})));
   setSelected(full[0].id);setRow(0);setOpen(true);
  } catch(e){void message.error(e instanceof Error?e.message:"保存结果暂时读取失败");}finally{setBusy(false);}
 };
 const change=(key:string,value:string)=>{
  if(!document||!current)return;
  setEdits({...edits,[selected]:JSON.stringify({...document,rows:rows.map((item,index)=>index===row?{...item,[key]:value}:item)})});
 };
 const save=async()=>{
  const ids=detail.shots.filter(shot=>shot.unitId===unitId).map(shot=>shot.id);
  if(ids.length&&!await new Promise<boolean>(resolve=>modal.confirm({title:`替换本章 ${ids.length} 个现有镜头？`,content:"当前章节会更新为核对后的分镜；已有生成产物的旧镜头、脚本和引用会保留到独立的“成品保留”章节。不调用模型，不重新扣费。",okText:"确认替换",okButtonProps:{danger:true},onOk:()=>resolve(true),onCancel:()=>resolve(false)})))return;
  setBusy(true);setError("");
  try {
   const workspace=await importSavedChapterStoryboard(detail.project.id,unitId,tasks,review,ids,undefined,edits,{reviewedDialogue});
   client.setQueryData(["project",detail.project.id,"unit-workspace",unitId],workspace);
   await client.invalidateQueries({queryKey:["project",detail.project.id]});
   setOpen(false);void message.success(`已保存并回读确认 ${workspace.shots.length} 段分镜，没有重新生成`);
  }catch(e){setError(e instanceof Error?e.message:"导入未完成，草稿仍保留");}finally{setBusy(false);}
 };
 return <><Button size="small" loading={busy} disabled={detail.project.status==="archived"} onClick={()=>void load()}>核对 / 修正保存草稿</Button>
 <AppModal open={open} title="核对已保存分镜 · 不调用模型" width={1050} onCancel={()=>setOpen(false)} footer={<><Button onClick={()=>setOpen(false)}>返回</Button><Button type="primary" loading={busy} onClick={()=>void save()}>校验并导入当前内容</Button></>}>
  <p>先核对本段剧本对白与实际视频提示词。可直接修改；JSON 格式错误可在下方修正，不需要重跑成功批次。结构、时长、引用、章节版本和保存回读仍会校验，原任务不改。</p>
  {error&&<Alert type="warning" showIcon title={error}/>}
  <Space className="my-3" wrap><Select value={selected} aria-label="核对分镜批次" options={tasks.map(task=>({value:task.id,label:`第 ${storyboardBatchInfo(task)?.index||1} 批`}))} onChange={id=>{setSelected(id);setRow(0);}}/>{rows.length>0&&<Select value={row} aria-label="核对分镜片段" options={rows.map((item,index)=>({value:index,label:`第 ${index+1} 段 · ${item.durationSeconds||"?"} 秒`}))} onChange={setRow}/>}</Space>
  {current?<><p>剧情：{String(current.plotDescription||"")}</p><label>本段剧本对白<Input.TextArea aria-label="本段剧本对白" value={String(current.dialogue||"")} onChange={e=>change("dialogue",e.target.value)} autoSize={{minRows:2,maxRows:8}}/></label><label>实际视频提示词<Input.TextArea aria-label="核对视频提示词" value={String(current.videoMotionPrompt||"")} onChange={e=>change("videoMotionPrompt",e.target.value)} autoSize={{minRows:10,maxRows:22}}/></label></>:<Alert type="warning" title="草稿 JSON 格式未通过，修正下方原始结构后会显示分镜；不要补造模型没有返回的内容。"/>}
  <details className="my-3"><summary>原始 JSON（格式错误可在这里修正）</summary><Input.TextArea aria-label="已保存分镜 JSON" value={edits[selected]||""} onChange={e=>setEdits({...edits,[selected]:e.target.value})} autoSize={{minRows:10,maxRows:24}}/></details>
  <Checkbox checked={reviewedDialogue} onChange={e=>setReviewedDialogue(e.target.checked)}>我已核对，确认以当前视频提示词为准，允许它与本段剧本对白不同</Checkbox>
  <p className="text-xs text-foreground/60">默认仍核对原对白。勾选只确认本次导入的台词差异，不修改项目语言设置；视频实际演出以之后提交的视频提示词为准。</p>
 </AppModal></>;
}
