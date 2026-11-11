import {useState} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {App,Alert,Button,Drawer,Table} from "antd";
import {RotateCcw,Trash2} from "lucide-react";
import {AppModal} from "@/components/ui/product/app-modal";
import dayjs from "dayjs";
import {http} from "@/services/api/request";
import {useUserStore} from "@/stores/use-user-store";
type RecycledCanvas={id:string;title:string;userId:string;deletedAt:string};
export function FGCanvasRecycleDrawer({open,onClose}:{open:boolean;onClose:()=>void}){
 const {message}=App.useApp();const cache=useQueryClient();const [restoring,setRestoring]=useState<string[]>([]);
 const [purgeTarget,setPurgeTarget]=useState<RecycledCanvas|null>(null);const [purging,setPurging]=useState(false);
 const userId=useUserStore(s=>s.user?.id);const isAdmin=useUserStore(s=>s.user?.role==="admin");
 const query=useQuery({queryKey:["fg-canvas-recycle",userId],queryFn:()=>http.get<{projects:RecycledCanvas[]}>("/canvas-projects/recycle"),enabled:open&&Boolean(userId)});
 const owners=useQuery({queryKey:["fg-canvas-owners",userId],queryFn:()=>http.get<{owners:{id:string;name:string}[]}>("/fg/canvas/owners"),enabled:open&&isAdmin});
 async function restore(id:string){setRestoring(values=>[...values,id]);try{await http.post("/canvas-projects/"+encodeURIComponent(id)+"/restore");await Promise.all([query.refetch(),cache.invalidateQueries({queryKey:["canvas-library"]}),cache.invalidateQueries({queryKey:["fg-canvas-owners"]})]);void message.success("画布已恢复，原分享链接保持失效");}catch(error){void message.error(error instanceof Error?error.message:"恢复失败");}finally{setRestoring(values=>values.filter(value=>value!==id));}}
 async function purge(){if(!purgeTarget)return;setPurging(true);try{await http.post("/canvas-projects/"+encodeURIComponent(purgeTarget.id)+"/purge");setPurgeTarget(null);await query.refetch();void message.success("画布已彻底删除，工程记录已转入 NAS recycle");}catch(error){void message.error(error instanceof Error?error.message:"彻底删除失败，画布仍保留在回收站");}finally{setPurging(false);}}
 return <Drawer title="画布回收站" open={open} onClose={onClose} size="large" destroyOnHidden>
  <p className="text-sm text-muted-foreground mb-6">画布保留 30 天，期间可以恢复。到期自动彻底删除，也可以提前删除。彻底删除后，工程记录转入 NAS recycle，无法在这里恢复；素材库及其他画布使用的素材保留。</p>
  {query.isError&&<Alert type="error" showIcon title={query.error.message} action={<Button onClick={()=>void query.refetch()}>重试</Button>}/>}
  <Table<RecycledCanvas> rowKey="id" size="middle" loading={query.isFetching} dataSource={query.data?.projects||[]} pagination={{pageSize:20,showSizeChanger:false}} scroll={{x:580}} locale={{emptyText:"回收站是空的"}} columns={[
   {title:"画布",dataIndex:"title",ellipsis:true},
   {title:"所属用户",width:150,render:(_,row)=>row.userId===userId?"我":owners.data?.owners.find(owner=>owner.id===row.userId)?.name||"普通用户"},
   {title:"保留至",width:155,render:(_,row)=>dayjs(row.deletedAt).add(30,"day").format("MM/DD HH:mm")},
   {title:"操作",width:185,render:(_,row)=><div className="flex gap-2"><Button size="small" icon={<RotateCcw size={13}/>} disabled={purging} loading={restoring.includes(row.id)} onClick={()=>void restore(row.id)}>恢复</Button><Button size="small" danger icon={<Trash2 size={13}/>} disabled={purging||restoring.includes(row.id)} onClick={()=>setPurgeTarget(row)}>彻底删除</Button></div>}
  ]}/>
  <AppModal title="彻底删除画布？" open={Boolean(purgeTarget)} onCancel={()=>{if(!purging)setPurgeTarget(null);}} onOk={()=>void purge()} confirmLoading={purging} okText="彻底删除" okButtonProps={{danger:true}} cancelText="取消" closable={!purging} maskClosable={!purging}>
   <p>“{purgeTarget?.title}”将从画布回收站移除，工程记录转入 NAS recycle，无法通过工作台恢复。素材库及其他画布使用的素材不受影响。</p>
  </AppModal>
 </Drawer>;
}
