import {useCallback,useEffect,useState} from 'react';
import {App,Button,Form,Input,InputNumber,Spin} from 'antd';
import {ArrowUpRight,Clapperboard,Plus,RefreshCw} from 'lucide-react';
import {useSearchParams} from 'react-router';
import {WorkspacePage,PageHeader} from '@/components/layout/workspace-page';
import {AppModal} from '@/components/ui/product/app-modal';
import {http} from '@/services/api/request';
import {listAdvertisingProjects,openAdvertisingProject,type AdvertisingProjects} from '@/services/api/fg-advertising';
import {WorkspaceState} from '@/components/layout/workspace-state';
import './advertising.css';
export default function AdvertisingPage(){
 const {message}=App.useApp();const [search]=useSearchParams();const [data,setData]=useState<AdvertisingProjects>();const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');const [form]=Form.useForm();
 const load=useCallback(async()=>{try{setData(await listAdvertisingProjects());setError('');}catch(e){setError(e instanceof Error?e.message:'广告项目读取失败');}},[]);
 const enter=useCallback(async(id:string)=>{setBusy(true);try{const r=await openAdvertisingProject(id);window.open(new URL(r.url,window.location.origin).href,'_top');}catch(e){message.error(e instanceof Error?e.message:'广告工程启动失败');}finally{setBusy(false);}},[message]);
 useEffect(()=>{void load();},[load]);
 useEffect(()=>{if(search.get('workspace'))void enter(search.get('workspace')!);},[search,enter]);
 return <WorkspacePage className="fg-advertising-page"><PageHeader title="广告工作台" description="独立广告工程。默认仅自己可见，按需邀请同事协作。" actions={<><Button onClick={()=>void load()} icon={<RefreshCw size={15}/>}>刷新</Button><Button type="primary" icon={<Plus size={16}/>} onClick={()=>{form.resetFields();setOpen(true);}}>新建广告项目</Button></>}/><section className="fg-advertising-intro"><div><span>FG / ADVERTISING</span><h2>让创意，成为下一支广告。</h2><p>从产品、卖点到分镜与成片，工程和素材持续保存在服务器与 NAS。</p></div></section>{error?<p role="alert">{error}</p>:!data?<Spin/>:data.workspaces.length?<div className="fg-advertising-cards">{data.workspaces.map(w=><article key={w.id}><div className="fg-advertising-card-mark"><Clapperboard size={22}/><span>独立广告项目</span></div><h3>{w.name}</h3><p>{w.brief}</p><div className="fg-advertising-card-meta"><span>{w.owner_name}</span><span>{Number(w.budget_cny)>0?'预算 ¥'+Number(w.budget_cny).toLocaleString('zh-CN'):'无预算上限'}</span></div><Button type="primary" loading={busy} onClick={()=>void enter(w.id)}>打开广告工作台 <ArrowUpRight size={15}/></Button></article>)}</div>:<WorkspaceState title="还没有广告项目" description="先写下产品与制作目标。"/>}
 <AppModal title="新建广告项目" open={open} onCancel={()=>setOpen(false)} okText="创建并打开" confirmLoading={busy} onOk={async()=>{try{const v=await form.validateFields();setBusy(true);const r=await http.post<{id:string}>('/fg/advertising',{...v,budgetCny:v.budgetCny||0});setOpen(false);await enter(r.id);}catch(e){if(e instanceof Error)message.error(e.message);}finally{setBusy(false);}}}><Form form={form} layout="vertical" initialValues={{budgetCny:0}}><Form.Item name="name" label="广告项目名称" rules={[{required:true}]}><Input maxLength={160}/></Form.Item><Form.Item name="brief" label="产品与广告需求" rules={[{required:true,min:5,message:'请描述产品、卖点和制作目标'}]}><Input.TextArea rows={4} maxLength={10000}/></Form.Item><Form.Item name="budgetCny" label="制作预算（人民币）" extra="不填或 0 为无上限；建立后仅超级管理员可调整。"><InputNumber min={0} max={1000000} precision={2} prefix="¥" style={{width:'100%'}}/></Form.Item></Form></AppModal>
 </WorkspacePage>;
}
