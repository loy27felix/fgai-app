import {useState} from 'react';
import {useLocation} from 'react-router';
import {Button} from 'antd';
import {AppModal} from '@/components/ui/product/app-modal';
let takeoverDraft:unknown;
export function rememberCanvasTakeoverDraft(draft:unknown){takeoverDraft=draft;}
export function CanvasTakeoverNotice(){
 const location=useLocation();const state=location.state as {fgEditorNotice?:string}|null;
 const [dismissed,setDismissed]=useState(false);
 if(!state?.fgEditorNotice||dismissed)return null;
 const download=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(takeoverDraft,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='FG-接管前画布草稿.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 return <AppModal open title="画布已由同事接管" onCancel={()=>setDismissed(true)} footer={<><Button onClick={download}>导出退出前草稿</Button><Button type="primary" onClick={()=>setDismissed(true)}>知道了</Button></>}><p>{state.fgEditorNotice}</p><p className="mt-3 opacity-60">已返回画布列表。云端工程保留；退出前尚未保存的内容可以导出，避免覆盖同事的修改。</p></AppModal>;
}
