import { App, Button, List } from 'antd';
import { Box, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { AppModal } from '@/components/ui/product/app-modal/app-modal';
import type {CanvasNodeData} from '@/types/canvas';
export function CanvasDirectorLibrary({open,nodes,onClose,onOpen,onNew,onDelete}:{open:boolean;nodes:CanvasNodeData[];onClose:()=>void;onOpen:(node:CanvasNodeData)=>void;onNew:()=>void;onDelete:(node:CanvasNodeData)=>Promise<void>}){
 const {modal,message}=App.useApp();
 const projects=nodes.filter(n=>n.metadata?.directorDesk);
 return <AppModal open={open} title="当前画布的 3D 工程" onCancel={onClose} footer={<Button type="primary" icon={<Plus size={16}/>} onClick={onNew}>新建 3D 工程</Button>} width={620}>
  <p className="mb-4 text-sm opacity-60">每个画布可以保存多个工程，继续编辑会恢复 NAS 中的原工程。不同工程也可以分别在新窗口打开。</p>
  {projects.length?<List dataSource={projects} renderItem={node=><List.Item actions={[
   <Button key="open" onClick={()=>{onClose();onOpen(node);}}>继续编辑</Button>,
   <Button key="window" title="在新窗口编辑这个工程" icon={<ExternalLink size={16}/>} onClick={()=>{const url=new URL(location.href);url.searchParams.set('director',node.id);window.open(url.href,'_blank','noopener');}}/>,
   <Button key="delete" danger aria-label={`删除 ${node.title}`} icon={<Trash2 size={16}/>} onClick={()=>modal.confirm({title:`删除 ${node.title}？`,content:'从当前画布移除这个工程；导出素材、历史版本与 NAS 原文件保留，可从画布历史恢复。',okText:'删除工程',cancelText:'取消',okButtonProps:{danger:true},onOk:async()=>{try{await onDelete(node);}catch(e){message.error(e instanceof Error?e.message:'删除失败');throw e;}}})}/>]}>
   <List.Item.Meta avatar={<Box size={24}/>} title={node.title} description="云端工程 · 自动保存到 NAS"/>
  </List.Item>}/>:<p className="py-8 text-center opacity-60">还没有 3D 工程，从新建开始</p>}
 </AppModal>;
}
