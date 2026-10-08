import {useEffect,useState} from "react";
import {Alert,Button,Card,Input,Space,Typography} from "antd";
import {musicJobs,startMusicJob,completeMusicJob,type MusicJob} from "@/services/api/fg-speech";
import {getResourceAccess,resolveResourceAccessURL} from "@/services/api/resources";
export function FGMusicJobs({epoch=0}:{epoch?:number}){
 const [jobs,setJobs]=useState<MusicJob[]>([]),[manage,setManage]=useState(false),[error,setError]=useState(""),[busy,setBusy]=useState(""),[clips,setClips]=useState<Record<string,string>>({}),[players,setPlayers]=useState<Record<string,string>>({});
 const refresh=async()=>{const data=await musicJobs();setJobs(data.jobs);setManage(data.canManage);};
 useEffect(()=>{let mounted=true;const update=()=>void musicJobs().then(data=>{if(mounted){setJobs(data.jobs);setManage(data.canManage);}}).catch(()=>{});update();const timer=setInterval(update,15000);return()=>{mounted=false;clearInterval(timer);};},[epoch]);
 async function action(job:MusicJob,kind:"start"|"complete"|"play"){
  setBusy(job.id);setError("");try{
   if(kind==="start")await startMusicJob(job.id);
   else if(kind==="complete")await completeMusicJob(job.id,clips[job.id]||job.clipId||"");
   else{const access=await getResourceAccess("resource:"+job.resourceId);if(!access?.url)throw Error("作品访问暂不可用");setPlayers(current=>({...current,[job.id]:resolveResourceAccessURL(access.url)}));}
   if(kind!=="play")await refresh();
  }catch(cause){setError(cause instanceof Error?cause.message:"操作未完成");}finally{setBusy("");}
 }
 return <section className="fg-audio-history" aria-label="音乐制作队列"><Typography.Title level={4}>{manage?"公司音乐制作队列":"我的音乐作品"}</Typography.Title>
 <Typography.Paragraph type="secondary">成员提交歌词与风格；管理员在公司 Suno 账号完成验证码和制作，再把作品归档到提交者的 NAS 资产。请按原任务处理，避免重复生成。</Typography.Paragraph>
 {error&&<Alert type="error" title={error}/>}
 {jobs.map(job=><Card key={job.id} title={job.brief.title||"未命名音乐"} extra={{queued:"等待管理员制作",processing:"管理员处理中",importing:"正在归档",succeeded:"已保存至 NAS"}[job.status]||job.status}>
  <Typography.Paragraph type="secondary">{manage?`${job.ownerName||"FG 成员"} · `:""}{job.brief.model} · {job.brief.voice==="song"?"歌曲":"纯音乐"}</Typography.Paragraph>
  <Space wrap><Button onClick={()=>void navigator.clipboard.writeText(`Title: ${job.brief.title}\nModel: ${job.brief.model}\nType: ${job.brief.voice}\n\nStyles:\n${job.brief.styles}\n\nLyrics:\n${job.brief.lyrics}\n\nDescription:\n${job.brief.description}`).catch(()=>setError("复制失败，请展开内容手动复制"))}>复制制作内容</Button>
   {manage&&job.status!=="succeeded"&&<Button loading={busy===job.id} onClick={()=>void action(job,"start")}>领取 / 恢复原任务</Button>}
   {!manage&&job.resourceId&&<Button loading={busy===job.id} onClick={()=>void action(job,"play")}>试听作品</Button>}
  </Space>
  {manage&&job.status==="processing"&&<div style={{marginTop:16}}><Typography.Paragraph>确认作品与本任务歌词和风格一致后，填写 Suno 作品链接中的 UUID。归档只下载已有作品，不再次生成。</Typography.Paragraph><Space.Compact style={{width:"100%"}}><Input aria-label={`Suno 作品 ID ${job.id}`} value={clips[job.id]||job.clipId||""} onChange={e=>setClips(current=>({...current,[job.id]:e.target.value.trim()}))} placeholder="例如：xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"/><Button type="primary" loading={busy===job.id} onClick={()=>void action(job,"complete")}>归档给成员</Button></Space.Compact></div>}
  <details style={{marginTop:16}}><summary>查看歌词与风格</summary><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{job.brief.mode==="custom"?`${job.brief.styles}\n\n${job.brief.lyrics}`:job.brief.description}</pre></details>
  {players[job.id]&&<audio controls src={players[job.id]} style={{width:"100%",marginTop:16}}/>}
 </Card>)}
 {jobs.length===0&&<div className="fg-audio-empty">提交一次音乐创作后，进度和作品会保留在这里。</div>}
 </section>;
}
