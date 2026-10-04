import {useEffect,useState} from 'react';
import {fgWorkspace,setFGEditorToken} from './fg-scope';

export function FGEditorLease(){
 const [blocked,setBlocked]=useState(true),[status,setStatus]=useState('正在连接广告画布…');
 useEffect(()=>{
  if(!fgWorkspace)return;let stopped=false,lost=false,token='';let watcher:EventSource|undefined;const key='ad:'+fgWorkspace;
  const request=async(action:string)=>{const r=await fetch('/api/fg/editor/lease',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key,action,token})});const d=await r.json();if(!r.ok||d.code!==0){if(d.reason==='FG_EDITOR_REPLACED')exit(d.msg);throw Error(d.msg||'编辑连接失败');}return d.data;};
  const exit=(notice:string)=>{if(stopped||lost)return;lost=true;watcher?.close();setFGEditorToken('');setBlocked(true);window.location.replace('/advertising?editorTakenOver='+encodeURIComponent(notice));};
  const onLost=(event:Event)=>exit((event as CustomEvent<string>).detail||'另一位同事进入了这个画布，你已退出编辑。');window.addEventListener('fg-editor-lost',onLost);
  void request('acquire').then(d=>{if(stopped)return;token=d.token;setFGEditorToken(token);watcher=new EventSource('/api/fg/editor/watch?'+new URLSearchParams({key,generation:d.generation}));watcher.addEventListener('replaced',event=>{try{exit(JSON.parse((event as MessageEvent).data).msg);}catch{exit('另一位同事进入了这个画布，你已退出编辑。');}});setBlocked(false);}).catch(e=>{if(!stopped)setStatus(e.message);});
  const heartbeat=async()=>{if(stopped||lost||!token)return;try{await request('heartbeat');if(!stopped)setBlocked(false);}catch(e){if(!stopped){setBlocked(true);setStatus(e instanceof Error?e.message:'编辑连接中断，正在恢复。');}}};
  const timer=window.setInterval(()=>void heartbeat(),5000);window.addEventListener('focus',heartbeat);
  return()=>{stopped=true;watcher?.close();window.clearInterval(timer);window.removeEventListener('focus',heartbeat);window.removeEventListener('fg-editor-lost',onLost);setFGEditorToken('');};
 },[]);
 if(!fgWorkspace||!blocked)return null;
 return <div className="fg-ad-modal-backdrop"><section className="fg-ad-modal" role="dialog" aria-modal="true" aria-label="广告画布编辑连接"><h2>画布编辑连接</h2><p>{status}</p><p>同一画布由一位同事编辑。此窗口的内容保留，服务器会拒绝失去编辑权后的修改和新制作请求。</p><footer><a className="ghost-btn" href="/advertising">返回广告项目</a></footer></section></div>;
}
