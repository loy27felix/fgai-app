import {useCallback,useEffect,useState} from 'react';
import {Alert,App,Button,Checkbox,Form,Input,InputNumber,Segmented,Spin} from 'antd';
import {ArrowUpRight,Clapperboard,Plus,RefreshCw,Trash2,Undo2} from 'lucide-react';
import {useSearchParams} from 'react-router';
import {WorkspacePage,PageHeader} from '@/components/layout/workspace-page';
import {AppModal} from '@/components/ui/product/app-modal';
import {http} from '@/services/api/request';
import {listAdvertisingProjects,openAdvertisingProject,deleteAdvertisingProject,restoreAdvertisingProject,purgeAdvertisingProject,type AdvertisingProjects,type AdvertisingProject} from '@/services/api/fg-advertising';
import {WorkspaceState} from '@/components/layout/workspace-state';
import './advertising.css';

export default function AdvertisingPage(){
 const {message,modal}=App.useApp();const [search]=useSearchParams();
 const [data,setData]=useState<AdvertisingProjects>(),[archived,setArchived]=useState(false);
 const [selected,setSelected]=useState<string[]>([]);
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');const [form]=Form.useForm();
 const load=useCallback(async()=>{try{setData(await listAdvertisingProjects(archived));setError('');}catch(e){setError(e instanceof Error?e.message:'广告项目读取失败');}},[archived]);
 const enter=useCallback(async(id:string)=>{setBusy(true);try{const r=await openAdvertisingProject(id);window.location.assign(r.url);}catch(e){message.error(e instanceof Error?e.message:'广告工程启动失败');}finally{setBusy(false);}},[message]);
 useEffect(()=>{void load();},[load]);
 useEffect(()=>{if(search.get('workspace'))void enter(search.get('workspace')!);if(search.get('create')==='1')setOpen(true);},[search,enter]);
 const remove=(w:AdvertisingProject)=>modal.confirm({title:`删除 ${w.name}？`,content:'项目移入回收站，30 天内可恢复；到期自动清理该广告工程的 NAS 文件。人民币账单、公司公共素材和其他工程仍在引用的素材保留。',okText:'移入回收站',cancelText:'取消',okButtonProps:{danger:true},onOk:async()=>{await deleteAdvertisingProject(w.id);await load();message.success('项目已移入回收站');}});
 const batch=async(ids:string[],operation:(id:string)=>Promise<unknown>)=>{
  setBusy(true);const failed:string[]=[];
  try{for(const id of ids){try{await operation(id);}catch(e){failed.push(id);message.error(e instanceof Error?e.message:'操作失败');}}
   setSelected(failed);await load();if(ids.length>failed.length)message.success(`已处理 ${ids.length-failed.length} 个广告项目`);
  }finally{setBusy(false);}
 };
 const confirmBatch=(ids:string[],purge=false)=>modal.confirm({title:purge?`彻底删除 ${ids.length} 个广告项目？`:`将 ${ids.length} 个广告项目移入回收站？`,content:purge?'此操作不可恢复，将立即清理这些广告工程在 NAS 中的独立工程文件。人民币账单、公司公共素材与其他工程引用的素材保留。':'移入回收站后可恢复，30 天后自动清理。',okText:purge?'彻底删除':'移入回收站',cancelText:'取消',okButtonProps:{danger:true},onOk:()=>batch(ids,purge?purgeAdvertisingProject:deleteAdvertisingProject)});
 const manageable=data?.workspaces.filter(w=>w.can_manage).map(w=>w.id)||[];
 return <WorkspacePage className="fg-advertising-page">
  <PageHeader title="广告工作台" description="独立广告工程仅自己可见；团队协作请使用故事与项目。" actions={<><Button onClick={()=>void load()} icon={<RefreshCw size={15}/>}>刷新</Button><Button type="primary" icon={<Plus size={16}/>} onClick={()=>{form.resetFields();setOpen(true);}}>新建广告项目</Button></>}/>
  {search.get("editorTakenOver")&&<Alert type="info" showIcon closable message="画布已由同事接管" description={search.get("editorTakenOver")}/>}
  <section className="fg-advertising-intro"><div><span>FG / ADVERTISING</span><h2>让创意，成为下一支广告。</h2><p>从产品、卖点到分镜与成片，工程和素材持续保存在服务器与 NAS。</p></div></section>
  <Segmented className="mb-5" disabled={busy} value={archived?'trash':'active'} onChange={v=>{setSelected([]);setData(undefined);setArchived(v==='trash');}} options={[{value:'active',label:'广告项目'},{value:'trash',label:'回收站'}]}/>
  {archived&&<Alert className="mb-5" type="info" showIcon message="广告项目保留 30 天" description="保留期内可以恢复；到期自动清理该广告工程的 NAS 文件。人民币账单与公司公共素材保留。"/>}
  {!!manageable.length&&<div role="toolbar" aria-label="广告项目批量操作" className="mb-5 flex flex-wrap items-center gap-3">
   <Checkbox disabled={busy} checked={manageable.every(id=>selected.includes(id))} indeterminate={selected.length>0&&!manageable.every(id=>selected.includes(id))} onChange={e=>setSelected(e.target.checked?manageable:[])}>全选可管理项目</Checkbox><span>已选 {selected.length} 项</span>
   {archived&&<Button disabled={busy||!selected.length} icon={<Undo2 size={15}/>} onClick={()=>void batch(selected,restoreAdvertisingProject)}>批量恢复</Button>}
   <Button danger disabled={busy||!selected.length} icon={<Trash2 size={15}/>} onClick={()=>confirmBatch(selected,archived)}>{archived?'彻底删除已选':'批量移入回收站'}</Button>
  </div>}
  {error?<p role="alert">{error}</p>:!data?<Spin/>:data.workspaces.length?<div className="fg-advertising-cards">{data.workspaces.map(w=><article key={w.id}>
   <div className="fg-advertising-card-mark">{w.can_manage&&<Checkbox aria-label={`选择 ${w.name}`} disabled={busy} checked={selected.includes(w.id)} onChange={e=>setSelected(current=>e.target.checked?[...new Set([...current,w.id])]:current.filter(id=>id!==w.id))}/>}<Clapperboard size={22}/><span>{archived?'已删除广告项目':'独立广告项目'}</span></div><h3>{w.name}</h3><p>{w.brief}</p>
   <div className="fg-advertising-card-meta"><span>{w.owner_name}</span><span>{Number(w.budget_cny)>0?'预算 ¥'+Number(w.budget_cny).toLocaleString('zh-CN'):'无预算上限'}</span></div>
   <div className="flex flex-wrap items-center gap-2">{archived?w.can_manage&&<><Button disabled={busy} icon={<Undo2 size={15}/>} onClick={()=>void batch([w.id],restoreAdvertisingProject)}>恢复项目</Button><Button danger disabled={busy} onClick={()=>confirmBatch([w.id],true)}>彻底删除</Button></>:<><Button type="primary" loading={busy} onClick={()=>void enter(w.id)}>打开广告工作台 <ArrowUpRight size={15}/></Button>{w.can_manage&&<Button danger aria-label={`删除 ${w.name}`} icon={<Trash2 size={15}/>} onClick={()=>remove(w)}/>}</>}</div>
  </article>)}</div>:<WorkspaceState title={archived?'回收站为空':'还没有广告项目'} description={archived?'删除后保留 30 天可恢复；到期清理对应广告工程的 NAS 文件。':'先写下产品与制作目标。'}/>}
  <AppModal title="新建广告项目" open={open} onCancel={()=>setOpen(false)} okText="创建并打开" confirmLoading={busy} onOk={async()=>{try{const v=await form.validateFields();setBusy(true);const r=await http.post<{id:string}>('/fg/advertising',{...v,budgetCny:v.budgetCny||0});setOpen(false);await enter(r.id);}catch(e){if(e instanceof Error)message.error(e.message);}finally{setBusy(false);}}}>
   <Form form={form} layout="vertical" initialValues={{budgetCny:0}}><Form.Item name="name" label="广告项目名称" rules={[{required:true}]}><Input maxLength={160}/></Form.Item><Form.Item name="brief" label="产品与广告需求" rules={[{required:true,min:5,message:'请描述产品、卖点和制作目标'}]}><Input.TextArea rows={4} maxLength={10000}/></Form.Item><Form.Item name="budgetCny" label="制作预算（人民币）" extra="不填或 0 为无上限；建立后仅超级管理员可调整。"><InputNumber min={0} max={1000000} precision={2} prefix="¥" style={{width:'100%'}}/></Form.Item></Form>
  </AppModal>
 </WorkspacePage>;
}
