import {useEffect,useRef,useState} from 'react';
import {App,Button} from 'antd';
import {useNavigate} from 'react-router';
import {rememberCanvasTakeoverDraft} from './canvas-takeover-notice';
import {AppModal} from '@/components/ui/product/app-modal';
import {apiClient,http,apiBaseURL} from '@/services/api/request';
import {fgResourceAccessURL} from '@/lib/fg-entry-url';

export function CanvasEditorLease({canvasId,draft}:{canvasId:string;draft:()=>unknown}){
 const {message}=App.useApp();const navigate=useNavigate();const latest=useRef(draft);latest.current=draft;
 const [status,setStatus]=useState('正在连接云端画布…'),[blocked,setBlocked]=useState(true);
 useEffect(()=>{
  if(!canvasId)return;let stopped=false,lost=false,token='';let watcher:EventSource|undefined;const key='canvas:'+canvasId;
  const exit=(notice:string)=>{if(stopped||lost)return;lost=true;watcher?.close();setBlocked(true);rememberCanvasTakeoverDraft(latest.current());navigate('/canvas',{replace:true,state:{fgEditorNotice:notice}});};
  const interceptor=apiClient.interceptors.request.use(config=>{if(token){config.headers.set('X-FG-Editor-Key',key);config.headers.set('X-FG-Editor-Token',token);}return config;});
  const responseInterceptor=apiClient.interceptors.response.use(r=>r,e=>{if(e.response?.data?.reason==='FG_EDITOR_REPLACED'&&!stopped){exit(e.response.data.msg||'另一位同事进入了这个画布，你已退出编辑。');}return Promise.reject(e);});
  async function heartbeat(){if(stopped||lost||!token)return;try{await http.post('/fg/editor/lease',{key,action:'heartbeat',token});if(!stopped)setBlocked(false);}catch(e){if(!stopped){setBlocked(true);setStatus(e instanceof Error?e.message:'编辑连接中断，正在恢复；当前草稿保留。');}}}
  void http.post<{token:string;generation:string;previousHolder:string|null}>('/fg/editor/lease',{key,action:'acquire'}).then(r=>{if(stopped)return;token=r.token;watcher=new EventSource(fgResourceAccessURL('/api/fg/editor/watch?'+new URLSearchParams({key,generation:r.generation}),apiBaseURL));watcher.addEventListener('replaced',event=>{try{exit(JSON.parse((event as MessageEvent).data).msg);}catch{exit('另一位同事进入了这个画布，你已退出编辑。');}});setBlocked(false);if(r.previousHolder)message.info(`已接管 ${r.previousHolder} 正在编辑的画布，对方窗口会停止编辑。`);}).catch(e=>{if(!stopped)setStatus(e instanceof Error?e.message:'编辑连接失败');});
  const timer=window.setInterval(()=>void heartbeat(),5000);const focus=()=>void heartbeat();window.addEventListener('focus',focus);
  return()=>{stopped=true;watcher?.close();window.clearInterval(timer);window.removeEventListener('focus',focus);apiClient.interceptors.request.eject(interceptor);apiClient.interceptors.response.eject(responseInterceptor);};
 },[canvasId,message,navigate]);
 const download=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(latest.current(),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='FG-画布草稿-'+canvasId+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 return <AppModal open={blocked} title="画布编辑连接" closable={false} maskClosable={false} keyboard={false} zIndex={20000} footer={<><Button onClick={download}>导出当前草稿</Button><Button onClick={()=>navigate('/canvas')}>返回画布列表</Button></>}><p>{status}</p><p className="text-sm opacity-60 mt-3">同一画布由一位同事编辑。此窗口的内容会保留，服务器会拒绝失去编辑权后的写入。</p></AppModal>;
}
