import {useEffect,useState} from "react";
import {Alert,Button,Card,Input,Select,Space,Tabs,Upload,Typography} from "antd";
import {generateCompanySpeech,companyMusicStatus,createSpeechJob,speechJobs,speechSRT,type SpeechJob,type CompanyMusicStatus} from "@/services/api/fg-speech";
import {uploadResourceFile} from "@/services/api/resources";
import {fgSpeechVoices,fgDefaultSpeechVoice} from "@/lib/fg-speech-voices";
import {useSearchParams} from "react-router";
import {FGStreamingSpeech} from "@/components/fg-streaming-speech";
import { AudioSlats } from "@/components/ui/fg-workspace-atmosphere";
import { AudioLines, Music2, Mic2, Captions, Radio, Languages, Sparkles } from "lucide-react";
import "@/styles/fg-audio-workspace.css";

export default function FGAudioToolsPage(){
 const [params]=useSearchParams();const context=params.get("advertising")?{fgAdWorkspaceId:params.get("advertising")}:{};
 const initialTab=params.get("tab")||"music";
 const [tab,setTab]=useState(["speech","music","sound","streaming","transcription","translation"].includes(initialTab)?initialTab:"music"),[text,setText]=useState(""),[voice,setVoice]=useState<string>(fgDefaultSpeechVoice),[busy,setBusy]=useState(false),[error,setError]=useState(""),[audio,setAudio]=useState(""),[jobs,setJobs]=useState<SpeechJob[]>([]),[target,setTarget]=useState("en");
 const [musicStatus,setMusicStatus]=useState<CompanyMusicStatus>(),[musicVoice,setMusicVoice]=useState("song"),[musicMode,setMusicMode]=useState("custom"),[musicModel,setMusicModel]=useState("auto"),[musicTitle,setMusicTitle]=useState(""),[musicStyles,setMusicStyles]=useState(""),[musicLyrics,setMusicLyrics]=useState("");
 const [copied,setCopied]=useState(false);
 useEffect(()=>setCopied(false),[musicVoice,musicMode,musicModel,musicTitle,musicStyles,musicLyrics,text]);
 const musicReady=musicStatus?.enabled===true,content=tab==="music"&&musicMode==="custom"?musicStyles:text;
 const canSubmit=!!content.trim()&&!(tab==="music"&&musicMode==="custom"&&musicVoice==="song"&&!musicLyrics.trim());
 const refresh=async()=>{const data=await speechJobs();setJobs(data.jobs);};
 useEffect(()=>{void refresh().catch(e=>setError(e.message));const timer=setInterval(()=>void refresh().catch(()=>{}),15000);return()=>clearInterval(timer);},[]);
 useEffect(()=>()=>{if(audio)URL.revokeObjectURL(audio);},[audio]);
 useEffect(()=>{const check=()=>void companyMusicStatus().then(setMusicStatus).catch(()=>setMusicStatus(undefined));check();const timer=setInterval(check,30000);return()=>clearInterval(timer);},[]);
 async function run(){
  if(!canSubmit)return;setBusy(true);setError("");
  try{
   if(tab==="translation"){await createSpeechJob({...context,kind:"translation",operationId:crypto.randomUUID(),texts:[text],source:"zh",target});await refresh();}
   else{const blob=await generateCompanySpeech({...context,model:tab==="music"?"suno-company-music":tab==="sound"?"seed-audio-1.0":"seed-tts-2.0",input:content,voice:tab==="music"?musicVoice:tab==="sound"?"prompt":voice,response_format:"mp3",speed:1,...(tab==="music"?{suno:{mode:musicMode,model:musicModel,title:musicTitle,styles:musicMode==="custom"?musicStyles:"",lyrics:musicMode==="custom"&&musicVoice==="song"?musicLyrics:""}}:{})},crypto.randomUUID());setAudio(URL.createObjectURL(blob));}
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
  <header className="fg-audio-header"><div><span className="fg-audio-eyebrow"><AudioLines size={15}/> FG / AUDIO STUDIO</span><Typography.Title level={1}>让创作，有自己的声音。</Typography.Title><Typography.Paragraph>音乐、角色配音、声音与字幕，共用公司的制作渠道。</Typography.Paragraph></div><AudioSlats /></header>
  <Tabs className="fg-audio-tabs" activeKey={tab} onChange={setTab} items={[{key:"music",label:"音乐与歌曲",icon:<Music2 size={16}/>},{key:"speech",label:"角色配音",icon:<Mic2 size={16}/>},{key:"sound",label:"对白与音效",icon:<Sparkles size={16}/>},{key:"streaming",label:"实时识别",icon:<Radio size={16}/>},{key:"transcription",label:"录音与字幕",icon:<Captions size={16}/>},{key:"translation",label:"文本翻译",icon:<Languages size={16}/>}]}/>
  <div className="fg-audio-layout"><section className="fg-audio-editor" aria-label="音频创作">
  {tab==="music"&&!musicReady&&<Alert type="info" title={musicStatus?.accountReadable?"公司 Suno 账号已连接，等待生成验证":"公司 Suno 音乐渠道待开通"} description={musicStatus?.captchaRequired?"Suno 要求这次生成完成验证码。需要由管理员在公司账号浏览器处理，再核验服务器请求；网页通过不代表服务器已经获准。可先填写并复制下面的创作内容，在 Suno 官网继续。":"账号、生成和作品归档验证完成后开放制作。其他成员无需配置个人账号。"}/>}
  <Card className="fg-audio-composer" title={tab==="music"?"音乐创作":tab==="speech"?"角色配音":tab==="sound"?"对白与音效":tab==="streaming"?"实时语音识别":tab==="transcription"?"录音与字幕":"文本翻译"}>
   {tab==="streaming"?<FGStreamingSpeech advertising={params.get("advertising")} onComplete={()=>void refresh().catch(()=>{})}/>:tab==="transcription"?<Space direction="vertical"><Typography.Text>上传录音后异步识别，不需要一直停留在本页。再次打开可以查看原任务。</Typography.Text><Upload accept="audio/*" showUploadList={false} beforeUpload={file=>transcribe(file)} disabled={busy}><Button loading={busy}>上传录音并识别</Button></Upload></Space>:<Space direction="vertical" style={{width:"100%"}}>
    {tab==="speech"&&<Select aria-label="配音音色" value={voice} onChange={setVoice} options={fgSpeechVoices} style={{width:"100%"}}/>}
    {tab==="music"&&<>
     <div className="fg-audio-options">
      <Select aria-label="音乐类型" value={musicVoice} onChange={setMusicVoice} options={[{value:"instrumental",label:"纯音乐 / 配乐"},{value:"song",label:"带人声歌曲"}]} style={{width:180}}/>
      <Select aria-label="音乐创作方式" value={musicMode} onChange={setMusicMode} options={[{value:"custom",label:"自填歌词与风格"},{value:"inspiration",label:"描述自动创作"}]} style={{width:180}}/>
      <Select aria-label="Suno 音乐模型" value={musicModel} onChange={setMusicModel} options={[{value:"auto",label:"公司默认模型"},...(musicStatus?.models||[]).map(m=>({value:m.id,label:m.name}))]} style={{width:200}}/>
     </div>
     <Input aria-label="歌曲标题" value={musicTitle} onChange={e=>setMusicTitle(e.target.value)} maxLength={100} placeholder="歌曲标题（选填）"/>
     {musicMode==="custom"&&<div className="fg-audio-music-fields"><div className="fg-audio-field"><Typography.Title level={5}>声音的方向</Typography.Title><Typography.Paragraph type="secondary">Styles · 描述风格、情绪、乐器与节奏</Typography.Paragraph>
      <Input.TextArea aria-label="音乐风格 Styles" value={musicStyles} onChange={e=>setMusicStyles(e.target.value)} maxLength={1000} showCount rows={3} placeholder="例如：温暖独立流行，90 BPM，木吉他与钢琴，轻快鼓点，清晰女声"/>
      </div><div className="fg-audio-field"><Typography.Title level={5}>歌曲的故事</Typography.Title><Typography.Paragraph type="secondary">Lyrics · 可使用 [Verse]、[Chorus] 标记段落</Typography.Paragraph>
      {musicVoice==="instrumental"&&<Typography.Text type="secondary">纯音乐不使用歌词。切换上方“带人声歌曲”即可填写。</Typography.Text>}
      <Input.TextArea aria-label="歌曲歌词 Lyrics" disabled={musicVoice==="instrumental"} value={musicLyrics} onChange={e=>setMusicLyrics(e.target.value)} maxLength={5000} showCount rows={8} placeholder={"[Verse]\n填写主歌歌词\n\n[Chorus]\n填写副歌歌词"}/>
     </div></div>}
    </>}
    {tab==="translation"&&<Select aria-label="翻译目标语言" value={target} onChange={setTarget} options={[{value:"en",label:"中文 → 英语"},{value:"ja",label:"中文 → 日语"},{value:"ko",label:"中文 → 韩语"}]} style={{width:220}}/>}
    {(tab!=="music"||musicMode!=="custom")&&<Input.TextArea aria-label="音频制作内容" value={text} onChange={e=>setText(e.target.value)} maxLength={tab==="music"?3000:12000} rows={7} placeholder={tab==="music"?"描述音乐风格、乐器、情绪和节奏；歌曲可说明歌词主题。":tab==="sound"?"描述人物对白、环境声音或音效，例如：脚步声、关门声与一句低声对白。":"输入需要配音或翻译的文本"}/>}
    <Space wrap className="fg-audio-actions"><Button size="large" type="primary" loading={busy} disabled={!canSubmit||(tab==="music"&&!musicReady)} onClick={()=>void run()}>{tab==="translation"?"翻译":tab==="music"?"制作音乐":"生成音频"}</Button>
    {tab==="music"&&<><Button disabled={!canSubmit} onClick={()=>void navigator.clipboard.writeText(musicMode==="custom"?`Title: ${musicTitle}\nModel: ${musicModel}\nType: ${musicVoice}\n\nStyles:\n${musicStyles}\n\nLyrics:\n${musicVoice==="song"?musicLyrics:"[Instrumental]"}`:`Title: ${musicTitle}\nModel: ${musicModel}\nType: ${musicVoice}\n\nDescription:\n${text}`).then(()=>setCopied(true)).catch(()=>setError("复制失败，请手动复制风格和歌词"))}>{copied?"已复制创作内容":"复制 Suno 创作内容"}</Button><Button href="https://suno.com/create" target="_blank" rel="noopener noreferrer">在 Suno 官网继续</Button></>}
    </Space>
   </Space>}
   {audio&&<audio controls src={audio} className="mt-4 w-full"/>}
  </Card>
  {error&&<Alert type="error" title={error}/>}
  </section><aside className="fg-audio-guide" aria-label="公司音频服务状态"><span className="fg-audio-eyebrow">COMPANY CHANNEL</span><h2>专注创作，<br/>连接交给 FG。</h2><div className="fg-audio-status"><span data-ready={musicReady} />{musicReady?"Suno 音乐服务可用":musicStatus?.accountReadable?"公司账号已连接 · 待验证生成":"Suno 渠道待配置"}</div><p>Suno 对公司成员免费，不占个人月额度或广告预算。火山配音、音效、识别与翻译也不受这些额度拦截；用量仍会记录。</p><div className="fg-audio-guide-rule"/><h3>一份内容，各处使用</h3><p>与画布、广告、创作台和导演台共用公司渠道。生成音频归档至 NAS 和制作历史，识别任务保存至服务器。</p><h3>歌词怎么填写</h3><p>选择“带人声歌曲”和“自填歌词与风格”，分别写入 Styles 与 Lyrics。纯音乐只需要描述声音风格。</p></aside></div>
  <section className="fg-audio-history" aria-label="识别与翻译记录">
  <Typography.Title level={4}>识别与翻译记录</Typography.Title>
  {jobs.map(job=><Card key={job.id} size="small" title={job.kind==="streaming"?"实时语音识别":job.kind==="transcription"?"录音识别":"文本翻译"} extra={job.status==="succeeded"?<Button onClick={()=>download(job)}>导出{job.result?.segments?.length?"字幕":"文本"}</Button>:null}><Typography.Paragraph style={{whiteSpace:"pre-wrap"}}>{job.result?.text||job.error||({reserved:"正在登记",sending:"等待供应商确认",submitted:"正在识别",failed:"处理失败"}[job.status]||job.status)}</Typography.Paragraph></Card>)}
  {jobs.length===0&&<div className="fg-audio-empty"><Captions size={24}/><p>你的识别与翻译记录会出现在这里</p><span>上传录音，或开始一次文本翻译。</span></div>}
  </section></div></main>;
}
