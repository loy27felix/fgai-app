import {useEffect,useState} from "react";
import {Alert,Button,Card,Input,Select,Space,Tabs,Upload,Typography} from "antd";
import {generateCompanySpeech,createSpeechJob,speechJobs,speechSRT,type SpeechJob} from "@/services/api/fg-speech";
import {uploadResourceFile} from "@/services/api/resources";
import {fgSpeechVoices,fgDefaultSpeechVoice} from "@/lib/fg-speech-voices";
import {useSearchParams} from "react-router";
import {FGStreamingSpeech} from "@/components/fg-streaming-speech";
import { AudioSlats } from "@/components/ui/fg-workspace-atmosphere";
import { AudioLines, Mic2, Captions, Radio, Languages, Sparkles } from "lucide-react";
import { FGVoicePreview } from "@/components/fg-voice-preview";
import "@/styles/fg-audio-workspace.css";

export default function FGAudioToolsPage(){
 const [params]=useSearchParams();const context=params.get("advertising")?{fgAdWorkspaceId:params.get("advertising")}:{};
 const initialTab=params.get("tab")||"speech";
 const [tab,setTab]=useState(["speech","sound","streaming","transcription","translation"].includes(initialTab)?initialTab:"speech"),[text,setText]=useState(""),[voice,setVoice]=useState<string>(fgDefaultSpeechVoice),[busy,setBusy]=useState(false),[error,setError]=useState(""),[audio,setAudio]=useState(""),[jobs,setJobs]=useState<SpeechJob[]>([]),[target,setTarget]=useState("en");
 const content=text,canSubmit=!!content.trim();
 const refresh=async()=>{const data=await speechJobs();setJobs(data.jobs);};
 useEffect(()=>{void refresh().catch(e=>setError(e.message));const timer=setInterval(()=>void refresh().catch(()=>{}),15000);return()=>clearInterval(timer);},[]);
 useEffect(()=>()=>{if(audio)URL.revokeObjectURL(audio);},[audio]);
 async function run(){
  if(!canSubmit)return;setBusy(true);setError("");
  try{
   if(tab==="translation"){await createSpeechJob({...context,kind:"translation",operationId:crypto.randomUUID(),texts:[text],source:"zh",target});await refresh();}
   else{const blob=await generateCompanySpeech({...context,model:tab==="sound"?"seed-audio-1.0":"seed-tts-2.0",input:content,voice:tab==="sound"?"prompt":voice,response_format:"mp3",speed:1},crypto.randomUUID());setAudio(URL.createObjectURL(blob));}
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
 return <main className="fg-audio-workspace app-workspace-scroll"><div className="fg-audio-container">
  <header className="fg-audio-header"><div><span className="fg-audio-eyebrow"><AudioLines size={15}/> FG / AUDIO STUDIO</span><Typography.Title level={1}>让创作，有自己的声音。</Typography.Title><Typography.Paragraph>角色配音、音效、识别与翻译，共用公司的制作渠道。</Typography.Paragraph></div><AudioSlats /></header>
  <Tabs className="fg-audio-tabs" activeKey={tab} onChange={setTab} items={[{key:"speech",label:"角色配音",icon:<Mic2 size={16}/>},{key:"sound",label:"对白与音效",icon:<Sparkles size={16}/>},{key:"streaming",label:"实时识别",icon:<Radio size={16}/>},{key:"transcription",label:"录音与字幕",icon:<Captions size={16}/>},{key:"translation",label:"文本翻译",icon:<Languages size={16}/>}]}/>
  <div className="fg-audio-layout"><section className="fg-audio-editor" aria-label="音频创作">
  <Card className="fg-audio-composer" title={tab==="speech"?"角色配音":tab==="sound"?"对白与音效":tab==="streaming"?"实时语音识别":tab==="transcription"?"录音与字幕":"文本翻译"}>
   {tab==="streaming"?<FGStreamingSpeech advertising={params.get("advertising")} onComplete={()=>void refresh().catch(()=>{})}/>:tab==="transcription"?<Space direction="vertical"><Typography.Text>上传录音后异步识别，不需要一直停留在本页。再次打开可以查看原任务。</Typography.Text><Upload accept="audio/*" showUploadList={false} beforeUpload={file=>transcribe(file)} disabled={busy}><Button loading={busy}>上传录音并识别</Button></Upload></Space>:<Space direction="vertical" style={{width:"100%"}}>
    {tab==="speech"&&<Select aria-label="配音音色" value={voice} onChange={setVoice} options={fgSpeechVoices} style={{width:"100%"}}/>}
    {tab==="speech"&&<FGVoicePreview voice={voice}/>}
    {tab==="sound"&&<Typography.Paragraph type="secondary">直接描述你要的声音与对白，无需设置音色。单次音频最长 2 分钟，长篇旁白请使用“角色配音”。</Typography.Paragraph>}
    {tab==="translation"&&<Select aria-label="翻译目标语言" value={target} onChange={setTarget} options={[{value:"en",label:"中文 → 英语"},{value:"ja",label:"中文 → 日语"},{value:"ko",label:"中文 → 韩语"}]} style={{width:220}}/>}
    <Input.TextArea aria-label="音频制作内容" value={text} onChange={e=>setText(e.target.value)} maxLength={tab==="sound"?3000:12000} showCount rows={7} placeholder={tab==="sound"?"描述人物对白、环境声音或音效":"输入需要配音或翻译的文本"}/>
    <Space wrap className="fg-audio-actions"><Button size="large" type="primary" loading={busy} disabled={!canSubmit} onClick={()=>void run()}>{tab==="translation"?"翻译":"生成音频"}</Button>
    </Space>
   </Space>}
   {audio&&<audio controls src={audio} className="mt-4 w-full"/>}
  </Card>
  {error&&<Alert type="error" title={error}/>}
  </section><aside className="fg-audio-guide" aria-label="音频制作说明"><span className="fg-audio-eyebrow">AUDIO STUDIO</span><h2>让角色，<br/>有自己的声音。</h2><p>选择音色生成角色配音，描述环境音效，或上传录音进行识别和翻译。</p><div className="fg-audio-guide-rule"/><h3>一份内容，各处使用</h3><p>已保存的音频可从资产库添加到画布；识别与翻译结果在下方记录查看和导出。</p></aside></div>
  <section className="fg-audio-history" aria-label="识别与翻译记录">
  <Typography.Title level={4}>识别与翻译记录</Typography.Title>
  {jobs.map(job=><Card key={job.id} size="small" title={job.kind==="streaming"?"实时语音识别":job.kind==="transcription"?"录音识别":"文本翻译"} extra={job.status==="succeeded"?<Button onClick={()=>download(job)}>导出{job.result?.segments?.length?"字幕":"文本"}</Button>:null}><Typography.Paragraph style={{whiteSpace:"pre-wrap"}}>{job.result?.text||job.error||({reserved:"正在登记",sending:"等待供应商确认",submitted:"正在识别",failed:"处理失败"}[job.status]||job.status)}</Typography.Paragraph></Card>)}
  {jobs.length===0&&<div className="fg-audio-empty"><Captions size={24}/><p>你的识别与翻译记录会出现在这里</p><span>上传录音，或开始一次文本翻译。</span></div>}
  </section></div></main>;
}
