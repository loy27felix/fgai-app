import {useEffect,useRef,useState} from "react";
import {Alert,Button,Input,Space,Typography} from "antd";
import {AudioOutlined,CopyOutlined,StopOutlined} from "@ant-design/icons";
import {createPCMResampler} from "@/lib/fg-pcm-resampler";

type Capture={stream?:MediaStream;context?:AudioContext;node?:AudioWorkletNode;socket?:WebSocket;moduleURL?:string;stopped:boolean;stopping?:boolean;flushed?:()=>void;pending:Uint8Array;timer?:ReturnType<typeof setTimeout>};
export function FGStreamingSpeech({advertising,onComplete}:{advertising?:string|null;onComplete?:()=>void}){
 const [state,setState]=useState<"idle"|"connecting"|"recording"|"finishing">("idle"),[text,setText]=useState(""),[error,setError]=useState("");
 const capture=useRef<Capture|null>(null),alive=useRef(true);
 async function release(c:Capture,closeSocket=true){
  c.stopped=true;c.flushed?.();clearTimeout(c.timer);c.node?.disconnect();c.stream?.getTracks().forEach(track=>track.stop());
  if(c.context&&c.context.state!=="closed")await c.context.close().catch(()=>{});if(c.moduleURL)URL.revokeObjectURL(c.moduleURL);
  if(closeSocket)c.socket?.close();if(capture.current===c)capture.current=null;
 }
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;if(capture.current)void release(capture.current);};},[]);
 async function stop(){
  const c=capture.current;if(!c||c.stopped||c.stopping)return;c.stopping=true;clearTimeout(c.timer);setState("finishing");
  c.stream?.getTracks().forEach(track=>track.stop());
  if(c.node)await new Promise<void>(resolve=>{const timeout=setTimeout(resolve,1000);c.flushed=()=>{clearTimeout(timeout);resolve();};c.node!.port.postMessage("flush");});
  if(c.stopped)return;c.stopped=true;
  if(c.pending.length&&c.socket?.readyState===WebSocket.OPEN)c.socket.send(c.pending.slice().buffer);c.pending=new Uint8Array(0);
  c.stream?.getTracks().forEach(track=>track.stop());c.node?.disconnect();await c.context?.close().catch(()=>{});
  if(c.socket?.readyState===WebSocket.OPEN)c.socket.send(JSON.stringify({type:"stop"}));
 }
 async function start(){
  if(capture.current)return;setState("connecting");setError("");setText("");
  const c:Capture={stopped:false,pending:new Uint8Array(0)};capture.current=c;
  try{
   c.stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true},video:false});
   if(c.stopped){c.stream.getTracks().forEach(t=>t.stop());return;}
   c.context=new AudioContext({sampleRate:16000});await c.context.resume();
   const code=`class FGPCM extends AudioWorkletProcessor{constructor(){super();this.buf=new Float32Array(2048);this.at=0;this.ended=false;this.port.onmessage=e=>{if(e.data==='flush'){this.ended=true;if(this.at){const b=this.buf.slice(0,this.at);this.port.postMessage(b.buffer,[b.buffer]);this.at=0;}this.port.postMessage({flushed:true});}};}process(inputs){if(this.ended)return true;const channels=inputs[0];if(!channels?.length)return true;for(let i=0;i<channels[0].length;i++){let v=0;for(const ch of channels)v+=ch[i];this.buf[this.at++]=v/channels.length;if(this.at===2048){this.port.postMessage(this.buf.buffer,[this.buf.buffer]);this.buf=new Float32Array(2048);this.at=0;}}return true;}}registerProcessor('fg-pcm',FGPCM);`;
   c.moduleURL=URL.createObjectURL(new Blob([code],{type:"text/javascript"}));await c.context.audioWorklet.addModule(c.moduleURL);
   if(c.stopped)return;
   const base=location.pathname.startsWith("/fg-six/")?"/fg-six":"",url=new URL(base+"/api/fg/speech/stream",location.origin);
   url.protocol=location.protocol==="https:"?"wss:":"ws:";url.searchParams.set("operationId",crypto.randomUUID());if(advertising)url.searchParams.set("advertising",advertising);
   c.socket=new WebSocket(url);const resample=createPCMResampler(c.context.sampleRate);
   c.socket.onmessage=event=>{
    if(!alive.current||capture.current!==c)return;
    try{const data=JSON.parse(event.data);
     if(data.type==="ready"&&!c.node){
      c.node=new AudioWorkletNode(c.context!,"fg-pcm");c.context!.createMediaStreamSource(c.stream!).connect(c.node);
      const muted=c.context!.createGain();muted.gain.value=0;c.node.connect(muted).connect(c.context!.destination);
      c.node.port.onmessage=message=>{
       if(message.data?.flushed){c.flushed?.();return;}
       if(c.stopped||c.socket?.readyState!==WebSocket.OPEN)return;
       if(c.socket.bufferedAmount>128000){setError("网络发送不及时，录音已停止；可查看识别记录");void stop();return;}
       const pcm=resample(new Float32Array(message.data));const joined=new Uint8Array(c.pending.length+pcm.length);joined.set(c.pending);joined.set(pcm,c.pending.length);c.pending=joined;
       while(c.pending.length>=6400){c.socket.send(c.pending.slice(0,6400));c.pending=c.pending.slice(6400);}
      };
      setState("recording");c.timer=setTimeout(()=>void stop(),295000);
     }else if(data.type==="result")setText(data.text||"");
     else if(data.type==="complete"){setText(data.text||"");setState("idle");void release(c);onComplete?.();}
     else if(data.type==="error"){setError(data.message||"实时识别未完成，请查看任务记录");setState("idle");void release(c);onComplete?.();}
    }catch{setError("语音结果格式异常");setState("idle");void release(c);}
   };
   c.socket.onerror=()=>{if(alive.current&&capture.current===c){setError("实时识别连接未能建立，请检查登录、网络或联系管理员");setState("idle");void release(c);}};
   c.socket.onclose=()=>{if(alive.current&&capture.current===c){setError("识别连接已断开，已收到的文字保留在记录中");setState("idle");void release(c);onComplete?.();}};
  }catch(e){await release(c);if(alive.current){setState("idle");setError(e instanceof Error&&e.name==="NotAllowedError"?"请允许浏览器使用麦克风后再开始":e instanceof Error?e.message:"无法开始录音");}}
 }
 return <Space orientation="vertical" style={{width:"100%"}}>
  <Typography.Paragraph>边说边出字，使用豆包流式语音识别 2.0。每次最多 5 分钟；停止后保存最终文本和分句字幕。</Typography.Paragraph>
  <Space><Button type="primary" icon={state==="recording"?<StopOutlined/>:<AudioOutlined/>} loading={state==="connecting"||state==="finishing"} onClick={()=>void(state==="recording"?stop():start())}>{state==="recording"?"停止并保存":state==="finishing"?"正在保存":"开始实时识别"}</Button><Button icon={<CopyOutlined/>} disabled={!text} onClick={()=>void navigator.clipboard.writeText(text)}>复制文字</Button></Space>
  <Input.TextArea aria-label="实时语音识别文字" value={text} readOnly rows={8} placeholder="识别的文字会实时显示在这里"/>
  {error&&<Alert type="error" title={error}/>}
 </Space>;
}
