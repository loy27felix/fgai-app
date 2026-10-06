import {useEffect,useState} from "react";
import {Alert,Button,Card,Input,Select,Space,Tabs,Upload,Typography} from "antd";
import {generateCompanySpeech,companyMusicStatus,createSpeechJob,speechJobs,speechSRT,type SpeechJob} from "@/services/api/fg-speech";
import {uploadResourceFile} from "@/services/api/resources";
import {fgSpeechVoices,fgDefaultSpeechVoice} from "@/lib/fg-speech-voices";
import {useSearchParams} from "react-router";
import {FGStreamingSpeech} from "@/components/fg-streaming-speech";

export default function FGAudioToolsPage(){
 const [params]=useSearchParams();const context=params.get("advertising")?{fgAdWorkspaceId:params.get("advertising")}:{};
 const [tab,setTab]=useState("speech"),[text,setText]=useState(""),[voice,setVoice]=useState<string>(fgDefaultSpeechVoice),[busy,setBusy]=useState(false),[error,setError]=useState(""),[audio,setAudio]=useState(""),[jobs,setJobs]=useState<SpeechJob[]>([]),[target,setTarget]=useState("en");
 const [musicReady,setMusicReady]=useState(false),[musicVoice,setMusicVoice]=useState("instrumental");
 const refresh=async()=>{const data=await speechJobs();setJobs(data.jobs);};
 useEffect(()=>{void refresh().catch(e=>setError(e.message));const timer=setInterval(()=>void refresh().catch(()=>{}),15000);return()=>clearInterval(timer);},[]);
 useEffect(()=>()=>{if(audio)URL.revokeObjectURL(audio);},[audio]);
 useEffect(()=>{const check=()=>void companyMusicStatus().then(s=>setMusicReady(s.enabled)).catch(()=>setMusicReady(false));check();const timer=setInterval(check,30000);return()=>clearInterval(timer);},[]);
 async function run(){
  if(!text.trim())return;setBusy(true);setError("");
  try{
   if(tab==="translation"){await createSpeechJob({...context,kind:"translation",operationId:crypto.randomUUID(),texts:[text],source:"zh",target});await refresh();}
   else{const blob=await generateCompanySpeech({...context,model:tab==="music"?"suno-company-music":tab==="sound"?"seed-audio-1.0":"seed-tts-2.0",input:text,voice:tab==="music"?musicVoice:tab==="sound"?"prompt":voice,response_format:"mp3",speed:1},crypto.randomUUID());setAudio(URL.createObjectURL(blob));}
  }catch(e){setError(e instanceof Error?e.message:"音频请求失败，请查看原任务记录");}finally{setBusy(false);}
 }
 async function transcribe(file:File){
  setBusy(true);setError("");try{
   if(file.size>(50<<20)||!file.type.startsWith("audio/"))throw Error("请选择 50 MB 以内的 MP3、WAV 或其他录音文件");
   const resource=await uploadResourceFile(file,"audio",{fileName:file.name});
   await createSpeechJob({...context,kind:"transcription",operationId:crypto.randomUUID(),resourceId:resource.id});await refresh();
  }catch(e){setError(e instanceof Error?e.message:"录音识别提交失败");}finally{setBusy(false);}
  return false;
 }
 function download(job:SpeechJob){
  const hasSegments=!!job.result?.segments?.length,value=hasSegments?speechSRT(job.result!.segments!):job.result?.text||"";
  const url=URL.createObjectURL(new Blob([value],{type:"text/plain;charset=utf-8"}));const link=document.createElement("a");link.href=url;link.download=`FG-${job.id}.${hasSegments?"srt":"txt"}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 return <main className="mx-auto w-full max-w-5xl space-y-5 overflow-y-auto p-6">
  <Typography.Title level={3}>公司音频工具</Typography.Title>
  <Typography.Paragraph>画布、广告、创作台和导演台共用公司渠道。音频生成结果保存到 NAS 和制作历史；录音识别记录保存到服务器，可导出字幕。</Typography.Paragraph>
  <Alert type="info" title="费用待核验" description="火山音频、配音、语音识别和翻译暂不受月额度及项目预算上限拦截，费用与用量保留，等待火山账单核验。Suno 使用公司订阅账号制作独立音乐和歌曲，费用另行核验。"/>
  <Tabs activeKey={tab} onChange={setTab} items={[{key:"speech",label:"角色配音 · TTS 2.0"},{key:"music",label:"音乐与歌曲 · Suno"},{key:"sound",label:"对白与音效 · Seed Audio"},{key:"streaming",label:"实时语音识别"},{key:"transcription",label:"录音识别与字幕"},{key:"translation",label:"文本翻译"}]}/>
  {tab==="music"&&!musicReady&&<Alert type="info" title="公司 Suno 音乐渠道待开通" description="服务已接入，等待管理员填写公司账号凭据并通过验证后开放制作。其他成员无需配置个人账号。"/>}
  <Card>
   {tab==="streaming"?<FGStreamingSpeech advertising={params.get("advertising")} onComplete={()=>void refresh().catch(()=>{})}/>:tab==="transcription"?<Space direction="vertical"><Typography.Text>上传录音后异步识别，不需要一直停留在本页。再次打开可以查看原任务。</Typography.Text><Upload accept="audio/*" showUploadList={false} beforeUpload={file=>transcribe(file)} disabled={busy}><Button loading={busy}>上传录音并识别</Button></Upload></Space>:<Space direction="vertical" style={{width:"100%"}}>
    {tab==="speech"&&<Select aria-label="配音音色" value={voice} onChange={setVoice} options={fgSpeechVoices} style={{width:"100%"}}/>}
    {tab==="music"&&<Select aria-label="音乐类型" value={musicVoice} onChange={setMusicVoice} options={[{value:"instrumental",label:"纯音乐 / 配乐"},{value:"song",label:"带人声歌曲"}]} style={{width:220}}/>}
    {tab==="translation"&&<Select aria-label="翻译目标语言" value={target} onChange={setTarget} options={[{value:"en",label:"中文 → 英语"},{value:"ja",label:"中文 → 日语"},{value:"ko",label:"中文 → 韩语"}]} style={{width:220}}/>}
    <Input.TextArea aria-label="音频制作内容" value={text} onChange={e=>setText(e.target.value)} maxLength={tab==="music"?3000:12000} rows={7} placeholder={tab==="music"?"描述音乐风格、乐器、情绪和节奏；歌曲可说明歌词主题。":tab==="sound"?"描述人物对白、环境声音或音效，例如：脚步声、关门声与一句低声对白。":"输入需要配音或翻译的文本"}/>
    <Button type="primary" loading={busy} disabled={!text.trim()||(tab==="music"&&!musicReady)} onClick={()=>void run()}>{tab==="translation"?"翻译":tab==="music"?"制作音乐":"生成音频"}</Button>
   </Space>}
   {audio&&<audio controls src={audio} className="mt-4 w-full"/>}
  </Card>
  {error&&<Alert type="error" title={error}/>}
  <Typography.Title level={4}>识别与翻译记录</Typography.Title>
  {jobs.map(job=><Card key={job.id} size="small" title={job.kind==="streaming"?"实时语音识别":job.kind==="transcription"?"录音识别":"文本翻译"} extra={job.status==="succeeded"?<Button onClick={()=>download(job)}>导出{job.result?.segments?.length?"字幕":"文本"}</Button>:null}><Typography.Paragraph style={{whiteSpace:"pre-wrap"}}>{job.result?.text||job.error||({reserved:"正在登记",sending:"等待供应商确认",submitted:"正在识别",failed:"处理失败"}[job.status]||job.status)}</Typography.Paragraph></Card>)}
 </main>;
}
